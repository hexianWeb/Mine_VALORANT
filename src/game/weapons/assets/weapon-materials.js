// These are runtime lookdev defaults; published albedo, UVs and shared templates stay untouched.
export const weaponMaterialProfiles = Object.freeze({
  weapon: Object.freeze({
    roughness: 1,
    metalness: 1,
    flatShading: true,
    normalMap: null,
  }),
  scope: Object.freeze({ roughness: 0.48, metalness: 0.16 }),
  armsLeft: Object.freeze({ roughness: 0.96, metalness: 0 }),
  armsRight: Object.freeze({ roughness: 0.96, metalness: 0 }),
})

/** Shared descriptor contract for publication and runtime loading. */
export function validateWeaponSkinMaterial(input, role) {
  if (!['weapon', 'scope'].includes(role) || !input?.map
    || Object.keys(input).some(key => !['map', 'emissiveMap', 'emissiveIntensity'].includes(key))) {
    throw new TypeError('[WeaponAssets] Unsupported skin material inputs')
  }
  for (const channel of ['map', 'emissiveMap']) {
    const map = input[channel]
    if (map === undefined)
      continue
    if (!map || typeof map.url !== 'string' || !map.url.trim() || map.colorSpace !== 'srgb'
      || map.flipY !== false || map.magFilter !== 'nearest' || map.minFilter !== 'nearest'
      || map.generateMipmaps !== false) {
      throw new TypeError('[WeaponAssets] Unsupported skin map sampling profile')
    }
  }
  if (input.emissiveIntensity !== undefined
    && (!input.emissiveMap || !Number.isFinite(input.emissiveIntensity) || input.emissiveIntensity < 0)) {
    throw new TypeError('[WeaponAssets] Invalid emissiveIntensity')
  }
}

export function applyWeaponMaterialProfile(material, role) {
  if (!material.isMeshStandardMaterial || !Object.hasOwn(weaponMaterialProfiles, role))
    return
  Object.assign(material, weaponMaterialProfiles[role])
  if (role === 'weapon' && material.isMeshPhysicalMaterial)
    material.clearcoatRoughness = 0.18
  if (role === 'weapon' || role === 'scope') {
    // WebGPU merges samples for identical textures at shader build time.
    const originalKey = material.customProgramCacheKey
    material.customProgramCacheKey = function () {
      const sharedMap = this.map !== null && this.map === this.emissiveMap
      return `${originalKey.call(this)}:sharedSkinMap=${sharedMap}`
    }
  }
}
