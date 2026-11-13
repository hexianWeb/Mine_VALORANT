const fields = [
  'roughness',
  'metalness',
  'flatShading',
  'clearcoatRoughness',
  'emissiveIntensity',
  'normalMap',
  'envMap',
  'envMapIntensity',
]
const metalness = 1
const emissionStrength = 0.4
const clearcoatRoughness = 0.18
const defaults = Object.freeze({
  enabled: true,
  roughness: 1,
  flatShading: true,
  source: 'indoor',
  intensity: 0.3,
})
const isSample = handle => handle.weaponId === 'classic' && handle.assetVersion === 'v4' && handle.skinId === 'ag'

/** Scoped lookdev policy: borrow scene reflections, never mutate source assets or arms. */
export function createWeaponMaterialStudy({ scene, reflection = null, error = null }) {
  const settings = { ...defaults }
  const attachments = new Set()
  const subscribers = new Set()
  let resolvedSource = 'inactive'
  let disposed = false
  const apply = (entry, handle) => {
    const { material, original, emission } = entry
    const active = !disposed && settings.enabled && isSample(handle)
    const values = { ...original }
    if (active) {
      const indoor = settings.source === 'indoor' && reflection?.texture
      resolvedSource = settings.source === 'off'
        ? 'off'
        : indoor ? 'indoor' : 'sky'
      values.envMap = indoor ? reflection.texture : scene.environment
      const baseIntensity = indoor
        ? Number(reflection.enabled) * settings.intensity
        : scene.environmentIntensity
      values.envMapIntensity = settings.source === 'off'
        ? 0
        : baseIntensity
      values.roughness = settings.roughness
      values.metalness = metalness
      values.clearcoatRoughness = clearcoatRoughness
      // Without an emissive map a white emissive color would light the whole gun uniformly.
      values.emissiveIntensity = material.emissiveMap ? emissionStrength : 0
      values.normalMap = null
      values.flatShading = settings.flatShading
    }
    const structural = material.flatShading !== values.flatShading || material.envMap !== values.envMap
      || material.normalMap !== values.normalMap
    for (const field of fields) material[field] = values[field]
    if (active)
      material.emissive.setScalar(1)
    else material.emissive.copy(emission)
    if (structural)
      material.needsUpdate = true
  }
  const refresh = () => {
    resolvedSource = 'inactive'
    for (const attachment of attachments) {
      for (const entry of attachment.entries) apply(entry, attachment.handle)
    }
  }
  const api = {
    attach(root, handle, roles) {
      if (disposed)
        throw new Error('[Weapon study] Disposed')
      if (handle.weaponId !== 'classic' || handle.assetVersion !== 'v4')
        return null
      const entries = new Map()
      const attachment = { entries: [], handle }
      root.traverse((object) => {
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material]
        const selected = materials.filter(material => material?.isMeshStandardMaterial && roles.get(material.name) === 'weapon')
        if (!selected.length)
          return
        for (const material of selected) {
          if (!entries.has(material)) {
            entries.set(material, {
              material,
              original: Object.fromEntries(fields.map(key => [key, material[key]])),
              emission: material.emissive.clone(),
            })
          }
        }
      })
      attachment.entries = [
        ...entries.values(),
      ]
      attachments.add(attachment)
      refresh()
      return {
        setSkin(next) {
          attachment.handle = next
          refresh()
        },
        dispose() {
          if (!attachments.delete(attachment))
            return
          for (const entry of attachment.entries) apply(entry, { ...attachment.handle, skinId: '' })
          refresh()
        },
      }
    },
    setLighting(changes) {
      if (disposed)
        throw new Error('[Weapon study] Disposed')
      for (const [key, value] of Object.entries(changes)) {
        if (!Object.hasOwn(defaults, key)
          || (['enabled', 'flatShading'].includes(key) && typeof value !== 'boolean')
          || (key === 'source' && !['indoor', 'sky', 'off'].includes(value))
          || (key === 'roughness' && (!Number.isFinite(value) || value < 0.08 || value > 1))
          || (key === 'intensity' && (!Number.isFinite(value) || value < 0 || value > 2))) {
          throw new Error(`[Weapon study] Invalid ${key}`)
        }
      }
      Object.assign(settings, changes)
      refresh()
      for (const listener of subscribers) listener(api.getDebugState())
    },
    refresh,
    getDebugState: () => ({
      ...settings,
      resolvedSource,
      scope: 'classic/v4/ag',
      attachments: attachments.size,
      materials: [...attachments].reduce((n, a) => n + a.entries.length, 0),
      reflection: reflection?.getDebugState() ?? {
        ready: false,
        error,
        source: 'sky-fallback',
        captures: 0,
      },
    }),
    subscribe(listener) {
      subscribers.add(listener)
      return () => subscribers.delete(listener)
    },
    dispose() {
      if (disposed)
        return
      disposed = true
      refresh()
      subscribers.clear()
      // WeaponAssets detaches bindings before its instance materials are disposed.
    },
  }
  return api
}
