import assert from 'node:assert/strict'
import test from 'node:test'
import { Euler, Quaternion, Vector3 } from 'three/webgpu'
import { Time } from '../src/engine/runtime/core/time.js'
import { AimState } from '../src/game/player/aim-state.js'
import { classicAimProfile, createAimProfile, phantomAimProfile } from '../src/game/weapons/aim-profile.js'
import { classicDefinition } from '../src/game/weapons/definitions/classic.js'
import { phantomDefinition } from '../src/game/weapons/definitions/phantom.js'
import { createWeaponDefinition } from '../src/game/weapons/weapon-definition.js'

const close = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} vs ${expected}`)
function definition(overrides) {
  return {
    capabilities: { ads: true },
    ...createAimProfile({
      recoil: {
        pitch: [
          { time: 0, min: 0.1, max: 0.1 },
          { time: 1, min: 0, max: 0 },
        ],
        yaw: [],
      },
      ...overrides,
    }),
  }
}
function step(aim, at, options = {}) {
  return aim.beginStep({
    at,
    delta: 0.1,
    feet: [0, 0, 0],
    ...options,
  })
}

test('look is pending until fixed commit, heading is available to movement, and look is consumed only once', () => {
  const aim = new AimState({ maxPitch: 0.8 })
  const initial = aim.sample(0)
  aim.queueLook(0.3, 10)
  close(aim.headingYaw, 0.3)
  assert.deepEqual(aim.sample(0), initial)
  close(aim.yaw, 0)
  step(aim, 0.1)
  close(aim.yaw, 0.3)
  close(aim.pitch, 0.8)
  assert.deepEqual(aim.sample(0.1), initial, 'beginStep is not a published completed view')
  aim.endStep()
  const pose = aim.sample(0.1)
  for (let tick = 2; tick <= 5; tick++) {
    step(aim, tick / 10)
    aim.endStep()
  }
  close(aim.yaw, 0.3)
  close(aim.pitch, 0.8)
  aim.queueLook(1, -1)
  aim.clearInput()
  close(aim.headingYaw, 0.3)
  assert.deepEqual(aim.sample(0.1), pose)
})

test('the accepted ray uses pre-shot aim and the recoil impulse never appears before its event boundary', () => {
  const aim = new AimState()
  const gun = definition()
  step(aim, 0.1, { definition: gun })
  const shot = aim.fire({ instanceId: 'first', shotSequence: 1, definition: gun })
  const after = aim.endStep()
  assert.deepEqual(shot.aimDirection, [0, 0, -1])
  assert.deepEqual(shot.shotDirection, shot.aimDirection)
  assert.deepEqual(shot.eyeOrigin, [0, 1.62, 0])
  close(aim.sample(0.099999).pitch, 0)
  close(aim.sample(0.1).pitch, 0.1)
  close(after.pitch, 0.1)
  assert.equal(after.basePitch, 0)
  const beforeSampling = aim.sample(0.1)
  for (let index = 0; index < 5; index++) assert.deepEqual(aim.sample(0.1), beforeSampling)
  step(aim, 0.2, { definition: null })
  aim.endStep()
  close(aim.sample(0.15).pitch, 0.095)
  close(aim.sample(0.2).pitch, 0.09, 1e-9)
  for (let tick = 3; tick <= 12; tick++) {
    step(aim, tick / 10)
    aim.endStep()
  }
  close(aim.sample(1.2).pitch, 0)
})

test('same-time shots use the preceding accepted impulse and reject duplicate shot identities', () => {
  const aim = new AimState()
  const gun = definition()
  step(aim, 0.1, { definition: gun })
  const first = aim.fire({ instanceId: 'A', shotSequence: 1, definition: gun })
  const second = aim.fire({ instanceId: 'A', shotSequence: 2, definition: gun })
  close(first.aimDirection[1], 0)
  close(second.aimDirection[1], Math.sin(0.1))
  assert.throws(() => aim.fire({ instanceId: 'A', shotSequence: 2, definition: gun }), /new accepted shot/)
  close(aim.endStep().pitch, 0.2)
})

test('eye and step smoothing advance once per fixed step, while shot safety is evaluated on both sides', () => {
  const checks = []
  const aim = new AimState({
    verticalOffset: 1.8,
    offsetSmoothing: 12,
    stepSmoothingTime: 0.1,
    limitStepOffset(pose, offset) {
      checks.push({ pose, offset })
      return pose.quaternion[0] > 0
        ? 0
        : Math.min(offset, 0.03)
    },
  })
  step(aim, 0.1, {
    feet: [0, -0.5, 0],
    verticalOffset: 1.2,
    stepDeltaY: -0.5,
    definition: definition(),
  })
  const shot = aim.fire({
    instanceId: 'A',
    shotSequence: 1,
    definition: definition(),
  })
  const pose = aim.endStep()
  assert.equal(checks.length, 2)
  const expectedEye = 1.2 + 0.6 * Math.exp(-1.2)
  close(pose.verticalOffset, expectedEye)
  close(shot.eyeOrigin[1], -0.5 + expectedEye + 0.03)
  close(pose.position[1], -0.5 + expectedEye)
  aim.sample(0.05)
  aim.sample(0.1)
  assert.equal(checks.length, 2, 'sampling does not rerun world queries')
  step(aim, 0.2, {
    feet: [0, -0.5, 0],
    verticalOffset: 1.2,
    stepDeltaY: -0.5,
  })
  close(aim.endStep().stepOffset, 0, 1e-9)
})

test('history uses shortest quaternion interpolation and reset collapses every previous view', () => {
  const aim = new AimState()
  aim.reset({
    feet: [0, 0, 0],
    yaw: Math.PI - 0.1,
    pitch: -0.2,
    at: 0,
  })
  const from = new Quaternion().fromArray(aim.sample(0).quaternion)
  aim.queueLook(0.2, 0.4)
  step(aim, 0.1, {
    feet: [1, 0, 0],
  })
  const to = new Quaternion().fromArray(aim.endStep().quaternion)
  const midpoint = aim.sample(0.05)
  const expected = from.clone().slerp(to, 0.5)
  assert.ok(expected.angleTo(new Quaternion().fromArray(midpoint.quaternion)) < 1e-7)
  close(midpoint.position[0], 0.5)
  aim.reset({
    feet: [100, 2, 3],
    yaw: 1,
    pitch: 0.2,
    at: 20,
  })
  assert.deepEqual(aim.sample(0).position, [100, 3.62, 3])
  assert.deepEqual(aim.sample(100).position, [100, 3.62, 3])
  close(aim.headingYaw, 1)
  close(aim.sample(20).recoilPitch, 0)
})

test('rebase preserves the current pose and newly queued look while starting a fresh interpolation interval', () => {
  const aim = new AimState()
  const gun = definition()
  step(aim, 0.1, { definition: gun })
  aim.fire({ instanceId: 'A', shotSequence: 1, definition: gun })
  const previous = aim.endStep()
  aim.queueLook(Math.PI / 2, 0)
  aim.rebase(10)
  assert.deepEqual(aim.sample(10).position, previous.position)
  assert.deepEqual(aim.sample(10).quaternion, previous.quaternion)
  close(aim.headingYaw, Math.PI / 2)
  close(aim.yaw, 0)
  step(aim, 10.1, { definition: gun })
  aim.endStep()
  const partial = aim.sample(10.022)
  close(partial.baseYaw, Math.PI / 2 * 0.22)
  close(partial.recoilPitch, 0.0978)
  close(aim.yaw, Math.PI / 2)
  step(aim, 10.2, { definition: gun })
  aim.endStep()
  close(aim.yaw, Math.PI / 2, 1e-10)
})

test('ADS is an explicit capability and stance spread does not perturb the camera', () => {
  const aim = new AimState({ worldFov: 78, viewmodelFov: 70 })
  step(aim, 0.1, { aim: true, definition: classicDefinition })
  let pose = aim.endStep()
  assert.equal(pose.ads, 0)
  assert.equal(pose.worldFov, 78)
  step(aim, 0.2, { aim: true, definition: phantomDefinition })
  pose = aim.endStep()
  close(pose.ads, 2 / 3)
  close(pose.worldFov, 56)
  step(aim, 0.3, { aim: true, definition: phantomDefinition })
  pose = aim.endStep()
  assert.equal(pose.worldFov, 45)
  assert.equal(pose.viewmodelFov, 45)
  assert.equal(pose.spread, phantomAimProfile.spread.ads)
  close(pose.pitch, 0)
  step(aim, 0.4, { definition: phantomDefinition, moving: true })
  pose = aim.endStep()
  assert.equal(pose.spread, phantomAimProfile.spread.move)
  close(pose.pitch, 0)
})

test('fixed shots, seeds, recovery and smoothing are identical at 30/60/144 FPS', () => {
  function run(fps) {
    const time = new Time()
    const aim = new AimState({ seed: 123 })
    aim.queueLook(0.2, 0.1)
    const shots = []
    let sequence = 0
    time.tick(0)
    for (let frame = 1; frame <= fps * 2; frame++) {
      time.tick(frame * 1000 / fps)
      for (let index = 0; index < time.fixedSteps; index++) {
        const context = time.snapshot(index)
        aim.beginStep({
          at: context.fixedElapsed,
          delta: context.fixedDelta,
          feet: [context.fixedElapsed, 0, 0],
          verticalOffset: 1.2,
          aim: context.fixedTick > 60,
          definition: phantomDefinition,
        })
        if (context.fixedTick % 10 === 0)
          shots.push(aim.fire({ instanceId: 'rifle', shotSequence: ++sequence, definition: phantomDefinition }))
        aim.endStep()
        time.completeFixedStep(index)
      }
      aim.sample(Math.max(0, time.fixedElapsed - time.fixedDelta + time.alpha * time.fixedDelta))
    }
    return {
      shots,
      view: aim.sample(2),
      yaw: aim.yaw,
      pitch: aim.pitch,
    }
  }
  assert.deepEqual(run(30), run(60))
  assert.deepEqual(run(144), run(60))
})

test('canonical profile validation copies data and source conversions are explicit', () => {
  const raw = structuredClone(phantomAimProfile)
  const copied = createAimProfile(raw)
  raw.recoil.pitch[0].min = 99
  assert.notEqual(copied.recoil.pitch[0].min, 99)
  assert.ok(Object.isFrozen(copied.recoil.pitch[0]))
  close(classicAimProfile.recoil.pitch[0].min, 0.3 * Math.PI / 180)
  close(phantomAimProfile.spread.stand, 0.2 * 0.0172275)
  for (const mutate of [
    source => source.recoil.pitch[0].time = 0.1,
    source => source.recoil.pitch[1].time = 0,
    source => source.recoil.pitch.at(-1).max = 1,
    source => source.spread.stand = -1,
    source => source.aim.worldFov = 180,
  ]) {
    const source = structuredClone(phantomDefinition)
    mutate(source)
    assert.throws(() => createWeaponDefinition(source))
  }
  const empty = structuredClone(classicDefinition)
  delete empty.recoil
  delete empty.spread
  delete empty.aim
  assert.deepEqual(createWeaponDefinition(empty).recoil, { pitch: [], yaw: [] })
})

test('pose and shot data are immutable and no sample advances pending input or random state', () => {
  const aim = new AimState({ seed: 99 })
  aim.queueLook(0.4, 0.2)
  assert.throws(() => {
    aim.sample(0).position[0] = 2
  }, TypeError)
  step(aim, 0.1, { definition: phantomDefinition })
  const shot = aim.fire({ instanceId: 'A', shotSequence: 1, definition: phantomDefinition })
  const pose = aim.endStep()
  const direction = new Vector3(0, 0, -1).applyQuaternion(new Quaternion().setFromEuler(new Euler(0.2, 0.4, 0, 'YXZ')))
  for (let axis = 0; axis < 3; axis++) close(shot.aimDirection[axis], direction.toArray()[axis])
  assert.throws(() => {
    shot.eyeOrigin[0] = 999
  }, TypeError)
  for (let index = 0; index < 10; index++) assert.deepEqual(aim.sample(0.1), pose)
  assert.throws(() => aim.endStep(), /requires/)
  assert.throws(() => step(aim, 0.3), /next complete fixed step/)
  assert.deepEqual(aim.sample(0.1), pose)
})
