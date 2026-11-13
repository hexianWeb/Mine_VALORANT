// The albedo is paint. Metalness near 1 turns those pixels into dark metal and hides the color.
// Keep the gun dielectric with a broad highlight. Character sleeves stay matte.
// These are runtime lookdev defaults; published albedo, UVs and shared templates stay untouched.
export const weaponMaterialProfiles = Object.freeze({
  weapon: Object.freeze({ roughness: 0.42, metalness: 0.80 }),
  scope: Object.freeze({ roughness: 0.48, metalness: 0.16 }),
  armsLeft: Object.freeze({ roughness: 0.96, metalness: 0 }),
  armsRight: Object.freeze({ roughness: 0.96, metalness: 0 }),
})

export function applyWeaponMaterialProfile(material, role) {
  if (material.isMeshStandardMaterial && Object.hasOwn(weaponMaterialProfiles, role))
    Object.assign(material, weaponMaterialProfiles[role])
}
