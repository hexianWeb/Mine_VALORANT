import assert from 'node:assert/strict'
import test from 'node:test'
import { Time } from '../src/engine/runtime/core/time.js'
import { EquipmentController } from '../src/game/weapons/equipment-controller.js'

function definition({ mode, interval, capacity }) {
  return {
    id: 'shared',
    capacity,
    initialReserve: 20,
    fire: { mode, interval },
    equip: { draw: 0, holster: 0 },
    reload: {
      tactical: { feed: 0.2, duration: 0.5 },
      empty: { feed: 0.3, duration: 0.6 },
    },
    inspectDuration: 0.5,
    capabilities: { ads: false },
    assets: { modelId: 'shared-model', assetVersion: 'v1', defaultSkinId: 'default' },
  }
}

function runAutomaticSchedule(frameMilliseconds) {
  const fixedDelta = 1 / 60
  const time = new Time({ fixedDelta, maxFixedSteps: 5 })
  const controller = new EquipmentController({
    definitions: [
      definition({ mode: 'auto', interval: 0.073, capacity: 200 }),
    ],
    loadout: [
      {
        id: 'primary',
        weapon: { instanceId: 'automatic', definitionId: 'shared' },
      },
    ],
    fixedDelta,
  })
  const shots = []
  const observedFrameSteps = new Set()
  let ticket
  let frame = 0
  time.tick(0)
  try {
    while (time.fixedTick < 600) {
      time.tick(++frame * frameMilliseconds)
      observedFrameSteps.add(time.fixedSteps)
      assert.equal(time.droppedSimulationTime, 0)
      for (let index = 0; index < time.fixedSteps; index++) {
        const context = time.snapshot(index)
        // Replies and inputs belong to fixed ticks, including two ticks in the same frame.
        if (context.fixedTick === 2) {
          assert.ok(ticket)
          controller.queue({ type: 'prepared', ticket })
        }
        if (context.fixedTick === 10)
          controller.queue({ type: 'fireHeld', held: true })
        if (context.fixedTick === 590)
          controller.queue({ type: 'fireHeld', held: false })
        const result = controller.step(context)
        for (const effect of result.effects) {
          if (effect.type === 'PrepareWeapon')
            ticket = effect.ticket
        }
        for (const event of result.events) {
          if (event.type === 'ShotFired') {
            assert.equal(event.at, context.fixedTick * fixedDelta)
            shots.push({
              tick: event.fixedTick,
              magazine: event.payload.magazine,
              sequence: event.payload.shotSequence,
            })
          }
        }
        time.completeFixedStep(index)
      }
      assert.ok(frame < 2000, 'fixed schedule must make progress')
    }
    assert.equal(time.fixedTick, 600)
    return { shots, weapon: controller.snapshot().inventory.weapons[0], observedFrameSteps }
  }
  finally {
    controller.dispose()
  }
}

test('automatic cadence is independent of 30/60/144 FPS and five-step catch-up without accumulated tick rounding', () => {
  const baseline = runAutomaticSchedule(1000 / 60)
  // 0.073 seconds is exactly 219/50 fixed ticks mathematically. Round each absolute
  // deadline, not the interval after each emitted shot, which would drift to five ticks.
  const expectedTicks = []
  for (let shot = 0; ; shot++) {
    const tick = 10 + Math.ceil(shot * 219 / 50)
    if (tick >= 590)
      break
    expectedTicks.push(tick)
  }
  assert.deepEqual(baseline.shots.map(shot => shot.tick), expectedTicks)
  assert.deepEqual(baseline.shots.map(shot => shot.sequence), expectedTicks.map((_, index) => index + 1))
  assert.deepEqual(baseline.shots.map(shot => shot.magazine), expectedTicks.map((_, index) => 199 - index))
  assert.equal(baseline.weapon.magazine, 200 - expectedTicks.length)
  assert.equal(baseline.weapon.reserve, 20)
  assert.ok(Math.abs(baseline.weapon.nextFireAt - (10 / 60 + expectedTicks.length * 0.073)) < 1e-10)
  const cadenceGaps = expectedTicks.slice(1).map((tick, index) => tick - expectedTicks[index])
  assert.deepEqual(new Set(cadenceGaps), new Set([4, 5]))

  for (const [label, frameMilliseconds, requiredBatch] of [
    ['30 FPS', 1000 / 30, 2],
    ['144 FPS', 1000 / 144, 0],
    ['five-step catch-up', 5000 / 60, 5],
  ]) {
    const result = runAutomaticSchedule(frameMilliseconds)
    assert.ok(result.observedFrameSteps.has(requiredBatch), `${label} must exercise its frame grouping`)
    assert.deepEqual(result.shots, baseline.shots, label)
    assert.deepEqual(result.weapon, baseline.weapon, label)
  }
})

test('switching between two instances of one definition preserves each magazine and cooldown', (t) => {
  const fixedDelta = 0.1
  const controller = new EquipmentController({
    definitions: [
      definition({ mode: 'semi', interval: 1, capacity: 5 }),
    ],
    loadout: [
      {
        id: 'first-slot',
        weapon: {
          instanceId: 'first',
          definitionId: 'shared',
          magazine: 5,
          reserve: 20,
        },
      },
      {
        id: 'second-slot',
        weapon: {
          instanceId: 'second',
          definitionId: 'shared',
          magazine: 3,
          reserve: 7,
        },
      },
    ],
    fixedDelta,
  })
  t.after(() => controller.dispose())
  const tickets = new Map()
  const shots = []
  let tick = 0
  const step = (...commands) => {
    for (const command of commands) controller.queue(command)
    tick++
    const result = controller.step({ fixedTick: tick, fixedElapsed: tick * fixedDelta, fixedDelta })
    for (const effect of result.effects) {
      if (effect.type === 'PrepareWeapon')
        tickets.set(effect.ticket.instanceId, effect.ticket)
    }
    shots.push(...result.events.filter(event => event.type === 'ShotFired'))
    return result
  }
  const prepare = instanceId => step({
    type: 'prepared',
    ticket: tickets.get(instanceId),
  })
  const weapon = instanceId => controller.snapshot().inventory.weapons.find(weapon => weapon.instanceId === instanceId)

  step() // 1: request first.
  prepare('first') // 2: initial equipment ready.
  step({ type: 'fire' }) // 3: first fires.
  const firstAfterShot = weapon('first')
  assert.equal(firstAfterShot.magazine, 4)
  assert.equal(firstAfterShot.nextFireAt, 0.3 + 1)
  assert.equal(weapon('second').magazine, 3)
  assert.equal(weapon('second').nextFireAt, 0)

  step({ type: 'select', instanceId: 'second' }) // 4
  prepare('second') // 5
  assert.equal(controller.snapshot().canFire, true, 'the first instance cooldown must not block the second')
  step({ type: 'fire' }) // 6: second fires.
  const secondAfterShot = weapon('second')
  assert.equal(secondAfterShot.magazine, 2)
  assert.equal(secondAfterShot.nextFireAt, 0.6 + 1)

  step({ type: 'select', instanceId: 'first' }) // 7
  prepare('first') // 8
  assert.equal(controller.snapshot().activeId, 'first')
  assert.deepEqual(weapon('first'), firstAfterShot)
  assert.deepEqual(weapon('second'), secondAfterShot)
  assert.equal(controller.snapshot().canFire, false)
  assert.equal(step({ type: 'fire' }).events.filter(event => event.type === 'ShotFired').length, 0) // 9
  for (let remaining = 12 - tick; remaining > 0; remaining--) step()
  step({ type: 'fire' }) // 13: first's own deadline, before the second's deadline.
  assert.equal(weapon('first').magazine, 3)
  assert.deepEqual(weapon('second'), secondAfterShot)
  const firstAfterSecondShot = weapon('first')

  step({ type: 'select', instanceId: 'second' }) // 14
  prepare('second') // 15
  assert.equal(controller.snapshot().activeId, 'second')
  assert.deepEqual(weapon('second'), secondAfterShot)
  assert.equal(controller.snapshot().canFire, false)
  step({ type: 'fire' }) // 16: second's own deadline.
  assert.equal(weapon('second').magazine, 1)
  assert.equal(weapon('second').reserve, 7)
  assert.deepEqual(weapon('first'), firstAfterSecondShot)
  assert.deepEqual(shots.map(event => [event.instanceId, event.fixedTick]), [
    ['first', 3],
    ['second', 6],
    ['first', 13],
    ['second', 16],
  ])
})

test('the one-shot-per-step contract rejects intervals below fixedDelta and accepts its exact boundary', (t) => {
  const options = interval => ({
    definitions: [
      definition({ mode: 'auto', interval, capacity: 5 }),
    ],
    loadout: [
      {
        id: 'primary',
        weapon: { instanceId: 'automatic', definitionId: 'shared' },
      },
    ],
    fixedDelta: 0.1,
  })
  assert.throws(() => new EquipmentController(options(0.04)), RangeError)
  const controller = new EquipmentController(options(0.1))
  t.after(() => controller.dispose())
  assert.equal(controller.snapshot().phase, 'Empty')
})
