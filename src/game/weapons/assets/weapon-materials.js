// The albedo is paint. Metalness near 1 turns those pixels into dark metal and hides the color.
// Keep the gun dielectric with a broad highlight. Character sleeves stay matte.
// These are runtime lookdev defaults; published albedo, UVs and shared templates stay untouched.
export const weaponMaterialProfiles = Object.freeze({
  weapon: Object.freeze({ roughness: 0.42, metalness: 0.80 }),
  scope: Object.freeze({ roughness: 0.48, metalness: 0.16 }),
  armsLeft: Object.freeze({ roughness: 0.96, metalness: 0 }),
  armsRight: Object.freeze({ roughness: 0.96, metalness: 0 }),
})

/** Shared descriptor contract for tooling; this does not change runtime material appearance. */
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
  if (material.isMeshStandardMaterial && Object.hasOwn(weaponMaterialProfiles, role))
    Object.assign(material, weaponMaterialProfiles[role])
}
