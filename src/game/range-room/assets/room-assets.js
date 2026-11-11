import * as THREE from 'three/webgpu'
import { createTextureSampling } from '../../../engine/runtime/function/render/material/texture-sampling.js'
import { bindingKey, validateManifest } from './manifest.js'
import { createRoomMaterial } from './materials.js'

/** Load, integrity-check, bind, and instance one room. Cleans up partially failed loads. */
export async function loadRoomAssets({ resources, manifestUrl, signal, sampling = {} }) {
  const base = new URL(manifestUrl, globalThis.location.href)
  const response = await fetch(base, { signal })
  if (!response.ok)
    throw new Error(`[Room assets] Manifest HTTP ${response.status}: ${base}`)
  const manifest = await response.json()
  const { bindings } = validateManifest(manifest)
  const prefix = `room:${manifest.id}:${manifest.model.sha256}`
  const modelName = `${prefix}:model`
  const entries = [
    {
      name: modelName,
      type: 'gltf',
      url: new URL(manifest.model.url, base).href,
      options: { sha256: manifest.model.sha256 },
    },
    ...manifest.atlases.map(page => ({
      name: `${prefix}:${page.id}`,
      type: 'exr',
      url: new URL(page.url, base).href,
      options: { sha256: page.sha256, atlasMaxMipLevel: sampling.atlasMaxMipLevel ?? 2 },
    })),
  ]
  const materials = new Set()
  const samplers = createTextureSampling(sampling)
  let root
  let disposed = false
  const dispose = () => {
    if (disposed)
      return
    disposed = true
    root?.removeFromParent()
    for (const material of materials)
      material.dispose()
    samplers.dispose()
    for (const entry of entries)
      resources.unload(entry.name)
  }
  signal?.addEventListener('abort', dispose, { once: true })
  try {
    await resources.load(entries, { signal })
    signal?.throwIfAborted()
    const gltf = resources.get(modelName, 'gltf')
    // Stamp associations on the TEMPLATE before cloning: SkeletonUtils clones userData,
    // but GLTFLoader's association WeakMap is tied to the original objects.
    gltf.scene.traverse((object) => {
      if (!object.isMesh)
        return
      const association = gltf.parser.associations.get(object)
      let ancestor = object
      while (ancestor && !ancestor.userData.rangeRoomId)
        ancestor = ancestor.parent
      if (!ancestor || !Number.isInteger(association?.meshes) || !Number.isInteger(association?.primitives))
        throw new Error(`[Room assets] No stable glTF association for ${object.name}`)
      object.userData.roomBinding = { receiverId: ancestor.userData.rangeRoomId, meshIndex: association.meshes, primitiveIndex: association.primitives }
    })
    root = resources.instantiate(modelName)
    const atlases = new Map(manifest.atlases.map((page) => {
      const atlas = resources.get(`${prefix}:${page.id}`, 'exr')
      if (atlas.image.width !== page.width || atlas.image.height !== page.height)
        throw new Error(`[Room assets] ${page.id}: texture dimensions mismatch`)
      const sampled = samplers.atlas(atlas)
      if (page.content === 'diffuse-lightmap') {
        const binding = manifest.bindings.find(binding => binding.atlasId === page.id)
        sampled.channel = binding.uvChannel
        // glTF's V convention versus EXR scanlines: flip exactly once, through
        // the built-in lightMap texture matrix rather than an explicit TSL UV.
        sampled.repeat.y = -1
        sampled.offset.y = 1
        sampled.updateMatrix()
      }
      return [page.id, sampled]
    }))
    const consumed = new Set()
    const counts = { 'baked-appearance': 0, 'realtime': 0, 'fixture-emissive': 0 }
    if (manifest.schemaVersion === 4)
      counts.lightmap = 0
    const materialCache = new Map()
    root.traverse((object) => {
      if (object.isLight) {
        object.visible = false
        return
      }
      if (!object.isMesh)
        return
      const key = bindingKey(object.userData.roomBinding ?? {})
      const binding = bindings.get(key)
      if (!binding || consumed.has(key))
        throw new Error(`[Room assets] Missing or duplicate receiver ${object.name}: ${key}`)
      if (Array.isArray(object.material))
        throw new TypeError(`[Room assets] Expected a glTF primitive material: ${key}`)
      if (binding.mode === 'baked-appearance' || binding.mode === 'lightmap') {
        const attribute = binding.uvChannel === 0
          ? 'uv'
          : `uv${binding.uvChannel}`
        if (!object.geometry.hasAttribute(attribute))
          throw new Error(`[Room assets] ${key}: missing ${attribute} for ${binding.atlasId}`)
      }
      const cacheKey = `${object.material.uuid}:${binding.mode}:${binding.atlasId ?? ''}:${binding.uvChannel ?? ''}`
      if (!materialCache.has(cacheKey)) {
        const replacement = createRoomMaterial(object.material, binding, atlases)
        samplers.material(replacement)
        materialCache.set(cacheKey, replacement)
        materials.add(replacement)
      }
      object.material = materialCache.get(cacheKey)
      object.castShadow = binding.mode !== 'fixture-emissive'
      object.receiveShadow = binding.mode === 'realtime' || binding.mode === 'lightmap'
      consumed.add(key)
      counts[binding.mode]++
    })
    if (consumed.size !== bindings.size)
      throw new Error(`[Room assets] ${bindings.size - consumed.size} manifest receivers absent from model`)
    root.updateMatrixWorld(true)
    const bounds = new THREE.Box3().setFromObject(root)
    // Loading cancellation owns partial results; the caller owns the completed instance.
    // In particular, Level must restore material bindings before Mesh releases it.
    signal?.removeEventListener('abort', dispose)
    return {
      root,
      manifest,
      counts,
      bounds,
      atlases,
      samplers,
      dispose() {
        signal?.removeEventListener('abort', dispose)
        dispose()
      },
    }
  }
  catch (error) {
    signal?.removeEventListener('abort', dispose)
    dispose()
    throw error
  }
}
