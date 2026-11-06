const modes = new Set(['baked-appearance', 'realtime', 'fixture-emissive'])
const hashPattern = /^[a-f\d]{64}$/i

function requireValue(condition, message) {
  if (!condition)
    throw new Error(`[Room manifest] ${message}`)
}

function vector(value, length) {
  return Array.isArray(value) && value.length === length && value.every(Number.isFinite)
}

/** Validate metadata before any model/atlas is loaded. Never infer missing classifications. */
export function validateManifest(manifest) {
  requireValue(manifest?.schemaVersion === 3, 'schemaVersion must be 3')
  requireValue(typeof manifest.id === 'string' && manifest.id.length > 0, 'missing room id')
  requireValue(manifest.coordinates?.up === 'Y' && manifest.coordinates.rootTransform === 'identity', 'expected exported Y-up coordinates with identity root')
  requireValue(typeof manifest.model?.url === 'string' && hashPattern.test(manifest.model.sha256), 'model URL/hash required')
  requireValue(Array.isArray(manifest.atlases) && manifest.atlases.length === 5, 'exactly five atlases required')
  const pages = new Map()
  for (const page of manifest.atlases) {
    requireValue(typeof page.id === 'string' && !pages.has(page.id), `duplicate/invalid atlas id ${page.id}`)
    requireValue(page.content === 'baked-appearance' && page.colorSpace === 'linear-rec709' && page.encoding === 'exr-half', `${page.id}: expected scene-linear baked appearance EXR`)
    requireValue(typeof page.url === 'string' && hashPattern.test(page.sha256), `${page.id}: URL/hash required`)
    requireValue(Number.isInteger(page.width) && page.width > 0 && Number.isInteger(page.height) && page.height > 0, `${page.id}: invalid dimensions`)
    requireValue(page.flipY === false && page.sampling?.filter === 'linear' && page.sampling.mipmaps === false && page.sampling.maxLod === 0, `${page.id}: unverified sampler/mip policy`)
    pages.set(page.id, page)
  }
  requireValue(Array.isArray(manifest.bindings) && manifest.bindings.length > 0, 'missing primitive bindings')
  const bindings = new Map()
  const used = new Set()
  for (const binding of manifest.bindings) {
    const key = bindingKey(binding)
    requireValue(typeof binding.receiverId === 'string' && binding.receiverId.length > 0, 'missing stable receiver id')
    requireValue([binding.meshIndex, binding.primitiveIndex, binding.materialIndex].every(n => Number.isInteger(n) && n >= 0), `${key}: invalid glTF indices`)
    requireValue(!bindings.has(key), `duplicate binding ${key}`)
    requireValue(modes.has(binding.mode), `${key}: unknown material classification ${binding.mode}`)
    if (binding.mode === 'baked-appearance') {
      requireValue(pages.has(binding.atlasId), `${key}: unknown atlas ${binding.atlasId}`)
      requireValue(Number.isInteger(binding.uvChannel) && binding.uvChannel >= 0 && binding.uvChannel <= 3, `${key}: invalid UV channel`)
      used.add(binding.atlasId)
    }
    if (binding.mode === 'fixture-emissive')
      requireValue(vector(binding.emissionColor, 3) && Number.isFinite(binding.emissionStrength) && binding.emissionStrength >= 0, `${key}: invalid emission`)
    bindings.set(key, binding)
  }
  requireValue(used.size === pages.size, 'each atlas must have receivers')
  requireValue(Array.isArray(manifest.lights) && manifest.lights.length === 3, 'three ceiling lights required')
  for (const light of manifest.lights) {
    requireValue(light.type === 'rect-area' && vector(light.position, 3) && vector(light.direction, 3) && vector(light.color, 3), 'invalid ceiling light transform/color')
    requireValue(light.width > 0 && light.height > 0 && Number.isFinite(light.intensity) && light.intensity >= 0, `${light.id}: invalid dimensions/intensity`)
  }
  requireValue(vector(manifest.camera?.position, 3) && vector(manifest.camera.quaternion, 4), 'reference camera transform required')
  requireValue(manifest.camera.fov > 0 && manifest.camera.fov < 180 && manifest.camera.near > 0 && manifest.camera.far > manifest.camera.near, 'invalid reference camera projection')
  requireValue(manifest.display?.displayTransformBaked === false && Number.isFinite(manifest.display.exposureEV), 'scene-linear display contract required')
  requireValue(vector(manifest.environment?.color, 3) && Number.isFinite(manifest.environment.intensity) && manifest.environment.intensity >= 0, 'controlled environment light required')
  return { pages, bindings }
}

export function bindingKey({ receiverId, meshIndex, primitiveIndex }) {
  return `${receiverId}/${meshIndex}/${primitiveIndex}`
}
