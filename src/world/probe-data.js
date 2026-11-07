import * as THREE from 'three/webgpu'

export const probeCaptureDefaults = Object.freeze({
  sky: 0.35,
  emissive: 0,
  direct: 1,
  cubemapSize: 16,
})
export const probeLightingDefaults = Object.freeze({
  enabled: true,
  intensity: 1.21,
  skyDiffuse: 0.52,
  skySpecular: 1,
  direct: 1,
  showBounds: false,
  showProbes: false,
})

export function validateProbeVolumes(manifest) {
  if (manifest?.version !== 1 || manifest.coordinateSystem !== 'three-y-up' || !manifest.volumes?.length)
    throw new Error('[Probes] Invalid volume manifest')
  const ids = new Set()
  let total = 0
  for (const volume of manifest.volumes) {
    if (typeof volume.id !== 'string' || !volume.id.length || ids.has(volume.id))
      throw new Error('[Probes] Missing or duplicate volume id')
    ids.add(volume.id)
    for (const key of ['min', 'max', 'resolution']) {
      if (!Array.isArray(volume[key]) || volume[key].length !== 3 || !volume[key].every(Number.isFinite))
        throw new Error(`[Probes] ${volume.id}: invalid ${key}`)
    }
    if (volume.max.some((value, axis) => value <= volume.min[axis]))
      throw new Error(`[Probes] ${volume.id}: empty bounds`)
    if (!volume.resolution.every(value => Number.isInteger(value) && value >= 2 && value <= 32) || !Number.isInteger(volume.priority))
      throw new Error(`[Probes] ${volume.id}: invalid resolution or priority`)
    total += volume.resolution.reduce((a, b) => a * b, 1)
  }
  if (total > 4096)
    throw new Error('[Probes] Probe budget exceeds 4096')
  return manifest.volumes
}

export function atlasLayout(resolution) {
  const [width, height, slices] = resolution
  const depth = 7 * (slices + 2)
  return {
    width,
    height,
    depth,
    bytes: width * height * depth * 8,
  }
}

export async function sha256(data) {
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('')
}

export function probeSourceKey(room, volumes, skyboxUrl) {
  return JSON.stringify({
    version: 1,
    three: THREE.REVISION,
    model: room.model.sha256,
    atlases: room.atlases.map(page => page.sha256),
    lights: room.lights,
    skyboxUrl,
    volumes,
    encoding: 'l2-sh-rgba16f-7-padded-volumes',
  })
}

export function validateCapture(settings) {
  for (const key of ['sky', 'emissive', 'direct']) {
    if (!Number.isFinite(settings[key]) || settings[key] < 0 || settings[key] > 4)
      throw new Error(`[Probes] Invalid capture ${key}`)
  }
  if (![8, 16, 32, 64].includes(settings.cubemapSize))
    throw new Error('[Probes] Capture resolution must be 8, 16, 32 or 64')
}

/** Keep the native grid texture identity stable across cache uploads and re-bakes. */
export function uploadProbeAtlas(renderer, grid, data) {
  const { width, height, depth, bytes } = atlasLayout(grid.resolution.toArray())
  if (!(data instanceof Uint16Array) || data.byteLength !== bytes)
    throw new Error('[Probes] Invalid SH atlas size')
  if (data.some(value => !Number.isFinite(THREE.DataUtils.fromHalfFloat(value))))
    throw new Error('[Probes] Non-finite SH coefficient')
  const source = new THREE.Data3DTexture(data, width, height, depth)
  source.type = THREE.HalfFloatType
  source.format = THREE.RGBAFormat
  source.unpackAlignment = 1
  source.needsUpdate = true
  try {
    // r187's addon exposes the texture but owns its baking target internally.
    renderer.initRenderTarget(grid._renderTarget)
    // Renderer defaults to a single depth slice unless a Box3 is supplied.
    const region = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3(width, height, depth))
    renderer.copyTextureToTexture(source, grid.texture, region)
  }
  finally {
    source.dispose()
  }
}

export async function readProbeAtlas(renderer, grid, signal) {
  const { width, height, depth } = atlasLayout(grid.resolution.toArray())
  const data = new Uint16Array(width * height * depth * 4)
  for (let z = 0; z < depth; z++) {
    signal?.throwIfAborted()
    const slice = await renderer.readRenderTargetPixelsAsync(grid._renderTarget, 0, 0, width, height, 0, z)
    data.set(slice, z * width * height * 4)
  }
  return data
}
