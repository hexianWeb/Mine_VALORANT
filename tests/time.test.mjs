import assert from 'node:assert/strict'
import test from 'node:test'
import { Time } from '../src/engine/runtime/core/time.js'

test('fixed-step cap discards whole excess steps while retaining interpolation remainder', () => {
  const time = new Time()
  time.tick(0)
  time.tick(10)
  assert.equal(time.fixedSteps, 0)
  time.tick(110)
  assert.equal(time.fixedSteps, 5)
  assert.ok(Math.abs(time.alpha - 0.6) < 1e-12)
  assert.ok(Math.abs(time.droppedSimulationTime - 1 / 60) < 1e-12)
  for (let i = 0; i < 5; i++) time.completeFixedStep(i)
  assert.equal(time.fixedTick, 5)
  assert.ok(Math.abs(time.elapsed - time.fixedElapsed - time.alpha * time.fixedDelta - time.droppedSimulationTime) < 1e-12)
  time.tick(1110)
  assert.equal(time.rawDelta, 0.1, 'wall-clock clamp precedes simulation-step capping')
  assert.equal(time.fixedSteps, 5)
  assert.ok(Math.abs(time.alpha - 0.6) < 1e-12)
})

test('scaled time, zero-step frames and visibility resume preserve simulation history', () => {
  const time = new Time()
  time.timeScale = 0.5
  time.tick(0)
  time.tick(20)
  assert.equal(time.delta, 0.01)
  assert.equal(time.fixedSteps, 0)
  const alpha = time.alpha
  time.timeScale = 0
  time.tick(40)
  assert.equal(time.fixedSteps, 0)
  assert.equal(time.alpha, alpha)
  time.timeScale = 1
  time.resetDelta()
  time.tick(5000)
  assert.equal(time.delta, 0)
  assert.equal(time.alpha, alpha)
  time.tick(5010)
  assert.equal(time.fixedSteps, 1)
  const step = time.snapshot(0)
  assert.equal(step.fixedTick, 1)
  assert.equal(time.fixedTick, 0, 'planning a step does not commit simulation time')
  time.completeFixedStep(0)
  assert.equal(time.fixedTick, 1)
  assert.throws(() => time.completeFixedStep(0), /Invalid fixed step/)
})

test('invalid clock configuration is rejected before it can create an infinite fixed loop', () => {
  for (const options of [
    { fixedDelta: 0 },
    { fixedDelta: -1 },
    { fixedDelta: Number.NaN },
    { maxDelta: Infinity },
    { maxFixedSteps: 0 },
    { maxFixedSteps: 1.5 },
  ]) assert.throws(() => new Time(options), /Expected positive/)
  const time = new Time()
  for (const scale of [-1, Infinity, Number.NaN])
    assert.throws(() => { time.timeScale = scale }, /timeScale/)
  assert.throws(() => {
    time.fixedDelta = 0.01
  }, TypeError)
  assert.throws(() => time.tick(Number.NaN), /finite timestamp/)
  assert.equal(time.frame, 0)
})

test('millisecond 60 Hz timestamps do not lose fixed steps to floating-point boundaries', () => {
  const time = new Time()
  time.tick(0)
  for (let frame = 1; frame <= 600; frame++) {
    time.tick(frame * 1000 / 60)
    assert.equal(time.fixedSteps, 1)
    assert.ok(time.alpha >= 0 && time.alpha < 1)
    time.completeFixedStep(0)
  }
  assert.equal(time.fixedTick, 600)
  assert.equal(time.fixedElapsed, 10)
})

test('presentation time starts at zero and interpolates only the history of committed fixed steps', () => {
  const time = new Time({ fixedDelta: 0.02 })
  time.tick(0)
  assert.equal(time.snapshot().presentationTime, 0)
  time.tick(15)
  assert.equal(time.fixedSteps, 0)
  assert.equal(time.snapshot().presentationTime, 0, 'startup cannot expose a negative or uncommitted interval')
  time.tick(25)
  const candidate = time.snapshot(0)
  assert.equal(candidate.fixedElapsed, 0.02)
  assert.equal(candidate.presentationTime, 0, 'a planned fixed step must not advance presentation history')
  time.completeFixedStep(0)
  const first = time.snapshot()
  assert.ok(Math.abs(first.presentationTime - 0.005) < 1e-12)
  assert.ok(Object.isFrozen(first))
  time.tick(30)
  assert.equal(time.fixedSteps, 0)
  assert.ok(Math.abs(time.snapshot().presentationTime - 0.01) < 1e-12, 'zero-step render frames still move through the completed interpolation interval')
  time.tick(40)
  time.completeFixedStep(0)
  assert.ok(Math.abs(time.snapshot().presentationTime - 0.02) < 1e-12)
  assert.equal(candidate.presentationTime, 0, 'published snapshots cannot change when the clock commits')
  assert.ok(Math.abs(first.presentationTime - 0.005) < 1e-12)
})

test('presentation time after capped catch-up excludes dropped simulation time and the newest event boundary', () => {
  const time = new Time({ fixedDelta: 0.02, maxDelta: 1, maxFixedSteps: 5 })
  time.tick(0)
  time.tick(17)
  time.tick(157)
  assert.equal(time.fixedSteps, 5)
  assert.ok(Math.abs(time.droppedSimulationTime - 0.04) < 1e-12)
  const committed = []
  for (let index = 0; index < time.fixedSteps; index++) {
    const before = time.snapshot()
    const candidate = time.snapshot(index)
    assert.equal(candidate.presentationTime, before.presentationTime, 'candidate snapshots must not present the fixed step before postPhysics commits it')
    time.completeFixedStep(index)
    committed.push(time.snapshot().presentationTime)
  }
  assert.ok(committed.every((at, index) => index === 0 || at >= committed[index - 1]))
  const afterCatchUp = time.snapshot()
  assert.ok(Math.abs(afterCatchUp.presentationTime - 0.097) < 1e-12)
  assert.ok(afterCatchUp.presentationTime < 0.1, 'facts at the newest completed tick remain queued for presentation')
  assert.ok(Math.abs(afterCatchUp.elapsed - afterCatchUp.presentationTime - 0.06) < 1e-12, 'the display delay includes one fixed step plus the discarded whole steps')
  time.tick(160)
  assert.equal(time.fixedSteps, 1)
  time.completeFixedStep(0)
  assert.ok(Math.abs(time.snapshot().presentationTime - 0.1) < 1e-12, 'the queued event becomes visible exactly at its simulation timestamp')
})

test('presentation time freezes across pause and visibility reset, then advances with scaled simulation time', () => {
  const time = new Time({ fixedDelta: 0.02 })
  time.timeScale = 0.5
  time.tick(0)
  time.tick(60)
  assert.equal(time.fixedSteps, 1)
  time.completeFixedStep(0)
  const pausedAt = time.snapshot().presentationTime
  assert.ok(Math.abs(pausedAt - 0.01) < 1e-12)
  time.timeScale = 0
  for (const now of [100, 200, 5000]) {
    time.tick(now)
    assert.equal(time.fixedSteps, 0)
    assert.equal(time.snapshot().presentationTime, pausedAt)
  }
  time.resetDelta()
  time.timeScale = 2
  time.tick(10000)
  assert.equal(time.rawDelta, 0)
  assert.equal(time.snapshot().presentationTime, pausedAt, 'the first visible frame must preserve the paused interpolation remainder')
  time.tick(10005)
  assert.equal(time.fixedSteps, 1)
  time.completeFixedStep(0)
  assert.ok(Math.abs(time.snapshot().presentationTime - 0.02) < 1e-12)
  time.tick(10007)
  assert.equal(time.fixedSteps, 0)
  assert.ok(Math.abs(time.snapshot().presentationTime - 0.024) < 1e-12)
})
