/** Durations round up once, avoiding a floating-point extra tick at exact boundaries. */
export function durationTicks(seconds, fixedDelta) {
  return Math.ceil(seconds / fixedDelta - 1e-10)
}

export function validateAmmoPolicy(policy) {
  if (!['finite', 'infinite-reserve'].includes(policy))
    throw new RangeError('[Weapon] Unknown ammoPolicy')
  return policy
}

export function canReloadWeapon(weapon, definition, ammoPolicy = 'finite') {
  validateAmmoPolicy(ammoPolicy)
  return weapon.magazine < definition.capacity && (ammoPolicy === 'infinite-reserve' || weapon.reserve > 0)
}

/** Only this transfer changes both ammo stores; the controller owns commit idempotency. */
export function commitReload(weapon, definition, recoveryUntil, ammoPolicy = 'finite') {
  validateAmmoPolicy(ammoPolicy)
  const infinite = ammoPolicy === 'infinite-reserve'
  const amount = Math.min(definition.capacity - weapon.magazine, infinite ? definition.capacity : weapon.reserve)
  return {
    amount,
    patch: {
      magazine: weapon.magazine + amount,
      reserve: infinite
        ? weapon.reserve
        : weapon.reserve - amount,
      blockedUntil: Math.max(weapon.blockedUntil, recoveryUntil),
    },
  }
}

function fireInterval(fire, aiming, elapsed) {
  if (aiming && fire.adsInterval !== undefined)
    return fire.adsInterval
  if (!fire.spinUp || elapsed <= 0)
    return fire.interval
  const progress = Math.min(elapsed / fire.spinUp.duration, 1)
  return 1 / ((1 - progress) / fire.interval + progress / fire.spinUp.interval)
}

/** Advance ammo and the next shot deadline on the fixed-step cadence clock. */
export function fireWeapon(weapon, definition, now, { aiming, burstStartedAt, salvo = false }) {
  if (salvo) {
    return {
      magazine: weapon.magazine - Math.min(weapon.magazine, definition.fire.salvo.rounds),
      shotSequence: weapon.shotSequence + 1,
      nextFireAt: now + definition.fire.salvo.interval,
    }
  }
  const continuing = burstStartedAt !== null
  const elapsed = continuing
    ? weapon.nextFireAt - burstStartedAt
    : 0
  const interval = fireInterval(definition.fire, aiming, elapsed)
  const cadenceStart = continuing
    ? Math.max(weapon.nextFireAt, now - interval)
    : now
  return {
    magazine: weapon.magazine - 1,
    shotSequence: weapon.shotSequence + 1,
    nextFireAt: cadenceStart + interval,
  }
}
