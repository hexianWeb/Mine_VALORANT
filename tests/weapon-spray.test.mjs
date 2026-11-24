import assert from 'node:assert/strict'
import test from 'node:test'
import { AimState } from '../src/game/player/aim-state.js'
import { classicAimProfile, createAimProfile } from '../src/game/weapons/aim-profile.js'
import { classicDefinition } from '../src/game/weapons/definitions/classic.js'
import { ghostDefinition } from '../src/game/weapons/definitions/ghost.js'
import { phantomDefinition } from '../src/game/weapons/definitions/phantom.js'
import { sheriffDefinition } from '../src/game/weapons/definitions/sheriff.js'
import { vandalDefinition } from '../src/game/weapons/definitions/vandal.js'
import { fireWeapon } from '../src/game/weapons/weapon-logic.js'

const radians = Math.PI / 180
const delta = 1 / 60
const definition = { ...phantomDefinition, spread: createAimProfile().spread }
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} vs ${expected}`)

function step(aim, at, instanceId, gun = definition, stepDuration = delta) {
  return aim.beginStep({
    at,
    delta: stepDuration,
    feet: [0, 0, 0],
    definition: gun,
    instanceId,
  })
}

function burst(gun, seed, { compensate = false, aiming = false, ticksPerTap = 1 } = {}) {
  const aim = new AimState({ seed })
  const weapon = { magazine: gun.capacity, shotSequence: 0, nextFireAt: 0 }
  const automatic = gun.fire.mode === 'auto'
  let burstStartedAt = null
  const rays = []
  for (let tick = 1; weapon.magazine > 0 && tick <= 600; tick++) {
    const at = tick * delta
    const fires = at + 1e-10 >= weapon.nextFireAt && (automatic || (tick - 1) % ticksPerTap === 0)
    if (fires && compensate) {
      const prior = aim.sample((tick - 1) * delta)
      aim.queueLook(-prior.yaw, -prior.pitch)
    }
    aim.beginStep({
      at,
      delta,
      feet: [0, 0, 0],
      definition: gun,
      instanceId: gun.id,
      aim: aiming,
    })
    if (fires) {
      Object.assign(weapon, fireWeapon(weapon, gun, at, { aiming, burstStartedAt }))
      if (automatic)
        burstStartedAt ??= at
      const shot = aim.fire({ instanceId: gun.id, shotSequence: weapon.shotSequence, definition: gun })
      rays.push(shot.shotDirection)
    }
    aim.endStep()
  }
  assert.equal(rays.length, gun.capacity)
  return rays
}

test('the Phantom pattern is repeatable with spread off and can be cancelled with mouse look', () => {
  const rays = burst(definition, 123)
  assert.deepEqual(rays, burst(definition, 456))
  assert.deepEqual(rays[0], [0, 0, -1])
  close(Math.asin(rays[7][1]), 3.8 * radians)
  close(Math.asin(rays[11][1]), 5.1 * radians)
  assert.ok(rays[11][0] > 0 && rays[17][0] < 0 && rays[23][0] > 0)
  close(Math.asin(rays.at(-1)[1]), 5.1 * radians)
  for (const ray of burst(definition, 123, { compensate: true })) {
    close(ray[0], 0)
    close(ray[1], 0)
    close(ray[2], -1)
  }
})

test('Vandal has a stronger, distinct spray that stays predictable at its ADS and hip-fire cadences', () => {
  const gun = { ...vandalDefinition, spread: definition.spread }
  const rays = burst(gun, 123)
  assert.deepEqual(rays, burst(gun, 456))
  const ads = burst(gun, 123, { aiming: true })
  for (const [index, ray] of rays.entries()) {
    for (const [axis, value] of ray.entries()) close(value, ads[index][axis])
  }
  assert.deepEqual(rays[0], [0, 0, -1])
  close(Math.asin(rays[9][1]), 6.5 * radians)
  close(Math.asin(rays[12][1]), 6.8 * radians)
  assert.ok(rays[12][0] < 0 && rays[16][0] > 0 && rays[20][0] < 0)
  const phantom = burst(definition, 123)
  assert.ok(rays[3][1] > phantom[3][1])
  for (const ray of burst(gun, 123, { compensate: true })) {
    close(ray[0], 0)
    close(ray[1], 0)
    close(ray[2], -1)
  }
})

test('Ghost caps its rapid-tap recoil by the fifth shot and fully recovers between paced taps', () => {
  const gun = { ...ghostDefinition, spread: definition.spread }
  const quick = burst(gun, 123)
  assert.deepEqual(quick, burst(gun, 456))
  assert.deepEqual(quick[0], [0, 0, -1])
  close(Math.asin(quick[1][1]), 0.35 * radians)
  close(Math.asin(quick[2][1]), 0.95 * radians)
  close(Math.asin(quick[4][1]), 2.25 * radians)
  assert.ok(quick[4][0] < 0)
  for (const ray of quick.slice(4))
    close(Math.asin(ray[1]), 2.25 * radians)
  for (const ray of burst(gun, 123, { ticksPerTap: 24 }))
    assert.deepEqual(ray, [0, 0, -1])
})

test('Classic keeps primary rapid taps mild and nearly vertical', () => {
  const gun = { ...classicDefinition, spread: definition.spread }
  const quick = burst(gun, 123)
  assert.deepEqual(quick[0], [0, 0, -1])
  close(Math.asin(quick[1][1]), 0.3 * radians)
  close(Math.asin(quick[3][1]), 1.6 * radians)
  close(Math.asin(quick.at(-1)[1]), 1.6 * radians)
  assert.ok(quick.every(ray => Math.abs(ray[0]) < 0.002))
  for (const ray of burst(gun, 123, { ticksPerTap: 21 }))
    assert.deepEqual(ray, [0, 0, -1])
})

test('Classic right-click keeps one isolated legacy kick and does not advance primary recoil', () => {
  function salvo(gun, pelletCount) {
    const aim = new AimState({ seed: 123 })
    step(aim, 0.1, gun.id, gun, 0.1)
    const shot = aim.fire({
      instanceId: gun.id,
      shotSequence: 1,
      definition: gun,
      pelletCount,
      salvo: true,
    })
    const pose = aim.endStep()
    return { aim, shot, pose }
  }
  const legacy = { ...classicDefinition, recoil: classicAimProfile.recoil }
  for (const count of [1, 2, 3]) {
    const expected = salvo(legacy, count)
    const { aim, shot, pose } = salvo(classicDefinition, count)
    assert.deepEqual(shot, expected.shot)
    assert.deepEqual(pose, expected.pose)
    // Probe the aim state before the kick expires; the equipment controller separately enforces cooldown.
    step(aim, 0.2, classicDefinition.id, classicDefinition, 0.1)
    const primary = aim.fire({ instanceId: classicDefinition.id, shotSequence: 2, definition: classicDefinition })
    close(primary.impulse.pitch, 0.3 * radians)
    close(primary.impulse.yaw, 0)
    aim.endStep()
  }
})

test('Sheriff has stronger vertical kick that partly recovers before the next legal tap', () => {
  const gun = { ...sheriffDefinition, spread: definition.spread }
  const quick = burst(gun, 123)
  assert.deepEqual(quick[0], [0, 0, -1])
  close(Math.asin(quick[1][1]), 2.2 * (0.25 / 0.3) * radians)
  close(Math.asin(quick.at(-1)[1]), 3.5 * radians)
  assert.ok(quick.every(ray => Math.abs(ray[0]) < 0.003))
  for (const ray of burst(gun, 123, { ticksPerTap: 31 }))
    assert.deepEqual(ray, [0, 0, -1])
})

test('a spray is instance-local, uses shot boundaries, and recovers on the simulation clock', () => {
  const aim = new AimState()
  const h = 0.05
  const fire = (at, instanceId, shotSequence) => {
    step(aim, at, instanceId, definition, h)
    const shot = aim.fire({ instanceId, shotSequence, definition })
    aim.endStep()
    return shot
  }
  assert.deepEqual(fire(h, 'first', 1).aimDirection, [0, 0, -1])
  close(aim.sample(h - 0.001).recoilPitch, 0)
  close(aim.sample(h).recoilPitch, 0.4 * radians)
  assert.deepEqual(fire(2 * h, 'other', 1).aimDirection, [0, 0, -1])
  const second = fire(3 * h, 'first', 2)
  close(Math.asin(second.aimDirection[1]), 0.4 * radians)
  const pitch = aim.sample(3 * h).recoilPitch
  aim.rebase(10)
  close(aim.sample(10).recoilPitch, pitch)
  for (let tick = 1; tick <= 11; tick++) {
    step(aim, 10 + tick * h, 'first', definition, h)
    aim.endStep()
  }
  close(aim.sample(10.15).recoilPitch, pitch)
  close(aim.sample(10.33).recoilPitch, pitch / 2)
  close(aim.sample(10.5).recoilPitch, 0)
  assert.deepEqual(fire(10.6, 'first', 3).aimDirection, [0, 0, -1])
  for (let tick = 1; tick < 6; tick++) {
    step(aim, 10.6 + tick * h, 'first', definition, h)
    aim.endStep()
  }
  const resumed = fire(10.9, 'first', 4)
  const retention = 0.2 / 0.34
  close(Math.asin(resumed.aimDirection[1]), 0.4 * radians * retention)
  close(aim.sample(10.9).recoilPitch, (0.4 + (0.975 - 0.4) * retention) * radians)
})

test('spray tuning is validated and each rifle has its own profile', () => {
  const source = structuredClone(phantomDefinition.recoil)
  const copied = createAimProfile({ recoil: source }).recoil.spray
  assert.ok(Object.isFrozen(copied.points[0]))
  assert.notDeepEqual(vandalDefinition.recoil.spray, copied)
  source.spray.points[0].pitch = 1
  assert.equal(copied.points[0].pitch, 0)
  assert.throws(() => createAimProfile({ recoil: source }), /start at zero/)
  source.spray.points[0].pitch = 0
  source.spray.points[1].index = 0
  assert.throws(() => createAimProfile({ recoil: source }), /increasing shot indices/)
})
