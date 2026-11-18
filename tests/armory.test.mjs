import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import test from 'node:test'
import { createArmoryCatalog, rangePurchaseSlots } from '../src/game/weapons/armory-catalog.js'
import { bulldogDefinition } from '../src/game/weapons/definitions/bulldog.js'
import { classicDefinition } from '../src/game/weapons/definitions/classic.js'
import { ghostDefinition } from '../src/game/weapons/definitions/ghost.js'
import { judgeDefinition } from '../src/game/weapons/definitions/judge.js'
import { karambitDefinition } from '../src/game/weapons/definitions/karambit.js'
import { odinDefinition } from '../src/game/weapons/definitions/odin.js'
import { phantomDefinition } from '../src/game/weapons/definitions/phantom.js'
import { sheriffDefinition } from '../src/game/weapons/definitions/sheriff.js'
import { vandalDefinition } from '../src/game/weapons/definitions/vandal.js'
import { EquipmentController } from '../src/game/weapons/equipment-controller.js'
import { practiceLoadout, rangeLoadout } from '../src/game/weapons/player-weapons.js'
import { PracticeArmory } from '../src/game/weapons/practice-armory.js'
import { createWeaponDefinition } from '../src/game/weapons/weapon-definition.js'

const definitions = [
  classicDefinition,
  phantomDefinition,
  ghostDefinition,
  vandalDefinition,
  sheriffDefinition,
  judgeDefinition,
  odinDefinition,
  bulldogDefinition,
  karambitDefinition,
]
const h = 1 / 60

function setup(t, access = () => null) {
  const fixtureDefinitions = definitions.map(definition => createWeaponDefinition({
    ...definition,
    equip: { draw: 0, holster: 0 },
  }))
  const controller = new EquipmentController({
    definitions: fixtureDefinitions,
    loadout: practiceLoadout,
    initialSlot: 'secondary',
    fixedDelta: h,
  })
  const catalog = createArmoryCatalog({ definitions: fixtureDefinitions, inventory: controller.snapshot().inventory })
  const armory = new PracticeArmory({
    catalog,
    equipment: controller.readFrameState(),
    readSlot: id => controller.readSlot(id),
    access,
  })
  let tick = 0
  let requestId = 0
  const step = (...commands) => {
    for (const command of commands) controller.queue(command)
    armory.beforeFixed(command => controller.queue(command))
    const batch = controller.step({ fixedTick: ++tick, fixedElapsed: tick * h, fixedDelta: h })
    armory.accept(controller.readFrameState())
    return batch
  }
  const prepare = () => {
    const ticket = controller.snapshot().preparation.ticket
    step({ type: 'prepared', ticket })
    return ticket
  }
  const select = slotId => armory.request({ scopeId: armory.scopeId, requestId: ++requestId, slotId })
  step()
  prepare()
  armory.present({
    weapon: { instanceId: 'pistol' },
    action: 'idle',
  })
  t.after(() => {
    armory.dispose()
    controller.dispose()
  })
  return {
    armory,
    controller,
    select,
    step,
    prepare,
  }
}

test('catalog covers exactly held slots and derives details from runtime definitions, not source-art numbers', () => {
  const controller = new EquipmentController({ definitions, loadout: practiceLoadout, initialSlot: 'secondary' })
  const catalog = createArmoryCatalog({ definitions, inventory: controller.snapshot().inventory })
  assert.deepEqual(catalog.map(entry => entry.id), [
    'classic',
    'ghost',
    'sheriff',
    'phantom',
    'vandal',
    'judge',
    'odin',
  ])
  assert.equal(catalog.length, 7)
  assert.equal(catalog.find(entry => entry.id === 'judge').stats.capacity, judgeDefinition.capacity)
  assert.equal(catalog.find(entry => entry.id === 'odin').stats.fullFireRate, 1 / odinDefinition.fire.spinUp.interval)
  assert.equal(catalog.find(entry => entry.id === 'vandal').stats.adsFireRate, 1 / vandalDefinition.fire.adsInterval)
  assert.equal(catalog.find(entry => entry.id === 'ghost').stats.capacity, 13)
  assert.ok(Object.isFrozen(catalog))
  assert.ok(catalog.every(entry => Object.isFrozen(entry) && Object.isFrozen(entry.stats) && !Object.hasOwn(entry.stats, 'damage')))
  const partial = createArmoryCatalog({
    definitions,
    inventory: {
      slots: [
        { id: 'only', instanceId: 'pistol' },
      ],
      weapons: [
        { instanceId: 'pistol', definitionId: 'classic' },
      ],
    },
  })
  assert.deepEqual(partial.map(entry => entry.slotId), ['only'])
  controller.dispose()
})

test('range purchases replace only their category after preparation and survive respawn', (t) => {
  const instant = definitions.map(definition => createWeaponDefinition({
    ...definition,
    equip: { draw: 0, holster: 0 },
  }))
  const controller = new EquipmentController({
    definitions: instant,
    loadout: rangeLoadout,
    initialSlot: 'secondary',
    purchaseSlots: rangePurchaseSlots,
    meleeSlot: 'tertiary',
  })
  const catalog = createArmoryCatalog({ definitions: instant, purchaseSlots: rangePurchaseSlots })
  const bulldog = catalog.find(entry => entry.id === 'bulldog')
  assert.equal(bulldog.slotId, 'primary')
  assert.equal(bulldog.shortcut, '1')
  assert.equal(bulldog.provisional, true)
  assert.equal(bulldog.stats.capacity, 24)
  const armory = new PracticeArmory({
    catalog,
    equipment: controller.readFrameState(),
    readSlot: id => controller.readSlot(id),
    purchasing: true,
  })
  t.after(() => {
    armory.dispose()
    controller.dispose()
  })
  let tick = 0
  let requestId = 0
  const state = () => controller.snapshot()
  const choose = definitionId => armory.request({ scopeId: armory.scopeId, requestId: ++requestId, definitionId })
  const step = (...commands) => {
    for (const command of commands) controller.queue(command)
    armory.beforeFixed(command => controller.queue(command))
    const batch = controller.step({ fixedTick: ++tick, fixedElapsed: tick * h, fixedDelta: h })
    armory.accept(controller.readFrameState())
    return batch
  }
  const prepare = () => step({ type: 'prepared', ticket: state().preparation.ticket })
  const slots = () => state().inventory.weapons.map(weapon => weapon.definitionId)
  step()
  prepare()
  step({ type: 'fire' })
  const classic = state().inventory.weapons[1]
  assert.deepEqual(slots(), ['phantom', 'classic', 'karambit'])
  assert.equal(choose('vandal').accepted, true)
  step()
  assert.equal(state().activeId, 'pistol')
  assert.deepEqual(slots(), ['phantom', 'classic', 'karambit'])
  const failed = state().preparation.ticket
  step({ type: 'prepareFailed', ticket: failed, message: 'fixture' })
  assert.equal(armory.read().request.status, 'failed')
  assert.equal(choose('vandal').accepted, true)
  step({ type: 'prepared', ticket: failed })
  assert.deepEqual(slots(), ['phantom', 'classic', 'karambit'])
  prepare()
  assert.deepEqual(slots(), ['vandal', 'classic', 'karambit'])
  assert.deepEqual(state().inventory.weapons[1], classic)
  assert.equal(choose('ghost').accepted, true)
  step()
  prepare()
  assert.deepEqual(slots(), ['vandal', 'ghost', 'karambit'])
  const ghostId = state().activeId
  step({ type: 'selectSlot', slotId: 'tertiary' })
  prepare()
  assert.equal(state().activeId, 'karambit')
  assert.equal(state().canFire, false)
  assert.equal(state().canReload, false)
  const swing = step({ type: 'fire' })
  const started = swing.events.find(event => event.type === 'MeleeSwung')
  assert.equal(started.instanceId, 'karambit')
  assert.equal(started.payload.impactTick, started.fixedTick + 4)
  assert.ok(!swing.events.some(event => ['ShotFired', 'MeleeContact'].includes(event.type)))
  for (let i = 0; i < 3; i++)
    assert.ok(!step({ type: 'fire' }).events.some(event => ['MeleeSwung', 'MeleeContact'].includes(event.type)))
  const contact = step().events.filter(event => event.type === 'MeleeContact')
  assert.equal(contact.length, 1)
  assert.equal(contact[0].fixedTick, started.payload.impactTick)
  assert.ok(!step().events.some(event => event.type === 'MeleeContact'))
  assert.equal(state().inventory.weapons[2].shotSequence, 0)

  while (tick < started.fixedTick + 59) step()
  assert.ok(step({ type: 'fire' }).events.some(event => event.type === 'MeleeSwung'))
  assert.ok(!step({ type: 'select', instanceId: ghostId }).events.some(event => event.type === 'MeleeContact'))
  assert.ok(!prepare().events.some(event => event.type === 'MeleeContact'))
  for (let i = 0; i < 4; i++)
    assert.ok(!step().events.some(event => event.type === 'MeleeContact'))
  controller.reset()
  armory.invalidate()
  step()
  prepare()
  assert.equal(state().activeId, ghostId)
  assert.deepEqual(slots(), ['vandal', 'ghost', 'karambit'])
  assert.equal(choose('bulldog').accepted, true)
  step()
  prepare()
  assert.deepEqual(slots(), ['bulldog', 'ghost', 'karambit'])
  assert.equal(state().inventory.weapons[0].magazine, 24)
})

test('selection waits for fixed commit; displayed equipment and completion wait for P without gating gameplay on P', (t) => {
  const f = setup(t)
  assert.equal(f.armory.canStartChallenge(), true)
  const initial = f.armory.read()
  assert.equal(f.select('primary').accepted, true)
  assert.equal(f.controller.snapshot().preparation, null)
  assert.equal(f.armory.read().request.status, 'queued')
  assert.equal(f.armory.canStartChallenge(), false)
  assert.equal(f.armory.read().presentedSlotId, initial.presentedSlotId)
  f.step()
  assert.equal(f.armory.read().request.status, 'preparing')
  assert.equal(f.controller.snapshot().activeId, 'pistol')
  f.prepare()
  assert.equal(f.controller.snapshot().activeId, 'rifle')
  assert.equal(f.armory.read().presentedSlotId, 'secondary')
  assert.equal(f.armory.read().request.status, 'presenting')
  assert.equal(f.armory.canStartChallenge(), true, 'presentation sampling cannot decide authority readiness')
  f.armory.present({
    weapon: { instanceId: 'rifle' },
    action: 'draw',
  })
  assert.equal(f.armory.read().request.status, 'presenting')
  f.armory.present({
    weapon: { instanceId: 'rifle' },
    action: 'idle',
  })
  assert.equal(f.armory.read().request.status, 'ready')
  assert.equal(f.armory.read().presentedSlotId, 'primary')
  assert.equal(f.controller.snapshot().inventory.weapons.find(weapon => weapon.instanceId === 'pistol').magazine, 12)
})

test('access is checked both when requesting and at fixed commit; mid-preparation restrictions cancel only uncommitted selection', (t) => {
  let reason = null
  const f = setup(t, () => reason)
  f.select('primary')
  reason = '本局进行中，请先取消挑战'
  f.step()
  assert.equal(f.armory.read().request.status, 'failed')
  assert.equal(f.controller.snapshot().activeId, 'pistol')
  assert.equal(f.controller.snapshot().preparation, null)
  assert.equal(f.select('tertiary').accepted, false)
  reason = null
  assert.equal(f.armory.canStartChallenge(), true)
  f.select('primary')
  f.step()
  const old = f.controller.snapshot().preparation.ticket
  reason = '本局进行中，请先取消挑战'
  f.step({ type: 'prepared', ticket: old })
  assert.equal(f.controller.snapshot().activeId, 'pistol', 'restriction wins even over a same-step preparation reply')
  assert.equal(f.controller.snapshot().preparation, null)
  assert.equal(f.armory.read().available, false)
})

test('duplicate and stale request identities are rejected; latest request wins and a failed selection preserves the old weapon', (t) => {
  const f = setup(t)
  const scopeId = f.armory.scopeId
  assert.equal(f.select('primary').accepted, true)
  assert.equal(f.armory.request({ scopeId, requestId: 1, slotId: 'primary' }).accepted, false)
  assert.equal(f.armory.request({ scopeId, requestId: 2, slotId: 'primary' }).accepted, false)
  f.step()
  const old = f.controller.snapshot().preparation.ticket
  f.select('tertiary')
  f.step({ type: 'prepared', ticket: old })
  const ghost = f.controller.snapshot().preparation.ticket
  assert.equal(ghost.instanceId, 'ghost')
  f.step({ type: 'prepareFailed', ticket: ghost, message: 'fixture failure' })
  assert.equal(f.armory.read().request.status, 'failed')
  assert.equal(f.armory.read().request.reason, 'fixture failure')
  assert.equal(f.controller.snapshot().activeId, 'pistol')
  assert.equal(f.controller.snapshot().canFire, true)
  assert.equal(f.armory.canStartChallenge(), true)
  f.select('tertiary')
  f.step()
  const retry = f.controller.snapshot().preparation.ticket
  assert.notEqual(retry.requestId, ghost.requestId)
  f.step({ type: 'prepared', ticket: ghost })
  assert.equal(f.controller.snapshot().activeId, 'pistol')
  f.step({ type: 'prepared', ticket: retry })
  f.armory.present({
    weapon: { instanceId: 'ghost' },
    action: 'idle',
  })
  assert.equal(f.armory.read().request.status, 'ready')
})

test('a later access restriction cannot retroactively fail authority-complete equipment still awaiting P', (t) => {
  let reason = null
  const f = setup(t, () => reason)
  f.select('primary')
  f.step()
  f.prepare()
  assert.equal(f.armory.read().request.status, 'presenting')
  assert.equal(f.armory.canStartChallenge(), true)
  reason = '本局进行中'
  f.step()
  assert.equal(f.armory.read().request.status, 'presenting')
  f.armory.present({
    weapon: { instanceId: 'rifle' },
    action: 'idle',
  })
  assert.equal(f.armory.read().request.status, 'ready')
  assert.equal(f.armory.read().available, false)
})

test('paused requests wait, and newer physical selection supersedes an uncommitted shop request', (t) => {
  const f = setup(t)
  f.armory.setPaused(true)
  f.controller.setPaused(true)
  f.select('primary')
  let queued = 0
  f.armory.beforeFixed(() => {
    queued++
    return true
  })
  assert.equal(queued, 0)
  assert.equal(f.armory.read().request.status, 'queued')
  f.armory.setPaused(false)
  f.controller.setPaused(false)
  f.armory.supersede()
  f.step({ type: 'selectSlot', slotId: 'tertiary' })
  assert.equal(f.controller.snapshot().preparation.ticket.instanceId, 'ghost')
  assert.equal(f.armory.read().request.status, 'superseded')
})

test('lifecycle invalidation changes scope; a read model is small, immutable and reused while unchanged', (t) => {
  const f = setup(t)
  const initial = f.armory.read()
  assert.equal(f.armory.read(), initial)
  assert.ok(Object.isFrozen(initial))
  assert.equal(Object.hasOwn(initial, 'inventory'), false)
  assert.equal(Object.hasOwn(initial, 'recentEvents'), false)
  f.select('primary')
  const oldScope = f.armory.scopeId
  f.armory.setEnabled(false)
  f.controller.suspend()
  assert.notEqual(f.armory.scopeId, oldScope)
  assert.equal(f.armory.request({ scopeId: oldScope, requestId: 20, slotId: 'primary' }).accepted, false)
  assert.equal(f.armory.read().request, null)
  assert.equal(f.armory.read().available, false)
  f.armory.setEnabled(true)
  f.armory.invalidate()
  assert.equal(f.armory.read().request, null)
  f.armory.dispose()
  assert.equal(f.select('primary').accepted, false)
})

test('bundled shop images match their recorded source bytes', () => {
  const root = new URL('../src/app/assets/armory/', import.meta.url)
  const provenance = JSON.parse(fs.readFileSync(new URL('provenance.json', root), 'utf8'))
  assert.equal(provenance.runtimeNetworkDependency, false)
  assert.deepEqual(provenance.files.map(({ id }) => `${id}.png`).sort(), fs.readdirSync(root).filter(name => name.endsWith('.png')).sort())
  for (const entry of provenance.files) {
    const bytes = fs.readFileSync(new URL(`${entry.id}.png`, root))
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256)
  }
})
