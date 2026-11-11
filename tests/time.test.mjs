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
