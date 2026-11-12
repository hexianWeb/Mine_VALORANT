/** Explicit display thresholds, not a guessed rounds/duration ratio or a new gameplay clock. */
export function validateAmmoDisplay(manifest, library) {
  const profile = manifest.ammoDisplay
  if (profile === undefined)
    return
  if (!profile || typeof profile.control !== 'string' || !Array.isArray(profile.levels)
    || !profile.levels.length || Object.keys(profile).some(key => !['control', 'levels'].includes(key))) {
    throw new Error('[WeaponAssets] Invalid ammo display profile')
  }
  const { clip } = library.getControl(profile.control)
  let previous = -1
  for (const level of profile.levels) {
    if (!level || !Number.isSafeInteger(level.minimum) || level.minimum <= previous
      || (previous === -1 && level.minimum !== 0) || !Number.isFinite(level.time)
      || level.time < 0 || level.time > clip.duration
      || Object.keys(level).some(key => !['minimum', 'time'].includes(key))) {
      throw new Error('[WeaponAssets] Invalid ammo display level')
    }
    previous = level.minimum
  }
}

export function ammoControlSamples(manifest, magazine) {
  const profile = manifest.ammoDisplay
  if (!profile)
    return {}
  if (!Number.isSafeInteger(magazine) || magazine < 0)
    throw new RangeError('[WeaponViewModel] Invalid presented magazine')
  const level = profile.levels.findLast(level => magazine >= level.minimum)
  return { [profile.control]: level.time }
}
