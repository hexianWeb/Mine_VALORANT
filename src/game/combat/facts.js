/** Detach gameplay facts from mutable targets, transforms, and caller-owned arrays. */
export function immutableFact(value) {
  if (Array.isArray(value))
    return Object.freeze(value.map(immutableFact))
  if (value && typeof value === 'object') {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      immutableFact(item),
    ])))
  }
  return value
}

export function identifier(value, name) {
  if (typeof value !== 'string' || !value.length)
    throw new TypeError(`[Combat] Invalid ${name}`)
  return value
}

export function fixedTime(context, phase = null) {
  const time = context?.time ?? context
  if (!Number.isSafeInteger(time?.fixedTick) || time.fixedTick < 1
    || !Number.isFinite(time.fixedDelta) || time.fixedDelta <= 0
    || !Number.isFinite(time.fixedElapsed)
    || Math.abs(time.fixedElapsed - time.fixedTick * time.fixedDelta) > 1e-9 * Math.max(1, time.fixedElapsed)
    || (time.timeScale !== undefined && (!Number.isFinite(time.timeScale) || time.timeScale <= 0))
    || (phase && context.phase !== undefined && context.phase !== phase)
    || (time.fixedStepIndex !== undefined && (!Number.isSafeInteger(time.fixedStepIndex) || time.fixedStepIndex < 0
      || !Number.isSafeInteger(time.fixedSteps) || time.fixedSteps <= time.fixedStepIndex || time.completedFixedSteps !== time.fixedStepIndex))) {
    throw new RangeError('[Combat] Expected a valid, advancing fixed step')
  }
  return time
}

export function sameSpawn(a, b) {
  return !!a && !!b && a.sessionId === b.sessionId && a.spawnId === b.spawnId
}

export function deathOrder(a, b) {
  return a.pelletIndex - b.pelletIndex || a.targetId.localeCompare(b.targetId) || a.spawnId.localeCompare(b.spawnId)
}
