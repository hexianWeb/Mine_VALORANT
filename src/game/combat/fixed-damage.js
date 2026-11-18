import { immutableFact } from './facts.js'

export const rangeDamageVersion = 'range-challenges-v2-2026-11-17'

// Project-fixed nearest-range values, NOT a runtime API or a distance curve.
export const fixedWeaponDamage = immutableFact({
  classic: { head: 78, body: 26, legs: 22.1 },
  ghost: { head: 105, body: 30, legs: 25.5 },
  sheriff: { head: 159.5, body: 55, legs: 46.75 },
  phantom: { head: 156, body: 39, legs: 33.15 },
  bulldog: { head: 115.5, body: 35, legs: 29.75 },
  vandal: { head: 160, body: 40, legs: 34 },
  judge: { head: 34, body: 17, legs: 14.45 },
  odin: { head: 95, body: 38, legs: 32.3 },
  karambit: { head: 50, body: 50, legs: 50 },
})

// The existing profile assigns pelvis to chest and both upper/lower arms to arm_*.
export const hitRegionDamage = Object.freeze({
  head: 'head',
  chest: 'body',
  arm_l: 'body',
  arm_r: 'body',
  leg_l: 'legs',
  leg_r: 'legs',
})

export function fixedDamage(definitionId, region) {
  const part = Object.hasOwn(hitRegionDamage, region) && hitRegionDamage[region]
  const amount = Object.hasOwn(fixedWeaponDamage, definitionId) && fixedWeaponDamage[definitionId][part]
  if (!Number.isFinite(amount) || amount <= 0)
    throw new RangeError(`[Damage] Missing fixed damage: ${definitionId}/${region}`)
  return amount
}

export function validateDamageProfile(profile, definitionIds = Object.keys(fixedWeaponDamage)) {
  if (!profile?.parts?.length || !profile.regions)
    throw new TypeError('[Damage] Missing hitbox profile')
  for (const region of [
    ...Object.keys(profile.regions),
    ...profile.parts.map(part => part.region),
  ]) {
    for (const definitionId of definitionIds) fixedDamage(definitionId, region)
  }
}
