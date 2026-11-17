import assert from 'node:assert/strict'
import test from 'node:test'
import { Time } from '../src/engine/runtime/core/time.js'
import { EquipmentController } from '../src/game/weapons/equipment-controller.js'

const h = 0.1

function definition(id, overrides = {}) {
  return {
    id,
    capacity: 5,
    initialReserve: 20,
    fire: { mode: 'semi', interval: 0.8, ...overrides.fire },
    equip: { draw: 0, holster: 0, ...overrides.equip },
    reload: {
      tactical: { feed: 0.3, duration: 0.8, ...overrides.reload?.tactical },
      empty: { feed: 0.4, duration: 0.9, ...overrides.reload?.empty },
    },
    inspectDuration: overrides.inspectDuration ?? 0.4,
    capabilities: { ads: true },
    assets: { modelId: `${id}-model`, assetVersion: 'v1', defaultSkinId: 'default' },
  }
}

function setup(t, { definitions = {}, weapons = {}, initialSlot = 'primary', ammoPolicy = 'finite' } = {}) {
  const ids = ['A', 'B', 'C']
  const controller = new EquipmentController({
    definitions: ids.map(id => definition(id, definitions[id])),
    loadout: ids.map((id, index) => ({
      id: ['primary', 'secondary', 'melee'][index],
      weapon: {
        instanceId: id,
        definitionId: id,
        magazine: 2,
        reserve: 10,
        ...weapons[id],
      },
    })),
    fixedDelta: h,
    initialSlot,
    ammoPolicy,
  })
  t.after(() => controller.dispose())
  let tick = 0
  const events = []
  const effects = []
  const fixture = {
    controller,
    events,
    effects,
    get tick() { return tick },
    step(...commands) {
      for (const command of commands) controller.queue(command)
      tick++
      const result = controller.step({ fixedTick: tick, fixedElapsed: tick * h, fixedDelta: h })
      assert.ok(Array.isArray(result.events))
      assert.ok(Array.isArray(result.effects))
      events.push(...result.events)
      effects.push(...result.effects)
      return result
    },
    advance(count) {
      const results = []
      for (let index = 0; index < count; index++) results.push(this.step())
      return results
    },
    ticket(instanceId) {
      const effect = effects.findLast(effect => effect.type === 'PrepareWeapon' && effect.ticket.instanceId === instanceId)
      assert.ok(effect, `expected a preparation request for ${instanceId}`)
      return effect.ticket
    },
    prepare(instanceId) {
      return this.step({
        type: 'prepared',
        ticket: this.ticket(instanceId),
      })
    },
    ready() {
      this.step()
      this.prepare('A')
      for (let limit = 0; controller.snapshot().phase !== 'Ready' && limit < 20; limit++) this.step()
      assert.equal(controller.snapshot().activeId, 'A')
      assert.equal(controller.snapshot().phase, 'Ready')
    },
    select(instanceId) {
      return this.step({ type: 'select', instanceId })
    },
    weapon(instanceId) {
      const weapon = controller.snapshot().inventory.weapons.find(weapon => weapon.instanceId === instanceId)
      assert.ok(weapon, `expected inventory instance ${instanceId}`)
      return weapon
    },
  }
  return fixture
}

function ofType(result, type) {
  return result.events.filter(event => event.type === type)
}

function shots(result) {
  return ofType(result, 'ShotFired')
}

test('explicit infinite reserve preserves empty magazines, manual reload and exactly-once feed commits without Infinity inventory', (t) => {
  const f = setup(t, {
    ammoPolicy: 'infinite-reserve',
    definitions: {
      A: {
        fire: { interval: h },
      },
    },
    weapons: {
      A: { magazine: 0, reserve: 0 },
    },
  })
  f.ready()
  assert.equal(f.controller.snapshot().ammoPolicy, 'infinite-reserve')
  assert.equal(shots(f.step({ type: 'fire' })).length, 0)
  assert.equal(f.weapon('A').magazine, 0)
  const started = f.step({ type: 'reload' })
  assert.equal(ofType(started, 'ReloadStarted').length, 1)
  f.advance(3)
  assert.equal(f.weapon('A').magazine, 0, 'no early refill')
  const committed = f.step()
  assert.equal(ofType(committed, 'AmmoCommitted').length, 1)
  assert.equal(f.weapon('A').magazine, 5)
  assert.equal(f.weapon('A').reserve, 0)
  f.advance(10)
  assert.equal(f.events.filter(event => event.type === 'AmmoCommitted').length, 1)
  for (let i = 0; i < 5; i++) assert.equal(shots(f.step({ type: 'fire' })).length, 1)
  assert.equal(f.weapon('A').magazine, 0)
  f.advance(10)
  assert.equal(f.weapon('A').magazine, 0, 'infinite reserve is not automatic reload or infinite magazine')
  assert.equal(f.weapon('A').reserve, 0)
})

test('default finite reserve still blocks empty reloads and rejects unknown supply policies', (t) => {
  const f = setup(t, {
    weapons: {
      A: { magazine: 0, reserve: 0 },
    },
  })
  f.ready()
  assert.equal(f.controller.snapshot().ammoPolicy, 'finite')
  assert.equal(ofType(f.step({ type: 'reload' }), 'ReloadStarted').length, 0)
  assert.throws(() => setup(t, { ammoPolicy: 'infinite-magazine' }), /ammoPolicy/)
})

test('menu handoff drops uncommitted physical commands, not UI selection or preparation replies', (t) => {
  const f = setup(t)
  f.ready()
  for (const command of [
    { type: 'fire' },
    { type: 'fireHeld', held: true },
    { type: 'reload' },
    { type: 'inspect' },
    { type: 'selectSlot', slotId: 'secondary' },
  ])
    f.controller.queue(command, { source: 'input' })
  f.controller.clearInput()
  assert.equal(shots(f.step()).length, 0)
  assert.equal(f.controller.snapshot().action, null)
  assert.equal(f.controller.snapshot().activeId, 'A')
  f.controller.queue({ type: 'select', instanceId: 'B' })
  f.controller.clearInput()
  f.step()
  const ticket = f.ticket('B')
  f.controller.queue({ type: 'prepared', ticket })
  f.controller.clearInput()
  f.step()
  assert.equal(f.controller.snapshot().activeId, 'B')
})

test('menu input clearing does not cancel a reload that already committed to gameplay', (t) => {
  const f = setup(t)
  f.ready()
  f.step({ type: 'reload' })
  const action = f.controller.snapshot().action
  f.controller.clearInput()
  f.advance(10)
  assert.ok(action)
  assert.equal(f.weapon('A').magazine, 5)
  assert.equal(f.controller.snapshot().action, null)
})

test('skin preparation commits once without changing reload, ammo, cooldown or instance identity', (t) => {
  const f = setup(t)
  f.ready()
  f.step({ type: 'fire' })
  f.step({ type: 'reload' })
  const before = f.controller.snapshot()
  const requested = f.step({ type: 'setSkin', instanceId: 'A', skinId: 'sakura' })
  const ticket = requested.effects.find(effect => effect.type === 'PrepareSkin').ticket
  assert.equal(f.weapon('A').skinId, 'default', 'download does not change the selected skin')
  const committed = f.step({ type: 'skinPrepared', ticket })
  assert.equal(ofType(committed, 'SkinChanged').length, 1)
  assert.equal(f.weapon('A').skinId, 'sakura')
  assert.deepEqual(f.controller.snapshot().action, before.action)
  assert.deepEqual({
    ...f.weapon('A'),
    skinId: 'default',
  }, before.inventory.weapons[0])
  assert.equal(ofType(committed, 'DrawStarted').length, 0)
  assert.equal(ofType(f.step({ type: 'skinPrepared', ticket }), 'SkinChanged').length, 0)
})

test('latest skin intent wins over old readiness even in the same step; failure retains the old skin and can retry', (t) => {
  const f = setup(t)
  f.ready()
  const first = f.step({ type: 'setSkin', instanceId: 'A', skinId: 'sakura' }).effects[0].ticket
  const next = f.step({ type: 'skinPrepared', ticket: first }, { type: 'setSkin', instanceId: 'A', skinId: 'other' })
  const second = next.effects.find(effect => effect.type === 'PrepareSkin').ticket
  assert.ok(second.skinRevision > first.skinRevision)
  assert.equal(ofType(next, 'SkinChanged').length, 0)
  f.step({ type: 'skinFailed', ticket: second, message: 'missing texture' })
  assert.equal(f.weapon('A').skinId, 'default')
  assert.equal(f.controller.snapshot().skinRequests[0].status, 'failed')
  assert.equal(f.controller.snapshot().canFire, true)
  const retry = f.step({ type: 'setSkin', instanceId: 'A', skinId: 'other' })
  const third = retry.effects.find(effect => effect.type === 'PrepareSkin').ticket
  assert.notEqual(third.requestId, second.requestId)
  f.step({ type: 'skinPrepared', ticket: third })
  assert.equal(f.weapon('A').skinId, 'other')
  assert.equal(f.weapon('B').skinId, 'default')
})

test('selecting the existing skin cancels a pending replacement and late replies cannot restore it', (t) => {
  const f = setup(t)
  f.ready()
  const ticket = f.step({ type: 'setSkin', instanceId: 'A', skinId: 'sakura' }).effects[0].ticket
  f.step({ type: 'setSkin', instanceId: 'A', skinId: 'default' }, { type: 'skinPrepared', ticket })
  assert.equal(f.weapon('A').skinId, 'default')
  assert.deepEqual(f.controller.snapshot().skinRequests, [])
})

test('a new skin invalidates unlocked equipment preparation but never a reserved switch target', (t) => {
  const f = setup(t, {
    definitions: {
      B: {
        equip: { draw: 0.3, holster: 0.2 },
      },
    },
  })
  f.ready()
  f.select('B')
  const old = f.ticket('B')
  const requested = f.step({ type: 'prepared', ticket: old }, { type: 'setSkin', instanceId: 'B', skinId: 'sakura' })
  assert.equal(f.controller.snapshot().activeId, 'A')
  const skin = requested.effects.find(effect => effect.type === 'PrepareSkin').ticket
  f.step({ type: 'skinPrepared', ticket: skin })
  const fresh = f.ticket('B')
  assert.notEqual(fresh.requestId, old.requestId)
  assert.equal(fresh.skinRevision, skin.skinRevision)
  f.prepare('B')
  const transaction = f.controller.snapshot().transaction
  const deferred = f.step({ type: 'setSkin', instanceId: 'B', skinId: 'other' })
  assert.equal(deferred.effects.some(effect => effect.type === 'PrepareSkin'), false)
  assert.deepEqual(f.controller.snapshot().transaction, transaction)
  assert.equal(f.weapon('B').skinId, 'sakura')
  while (f.controller.snapshot().phase !== 'Ready') f.step()
  const later = f.effects.findLast(effect => effect.type === 'PrepareSkin')
  assert.equal(later.ticket.skinId, 'other')
  f.step({ type: 'skinPrepared', ticket: later.ticket })
  assert.equal(f.weapon('B').skinId, 'other')
})

test('suspend and reset invalidate skin work synchronously, while committed skins survive only suspend', (t) => {
  const f = setup(t)
  f.ready()
  const ticket = f.step({ type: 'setSkin', instanceId: 'A', skinId: 'sakura' }).effects[0].ticket
  f.step({ type: 'skinPrepared', ticket })
  const pending = f.step({ type: 'setSkin', instanceId: 'A', skinId: 'other' }).effects[0].ticket
  const invalidation = f.controller.suspend()
  assert.ok(invalidation.effects.some(effect => effect.type === 'CancelSkinPreparation'))
  assert.equal(f.controller.queue({ type: 'setSkin', instanceId: 'A', skinId: 'ignored' }), false)
  f.controller.resume()
  f.step({ type: 'skinPrepared', ticket: pending })
  assert.equal(f.weapon('A').skinId, 'sakura')
  f.controller.reset()
  f.step({ type: 'skinPrepared', ticket })
  assert.equal(f.weapon('A').skinId, 'default')
})

test('initial equipment waits for its preparation ticket and gives draw its full quantized duration', (t) => {
  const f = setup(t, {
    definitions: {
      A: {
        equip: { draw: 0.15 },
      },
    },
  })
  const initial = f.step()
  assert.equal(initial.effects.filter(effect => effect.type === 'PrepareWeapon').length, 1)
  assert.equal(f.controller.snapshot().phase, 'Empty')
  assert.equal(f.controller.snapshot().activeId, null)
  f.advance(3)
  assert.equal(f.controller.snapshot().activeId, null)
  const prepared = f.prepare('A')
  assert.equal(ofType(prepared, 'EquipCommitted').length, 1)
  assert.equal(ofType(prepared, 'DrawStarted').length, 1)
  assert.equal(f.controller.snapshot().phase, 'Drawing')
  assert.equal(f.controller.snapshot().canFire, false)
  assert.equal(ofType(f.step(), 'EquipReady').length, 0)
  assert.equal(ofType(f.step(), 'EquipReady').length, 1)
  assert.equal(f.controller.snapshot().phase, 'Ready')
})

test('same-step latest selection beats an old prepared ticket while the current weapon remains usable', (t) => {
  const f = setup(t)
  f.ready()
  f.select('B')
  const oldTicket = f.ticket('B')
  const result = f.step(
    { type: 'prepared', ticket: oldTicket },
    { type: 'select', instanceId: 'C' },
    { type: 'fire' },
  )
  assert.equal(f.controller.snapshot().activeId, 'A')
  assert.equal(f.controller.snapshot().pendingTarget, 'C')
  assert.equal(ofType(result, 'SwitchStarted').length, 0)
  assert.equal(shots(result).length, 1)
  f.select('A')
  f.prepare('C')
  assert.equal(f.controller.snapshot().activeId, 'A')
  assert.equal(f.controller.snapshot().pendingTarget, null)
  assert.equal(f.events.filter(event => event.type === 'EquipCommitted').length, 1)
})

test('A to B to A to B before preparation rejects the first B request', (t) => {
  const f = setup(t)
  f.ready()
  f.select('B')
  const obsolete = f.ticket('B')
  f.select('A')
  f.select('B')
  const latest = f.ticket('B')
  assert.notEqual(latest.requestId, obsolete.requestId)
  assert.equal(ofType(f.step({ type: 'prepared', ticket: obsolete }), 'SwitchStarted').length, 0)
  assert.equal(f.controller.snapshot().activeId, 'A')
  f.step({ type: 'prepared', ticket: latest })
  assert.equal(f.controller.snapshot().activeId, 'B')
  assert.equal(f.controller.snapshot().phase, 'Ready')
})

test('same-step selections that end at the pending target preserve its original prepared ticket', (t) => {
  const f = setup(t)
  f.ready()
  f.select('B')
  const ticket = f.ticket('B')
  const result = f.step(
    { type: 'select', instanceId: 'C' },
    { type: 'select', instanceId: 'B' },
    { type: 'prepared', ticket },
  )
  assert.equal(f.controller.snapshot().activeId, 'B')
  assert.equal(f.controller.snapshot().phase, 'Ready')
  assert.equal(ofType(result, 'SwitchStarted').length, 1)
  assert.equal(f.effects.filter(effect => effect.type === 'PrepareWeapon' && effect.ticket.instanceId === 'B').length, 1)
  assert.equal(result.effects.filter(effect => ['CancelPreparation', 'DiscardPreparation'].includes(effect.type)
    && effect.ticket.requestId === ticket.requestId).length, 0)
})

test('a duplicate old accepted ticket cannot discard the visual awaiting a delayed presentation handoff', (t) => {
  const f = setup(t, {
    definitions: {
      B: {
        equip: { draw: 0.2 },
      },
    },
  })
  f.ready()
  const acceptedA = f.ticket('A')
  f.select('B')
  f.prepare('B')
  assert.equal(f.controller.snapshot().activeId, 'B')
  assert.equal(f.controller.snapshot().phase, 'Drawing')
  const duplicate = f.step({ type: 'prepared', ticket: acceptedA })
  assert.equal(duplicate.effects.filter(effect => effect.type === 'DiscardPreparation'
    && effect.ticket.epoch === acceptedA.epoch
    && effect.ticket.requestId === acceptedA.requestId).length, 0)
  assert.equal(ofType(duplicate, 'EquipCommitted').length, 0)
  assert.equal(f.controller.snapshot().activeId, 'B')
})

test('reselecting the active gun cancels holster and invalidates the reserved ticket', (t) => {
  const f = setup(t, {
    definitions: {
      A: {
        equip: { holster: 0.2 },
      },
      B: {
        equip: { draw: 0.2 },
      },
    },
  })
  f.ready()
  f.select('B')
  f.prepare('B')
  assert.equal(f.controller.snapshot().phase, 'Holstering')
  const transaction = f.controller.snapshot().transaction
  const cancelled = f.select('A')
  assert.deepEqual(ofType(cancelled, 'SwitchCancelled')[0].payload, {
    switchId: transaction.switchId,
    ticket: transaction.ticket,
  })
  assert.equal(f.controller.snapshot().activeId, 'A')
  assert.equal(f.controller.snapshot().canAct, true)
  assert.equal(f.controller.snapshot().transaction, null)
  const stale = f.step({ type: 'prepared', ticket: transaction.ticket })
  assert.deepEqual(stale.effects.map(effect => effect.type), ['DiscardPreparation'])
  assert.equal(ofType(stale, 'EquipCommitted').length, 0)
  f.select('B')
  assert.notEqual(f.ticket('B').requestId, transaction.ticket.requestId)
  f.prepare('B')
  f.advance(4)
  assert.equal(f.controller.snapshot().phase, 'Ready')
  assert.equal(f.controller.snapshot().activeId, 'B')
  assert.equal(f.events.filter(event => event.type === 'EquipCommitted' && event.instanceId === 'B').length, 1)
})

test('each switch segment gets its own full rounded duration and transition commands do not leak', (t) => {
  const f = setup(t, {
    definitions: {
      A: {
        equip: { holster: 0.15 },
      },
      B: {
        equip: { draw: 0.15 },
      },
    },
  })
  f.ready()
  f.select('B')
  const started = f.prepare('B')
  const startTick = f.tick
  assert.equal(ofType(started, 'SwitchStarted').length, 1)
  const ignored = f.step({ type: 'fire' }, { type: 'reload' }, { type: 'inspect' })
  assert.equal(ignored.events.filter(event => ['ShotFired', 'ReloadStarted', 'InspectStarted'].includes(event.type)).length, 0)
  assert.equal(f.controller.snapshot().activeId, 'A')
  const committed = f.step()
  assert.equal(ofType(committed, 'EquipCommitted')[0].fixedTick, startTick + 2)
  assert.equal(f.controller.snapshot().phase, 'Drawing')
  f.step()
  assert.equal(f.controller.snapshot().phase, 'Drawing')
  const ready = f.step()
  assert.equal(ofType(ready, 'EquipReady')[0].fixedTick, startTick + 4)
  f.advance(5)
  assert.equal(f.events.filter(event => event.type === 'ShotFired').length, 0)
  assert.equal(f.events.filter(event => event.type === 'ReloadStarted').length, 0)
  assert.equal(f.events.filter(event => event.type === 'InspectStarted').length, 0)
})

for (const [label, delay, expectedCommits, expectedMagazine] of [
  ['before', 0, 0, 1],
  ['on', 1, 0, 1],
  ['after', 2, 1, 5],
]) {
  test(`switching ${label} reload feed commits ${expectedCommits} times`, (t) => {
    const f = setup(t, {
      weapons: {
        A: { magazine: 1 },
      },
    })
    f.ready()
    f.step({ type: 'reload' })
    f.select('B')
    f.advance(delay)
    const switched = f.prepare('B')
    assert.equal(f.controller.snapshot().activeId, 'B')
    assert.equal(ofType(switched, 'ReloadCancelled').length, 1)
    f.advance(10)
    const commits = f.events.filter(event => event.type === 'AmmoCommitted' && event.instanceId === 'A')
    assert.equal(commits.length, expectedCommits)
    assert.equal(f.weapon('A').magazine, expectedMagazine)
    assert.equal(f.weapon('A').reserve, expectedCommits ? 6 : 10)
  })
}

test('a committed reload keeps its recovery deadline across a quick switch away and back', (t) => {
  const f = setup(t, {
    weapons: {
      A: { magazine: 1 },
    },
  })
  f.ready()
  f.step({ type: 'reload' })
  const reloadStart = f.tick
  f.select('B')
  f.advance(2)
  assert.equal(f.weapon('A').magazine, 5)
  const recoveryDeadline = f.weapon('A').blockedUntil
  assert.ok(recoveryDeadline > f.tick * h)
  f.prepare('B')
  f.select('A')
  f.prepare('A')
  assert.equal(f.controller.snapshot().activeId, 'A')
  assert.equal(f.controller.snapshot().phase, 'Ready')
  assert.equal(f.controller.snapshot().canFire, false)
  assert.equal(f.weapon('A').blockedUntil, recoveryDeadline)
  assert.equal(shots(f.step({ type: 'fire' })).length, 0)
  while (f.tick < reloadStart + 8) f.step()
  assert.equal(f.controller.snapshot().canFire, true)
  assert.equal(shots(f.step({ type: 'fire' })).length, 1)
})

test('shot cooldown and spent ammunition survive switching and selecting the current gun', (t) => {
  const f = setup(t, {
    definitions: {
      A: {
        fire: { interval: 1 },
      },
    },
    weapons: {
      A: { magazine: 3 },
    },
  })
  f.ready()
  assert.equal(shots(f.step({ type: 'fire' })).length, 1)
  const deadline = f.weapon('A').nextFireAt
  f.select('B')
  f.prepare('B')
  f.select('A')
  f.prepare('A')
  assert.equal(f.weapon('A').magazine, 2)
  assert.equal(f.weapon('A').nextFireAt, deadline)
  const selected = f.step({ type: 'select', instanceId: 'A' }, { type: 'fire' })
  assert.equal(shots(selected).length, 0)
  assert.equal(ofType(selected, 'DrawStarted').length, 0)
  assert.equal(f.weapon('A').nextFireAt, deadline)
  while ((f.tick + 1) * h < deadline - 1e-10) f.step()
  assert.equal(shots(f.step({ type: 'fire' })).length, 1)
  assert.equal(f.weapon('A').magazine, 1)
})

test('valid reload beats fire, while an invalid full-magazine reload does not swallow fire', (t) => {
  const f = setup(t)
  f.ready()
  const reload = f.step({ type: 'fire' }, { type: 'reload' })
  assert.equal(ofType(reload, 'ReloadStarted').length, 1)
  assert.equal(shots(reload).length, 0)
  f.advance(8)
  assert.equal(f.weapon('A').magazine, 5)
  const fire = f.step({ type: 'reload' }, { type: 'fire' })
  assert.equal(ofType(fire, 'ReloadStarted').length, 0)
  assert.equal(shots(fire).length, 1)
})

test('duplicate preparation and reload inputs cannot duplicate equipment or ammo commits', (t) => {
  const f = setup(t)
  f.ready()
  const initialTicket = f.ticket('A')
  f.step({ type: 'prepared', ticket: initialTicket }, { type: 'prepared', ticket: initialTicket })
  assert.equal(f.events.filter(event => event.type === 'EquipCommitted').length, 1)
  f.step({ type: 'reload' }, { type: 'reload' })
  f.advance(9)
  assert.equal(f.events.filter(event => event.type === 'ReloadStarted').length, 1)
  assert.equal(f.events.filter(event => event.type === 'AmmoCommitted').length, 1)
  assert.equal(f.weapon('A').magazine, 5)
  assert.equal(f.weapon('A').reserve, 7)
})

test('semi-automatic fire held through a switch needs a fresh ready-state edge', (t) => {
  const f = setup(t, {
    definitions: {
      B: {
        equip: { draw: 0.2 },
      },
    },
  })
  f.ready()
  f.step({ type: 'fireHeld', held: true }, { type: 'fire' })
  f.select('B')
  f.prepare('B')
  f.step({ type: 'fire' })
  f.step()
  f.advance(3)
  assert.equal(f.controller.snapshot().phase, 'Ready')
  assert.equal(f.events.filter(event => event.type === 'ShotFired' && event.instanceId === 'B').length, 0)
  f.step({ type: 'fireHeld', held: false })
  assert.equal(shots(f.step({ type: 'fireHeld', held: true }, { type: 'fire' })).length, 1)
})

test('automatic held fire can continue when the new gun is ready without replaying a one-shot command', (t) => {
  const f = setup(t, {
    definitions: {
      B: {
        fire: { mode: 'auto' },
        equip: { draw: 0.2 },
      },
    },
  })
  f.ready()
  f.step({ type: 'fireHeld', held: true })
  f.select('B')
  f.prepare('B')
  f.advance(2)
  const bShots = f.events.filter(event => event.type === 'ShotFired' && event.instanceId === 'B')
  assert.equal(bShots.length, 1)
  assert.equal(bShots[0].fixedTick, f.tick)
  f.step({ type: 'fireHeld', held: false })
  f.advance(10)
  assert.equal(f.events.filter(event => event.type === 'ShotFired' && event.instanceId === 'B').length, 1)
})

for (const delay of [0, 1]) {
  test(`a prepared switch takes priority during drawing with ${delay} extra fixed steps`, (t) => {
    const f = setup(t, {
      definitions: {
        B: {
          equip: { draw: 0.3, holster: 0.1 },
          fire: { mode: 'auto' },
        },
        C: {
          equip: { draw: 0.2 },
        },
      },
    })
    f.ready()
    f.select('B')
    f.prepare('B')
    const deadline = f.controller.snapshot().transaction.readyTick
    assert.equal(f.controller.snapshot().previousId, 'A')
    f.select('C')
    f.advance(delay)
    const handoff = f.step(
      {
        type: 'prepared',
        ticket: f.ticket('C'),
      },
      { type: 'fireHeld', held: true },
      { type: 'fire' },
    )
    assert.equal(ofType(handoff, 'EquipCommitted')[0].fixedTick, deadline + delay - 1)
    assert.equal(f.controller.snapshot().activeId, 'C')
    assert.equal(f.controller.snapshot().phase, 'Drawing')
    assert.equal(f.controller.snapshot().canAct, false)
    f.advance(2)
    assert.equal(f.controller.snapshot().canAct, true)
    assert.deepEqual(f.events.filter(event => event.type === 'EquipReady').map(event => event.instanceId), ['A', 'C'])
    assert.equal(f.events.filter(event => event.type === 'ShotFired').length, 0)
  })
}

test('failed and late preparation never disarm the current weapon or equip an obsolete request', (t) => {
  const f = setup(t)
  f.ready()
  f.select('B')
  const failed = f.ticket('B')
  f.step({ type: 'prepareFailed', ticket: failed, message: 'missing model' })
  assert.equal(f.controller.snapshot().activeId, 'A')
  assert.equal(f.controller.snapshot().canFire, true)
  assert.equal(f.controller.snapshot().phase, 'Ready')
  f.advance(3)
  assert.equal(f.effects.filter(effect => effect.type === 'PrepareWeapon' && effect.ticket.instanceId === 'B').length, 1)
  f.select('B')
  const retry = f.ticket('B')
  assert.notEqual(retry.requestId, failed.requestId)
  f.step({ type: 'prepared', ticket: failed })
  assert.equal(f.controller.snapshot().activeId, 'A')
  f.step({ type: 'prepared', ticket: retry })
  assert.equal(f.controller.snapshot().activeId, 'B')
})

test('pause preserves transition time, keeps only the latest selection, and clears weapon action inputs', (t) => {
  const f = setup(t, {
    definitions: {
      B: {
        equip: { draw: 0.2 },
      },
    },
  })
  f.ready()
  f.select('B')
  f.prepare('B')
  const before = f.controller.snapshot()
  f.controller.setPaused(true)
  f.controller.queue({ type: 'select', instanceId: 'C' })
  f.controller.queue({ type: 'select', instanceId: 'A' })
  f.controller.queue({ type: 'fire' })
  f.controller.queue({ type: 'fireHeld', held: true })
  f.controller.queue({ type: 'reload' })
  f.controller.queue({ type: 'inspect' })
  const paused = f.controller.step({ fixedTick: f.tick, fixedElapsed: f.tick * h, fixedDelta: h })
  assert.deepEqual(paused, { events: [], effects: [] })
  assert.equal(f.controller.snapshot().phase, before.phase)
  assert.equal(f.controller.snapshot().canAct, false)
  f.controller.setPaused(false)
  f.step()
  assert.equal(f.controller.snapshot().phase, 'Drawing')
  assert.equal(f.controller.snapshot().queuedTarget, 'A')
  f.step()
  assert.equal(f.controller.snapshot().activeId, 'B')
  assert.equal(f.controller.snapshot().phase, 'Ready')
  assert.equal(f.events.filter(event => ['ShotFired', 'ReloadStarted', 'InspectStarted'].includes(event.type)).length, 0)
})

test('setting an unchanged pause state preserves queued fire edges and held input', (t) => {
  const f = setup(t, {
    definitions: {
      A: {
        fire: { mode: 'auto', interval: 0.2 },
      },
    },
  })
  f.ready()
  f.controller.queue({ type: 'fire' })
  f.controller.setPaused(false)
  assert.equal(shots(f.step()).length, 1)
  f.controller.queue({ type: 'fireHeld', held: true })
  f.controller.setPaused(false)
  assert.equal(shots(f.step()).length, 0)
  assert.equal(shots(f.step()).length, 1)
})

test('suspend returns its invalidation batch synchronously once even while paused', (t) => {
  const f = setup(t)
  f.ready()
  f.step({ type: 'reload' })
  f.controller.setPaused(true)
  const invalidated = f.controller.suspend()
  assert.equal(ofType(invalidated, 'ReloadCancelled').length, 1)
  assert.equal(ofType(invalidated, 'PresentationReset').length, 1)
  assert.equal(f.controller.snapshot().phase, 'Suspended')
  assert.deepEqual(f.controller.suspend(), { events: [], effects: [] })
  assert.deepEqual(f.controller.step({ fixedTick: f.tick, fixedElapsed: f.tick * h, fixedDelta: h }), { events: [], effects: [] })
  f.controller.setPaused(false)
  const next = f.step()
  assert.equal(ofType(next, 'ReloadCancelled').length, 0)
  assert.equal(ofType(next, 'PresentationReset').length, 0)
})

test('reset returns cancellation and presentation reset without waiting for an unpaused step', (t) => {
  const f = setup(t)
  f.ready()
  f.step({ type: 'reload' })
  f.controller.setPaused(true)
  const invalidated = f.controller.reset()
  assert.equal(ofType(invalidated, 'ReloadCancelled').length, 1)
  assert.equal(ofType(invalidated, 'PresentationReset').length, 1)
  assert.equal(f.controller.snapshot().phase, 'Empty')
  assert.equal(f.controller.snapshot().activeId, null)
  assert.deepEqual(f.controller.step({ fixedTick: f.tick, fixedElapsed: f.tick * h, fixedDelta: h }), { events: [], effects: [] })
  f.controller.setPaused(false)
  const next = f.step()
  assert.equal(ofType(next, 'ReloadCancelled').length, 0)
  assert.equal(ofType(next, 'PresentationReset').length, 0)
  assert.equal(next.effects.filter(effect => effect.type === 'PrepareWeapon' && effect.ticket.instanceId === 'A').length, 1)
})

test('resuming requires a new ticket and redraws the committed gun without recommitting it', (t) => {
  const f = setup(t, {
    definitions: {
      B: {
        equip: { draw: 0.2 },
      },
    },
  })
  f.ready()
  f.select('B')
  const oldTicket = f.ticket('B')
  const oldEpoch = f.controller.snapshot().epoch
  f.controller.suspend()
  assert.notEqual(f.controller.snapshot().epoch, oldEpoch)
  assert.equal(f.controller.snapshot().phase, 'Suspended')
  assert.equal(f.controller.snapshot().activeId, 'A')
  f.step({ type: 'prepared', ticket: oldTicket }, { type: 'fire' })
  f.advance(20)
  assert.equal(f.controller.snapshot().phase, 'Suspended')
  f.controller.resume()
  const preparing = f.step()
  assert.equal(ofType(preparing, 'DrawStarted').length, 0)
  assert.equal(f.controller.snapshot().phase, 'Suspended')
  assert.equal(f.controller.snapshot().canAct, false)
  assert.equal(f.controller.snapshot().activeId, 'A')
  const resumeTicket = f.ticket('A')
  assert.equal(resumeTicket.epoch, f.controller.snapshot().epoch)
  assert.notEqual(resumeTicket.epoch, oldTicket.epoch)
  const resumed = f.prepare('A')
  assert.equal(ofType(resumed, 'DrawStarted').length, 1)
  assert.equal(ofType(resumed, 'DrawStarted')[0].payload.reason, 'resume')
  assert.equal(ofType(resumed, 'EquipCommitted').length, 0)
  assert.equal(f.controller.snapshot().activeId, 'A')
  assert.equal(f.controller.snapshot().pendingTarget, null)
  assert.equal(f.events.filter(event => event.type === 'ShotFired').length, 0)
})

test('resume accepts a global clock gap after an earlier suspended step and starts a fresh draw deadline', (t) => {
  const f = setup(t, {
    definitions: {
      A: {
        equip: { draw: 0.2 },
      },
    },
  })
  f.ready()
  f.controller.suspend()
  f.step()
  f.controller.resume()
  const resumedTick = f.tick + 50
  const stepAt = (fixedTick, ...commands) => {
    for (const command of commands) f.controller.queue(command)
    return f.controller.step({ fixedTick, fixedElapsed: fixedTick * h, fixedDelta: h })
  }
  const preparing = stepAt(resumedTick)
  assert.equal(f.controller.snapshot().phase, 'Suspended')
  const ticket = preparing.effects.find(effect => effect.type === 'PrepareWeapon').ticket
  assert.equal(ticket.instanceId, 'A')
  const draw = stepAt(resumedTick + 1, { type: 'prepared', ticket })
  assert.equal(ofType(draw, 'DrawStarted').length, 1)
  assert.equal(ofType(draw, 'EquipCommitted').length, 0)
  assert.equal(f.controller.snapshot().phase, 'Drawing')
  assert.equal(ofType(stepAt(resumedTick + 2), 'EquipReady').length, 0)
  assert.equal(ofType(stepAt(resumedTick + 3), 'EquipReady').length, 1)
  assert.equal(f.controller.snapshot().phase, 'Ready')
})

test('failed resume preparation can be retried for the committed gun without a second equipment commit', (t) => {
  const f = setup(t)
  f.ready()
  f.controller.suspend()
  f.controller.resume()
  f.step()
  const failed = f.ticket('A')
  f.step({ type: 'prepareFailed', ticket: failed, message: 'restoring the visual failed' })
  assert.equal(f.controller.snapshot().phase, 'Suspended')
  assert.equal(f.controller.snapshot().activeId, 'A')
  assert.equal(f.controller.snapshot().canAct, false)
  f.select('A')
  const retry = f.ticket('A')
  assert.notEqual(retry.requestId, failed.requestId)
  const resumed = f.step({ type: 'prepared', ticket: retry })
  assert.equal(ofType(resumed, 'DrawStarted').length, 1)
  assert.equal(ofType(resumed, 'DrawStarted')[0].payload.reason, 'resume')
  assert.equal(ofType(resumed, 'EquipCommitted').length, 0)
  assert.equal(f.controller.snapshot().phase, 'Ready')
})

test('reset invalidates in-flight tickets and action edges and rebuilds the configured inventory', (t) => {
  const f = setup(t)
  f.ready()
  f.step({ type: 'fire' })
  f.select('B')
  const stale = f.ticket('B')
  const oldEpoch = f.controller.snapshot().epoch
  f.controller.queue({ type: 'fire' })
  f.controller.reset()
  assert.notEqual(f.controller.snapshot().epoch, oldEpoch)
  assert.equal(f.controller.snapshot().activeId, null)
  assert.equal(f.controller.snapshot().phase, 'Empty')
  assert.equal(f.weapon('A').magazine, 5)
  assert.equal(f.weapon('A').reserve, 20)
  const reset = f.step({ type: 'prepared', ticket: stale })
  assert.equal(ofType(reset, 'EquipCommitted').length, 0)
  const current = f.ticket('A')
  assert.equal(current.epoch, f.controller.snapshot().epoch)
  assert.notEqual(current.epoch, stale.epoch)
  const initial = f.prepare('A')
  assert.equal(ofType(initial, 'EquipCommitted').length, 1)
  assert.equal(shots(initial).length, 0)
  assert.equal(f.controller.snapshot().activeId, 'A')
})

test('events carry monotonic identity and fixed-time facts across zero-duration transitions', (t) => {
  const f = setup(t)
  f.ready()
  f.select('B')
  const result = f.prepare('B')
  assert.deepEqual(result.events.filter(event => [
    'SwitchStarted',
    'EquipCommitted',
    'DrawStarted',
    'EquipReady',
  ].includes(event.type)).map(event => event.type), [
    'SwitchStarted',
    'EquipCommitted',
    'DrawStarted',
    'EquipReady',
  ])
  for (let index = 0; index < f.events.length; index++) {
    const event = f.events[index]
    assert.equal(event.epoch, f.controller.snapshot().epoch)
    assert.equal(event.at, event.fixedTick * h)
    assert.ok(event.instanceId !== undefined)
    assert.ok(event.payload && typeof event.payload === 'object')
    if (index > 0)
      assert.ok(event.sequence > f.events[index - 1].sequence)
  }
})

test('the controller accepts actual fixed Time snapshots without a second gameplay clock', (t) => {
  const { controller } = setup(t)
  const time = new Time({ fixedDelta: h })
  time.tick(0)
  time.tick(100)
  const first = controller.step(time.snapshot(0))
  time.completeFixedStep(0)
  const ticket = first.effects.find(effect => effect.type === 'PrepareWeapon').ticket
  controller.queue({ type: 'prepared', ticket })
  time.tick(200)
  const second = controller.step(time.snapshot(0))
  time.completeFixedStep(0)
  assert.equal(controller.snapshot().activeId, 'A')
  assert.equal(controller.snapshot().phase, 'Ready')
  assert.ok(second.events.every(event => event.fixedTick === time.fixedTick && event.at === time.fixedElapsed))
})

test('invalid fixed contexts do not consume queued input or partially advance the controller', (t) => {
  const f = setup(t)
  f.ready()
  f.controller.queue({ type: 'fire' })
  const before = f.controller.snapshot()
  const nextTick = f.tick + 1
  for (const context of [
    { fixedTick: nextTick },
    { fixedTick: nextTick, fixedElapsed: nextTick * h },
    { fixedTick: nextTick, fixedDelta: h },
    { fixedTick: Number.NaN, fixedElapsed: nextTick * h, fixedDelta: h },
    { fixedTick: f.tick, fixedElapsed: f.tick * h, fixedDelta: h },
    { fixedTick: nextTick, fixedElapsed: 100, fixedDelta: h },
    { fixedTick: nextTick, fixedElapsed: nextTick * h, fixedDelta: h / 2 },
    {
      fixedTick: nextTick,
      fixedElapsed: nextTick * h,
      fixedDelta: h,
      fixedStepIndex: null,
      fixedSteps: 0,
      completedFixedSteps: 0,
    },
    {
      fixedTick: nextTick,
      fixedElapsed: nextTick * h,
      fixedDelta: h,
      fixedStepIndex: 0,
      fixedSteps: 1,
      completedFixedSteps: 1,
    },
    {
      fixedTick: nextTick,
      fixedElapsed: nextTick * h,
      fixedDelta: h,
      timeScale: 0,
    },
  ]) {
    assert.throws(() => f.controller.step(context))
    assert.deepEqual(f.controller.snapshot(), before)
  }
  assert.equal(shots(f.step()).length, 1)
  assert.equal(shots(f.step()).length, 0)
})

test('returned snapshots, tickets and event payloads cannot rewrite authoritative state', (t) => {
  const f = setup(t)
  f.step()
  const snapshot = f.controller.snapshot()
  const ticket = structuredClone(f.ticket('A'))
  const attemptMutation = (mutate) => {
    try {
      mutate()
    }
    catch (error) {
      assert.ok(error instanceof TypeError)
    }
  }
  attemptMutation(() => {
    snapshot.inventory.weapons[0].magazine = 1000
  })
  attemptMutation(() => {
    snapshot.inventory.slots[0].instanceId = 'C'
  })
  attemptMutation(() => {
    f.ticket('A').instanceId = 'C'
  })
  assert.equal(f.weapon('A').magazine, 2)
  assert.equal(f.controller.snapshot().inventory.slots[0].instanceId, 'A')
  const prepared = f.step({ type: 'prepared', ticket })
  assert.equal(f.controller.snapshot().activeId, 'A')
  const committed = ofType(prepared, 'EquipCommitted')[0]
  attemptMutation(() => {
    committed.payload.instanceId = 'C'
  })
  attemptMutation(() => {
    committed.instanceId = 'C'
  })
  assert.equal(f.controller.snapshot().activeId, 'A')
  assert.equal(f.controller.snapshot().inventory.slots[0].instanceId, 'A')
  assert.equal(ofType(f.step({ type: 'prepared', ticket }), 'EquipCommitted').length, 0)
})
