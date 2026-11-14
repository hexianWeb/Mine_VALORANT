import * as THREE from 'three/webgpu'
import { hashReflectionBytes, reflectionCubeFromBytes, reflectionSource, roomReflectionDefinition, validateReflectionManifest } from './reflection-data.js'
import { createReflectionPreview } from './reflection-preview.js'

/** One scene-owned static probe. Loading may prefilter saved HDR, but never renders the room. */
export async function loadRoomReflection({ renderer, room, skyboxUrl, signal, preview = false, url = '/lighting/range-room-reflections/v1/manifest.json' }) {
  const started = performance.now()
  const base = new URL(url, globalThis.location.href)
  const [response, source] = await Promise.all([
    fetch(base, { signal }),
    reflectionSource(room.manifest, skyboxUrl, signal),
  ])
  if (!response.ok)
    throw new Error(`[Reflection] Manifest HTTP ${response.status}`)
  const manifest = validateReflectionManifest(await response.json(), source)
  const binary = await fetch(new URL(manifest.url, base), { signal })
  if (!binary.ok)
    throw new Error(`[Reflection] HDR HTTP ${binary.status}`)
  const bytes = await binary.arrayBuffer()
  if (bytes.byteLength !== manifest.bytes || await hashReflectionBytes(bytes) !== manifest.sha256)
    throw new Error('[Reflection] HDR integrity mismatch')
  signal?.throwIfAborted()
  const cube = reflectionCubeFromBytes(bytes)
  const generator = new THREE.PMREMGenerator(renderer)
  let target
  let previewPlane = null
  try {
    if (preview)
      previewPlane = createReflectionPreview(cube)
    target = generator.fromCubemap(cube)
    signal?.throwIfAborted()
  }
  catch (error) {
    previewPlane?.dispose()
    target?.dispose()
    throw error
  }
  finally {
    generator.dispose()
    cube.dispose()
    for (const face of cube.images) face.dispose()
  }
  target.texture.name = roomReflectionDefinition.id
  let disposed = false
  const loadMs = performance.now() - started
  return {
    texture: target.texture,
    preview: previewPlane,
    definition: roomReflectionDefinition,
    getDebugState: () => ({
      id: manifest.id,
      ready: !disposed,
      source: 'precomputed',
      bytes: manifest.bytes,
      loadMs,
      captures: 0,
      sha256: manifest.sha256,
      stats: manifest.stats,
    }),
    dispose() {
      if (disposed)
        return
      disposed = true
      previewPlane?.dispose()
      target.dispose()
    },
  }
}
