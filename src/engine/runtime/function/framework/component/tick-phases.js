/** 阶段时钟；Engine 显式决定阶段顺序，Level 负责扫描和分发。 */
const phaseClocks = Object.freeze({
  input: 'frame',
  fixed: 'fixed',
  postPhysics: 'fixed',
  motion: 'frame',
  presentation: 'frame',
})

export function validateComponentPhases(component) {
  const phases = component.phases
  if (!Array.isArray(phases) || new Set(phases).size !== phases.length)
    throw new Error('[Component] phases must be an array without duplicates')
  for (const phase of phases) assertPhase(phase)
}

export function createTickContext(phase, frame) {
  assertPhase(phase)
  const time = Object.isFrozen(frame.time)
    ? frame.time
    : frame.time.snapshot?.() ?? Object.freeze({ ...frame.time })
  return Object.freeze({
    ...frame,
    phase,
    time,
    delta: phaseClocks[phase] === 'fixed'
      ? time.fixedDelta
      : time.delta,
  })
}

function assertPhase(phase) {
  if (typeof phase !== 'string' || !Object.hasOwn(phaseClocks, phase))
    throw new Error(`[Component] Unknown tick phase: ${String(phase)}`)
}
