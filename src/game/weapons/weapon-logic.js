/** Durations round up once, avoiding a floating-point extra tick at exact boundaries. */
export function durationTicks(seconds, fixedDelta) {
  return Math.ceil(seconds / fixedDelta - 1e-10)
}

export function canReloadWeapon(weapon, definition) {
  return weapon.magazine < definition.capacity && weapon.reserve > 0
}

/** Only this transfer changes both ammo stores; the controller owns commit idempotency. */
export function commitReload(weapon, definition, recoveryUntil) {
  const amount = Math.min(definition.capacity - weapon.magazine, weapon.reserve)
  return {
    amount,
    patch: {
      magazine: weapon.magazine + amount,
      reserve: weapon.reserve - amount,
      blockedUntil: Math.max(weapon.blockedUntil, recoveryUntil),
    },
  }
}

/** No ray or visual side effects. Aim/recoil integration is a separate implementation step. */
export function fireWeapon(weapon, definition, now, continuingAutomaticFire = false) {
  const cadenceStart = continuingAutomaticFire
    ? Math.max(weapon.nextFireAt, now - definition.fire.interval)
    : now
  return {
    magazine: weapon.magazine - 1,
    shotSequence: weapon.shotSequence + 1,
    nextFireAt: cadenceStart + definition.fire.interval,
  }
}
