import assert from 'node:assert/strict'
import test from 'node:test'
import { classicDefinition } from '../src/game/weapons/definitions/classic.js'
import { phantomDefinition } from '../src/game/weapons/definitions/phantom.js'
import { WeaponInventory } from '../src/game/weapons/inventory.js'
import { createWeaponDefinition } from '../src/game/weapons/weapon-definition.js'

function loadout() {
  return {
    definitions: [
      structuredClone(classicDefinition),
      structuredClone(phantomDefinition),
    ],
    slots: [
      {
        id: 'primary',
        weapon: { instanceId: 'rifle', definitionId: 'phantom' },
      },
      {
        id: 'secondary',
        weapon: { instanceId: 'pistol', definitionId: 'classic' },
      },
      {
        id: 'spare',
        weapon: {
          instanceId: 'other-pistol',
          definitionId: 'classic',
          skinId: 'sakura',
          magazine: 4,
          reserve: 9,
        },
      },
      { id: 'empty', weapon: null },
    ],
  }
}

test('definitions copy and deeply freeze configuration without freezing the source', () => {
  const source = structuredClone(classicDefinition)
  const definition = createWeaponDefinition(source)
  source.fire.interval = 10
  source.reload.empty.feed = 0
  source.assets.defaultSkinId = 'other'
  assert.equal(definition.fire.interval, 60 / 405)
  assert.equal(definition.reload.empty.feed, 1.75)
  assert.equal(definition.assets.defaultSkinId, 'ag')
  for (const value of [
    definition,
    definition.fire,
    definition.equip,
    definition.reload,
    definition.reload.tactical,
    definition.reload.empty,
    definition.capabilities,
    definition.assets,
  ]) {
    assert.ok(Object.isFrozen(value))
  }
  assert.throws(() => {
    definition.reload.tactical.duration = 0
  }, TypeError)
  assert.equal(Object.isFrozen(source), false)
  assert.equal(Object.isFrozen(source.reload.empty), false)
})

test('definition validation rejects unsupported capabilities and invalid gameplay timing', () => {
  const cases = [
    [
      'empty id',
      d => d.id = '',
      /id/,
    ],
    [
      'zero capacity',
      d => d.capacity = 0,
      /capacity/,
    ],
    [
      'fractional capacity',
      d => d.capacity = 1.5,
      /capacity/,
    ],
    [
      'unsafe reserve',
      d => d.initialReserve = Number.MAX_SAFE_INTEGER + 1,
      /initialReserve/,
    ],
    [
      'negative reserve',
      d => d.initialReserve = -1,
      /initialReserve/,
    ],
    [
      'unsupported fire mode',
      d => d.fire.mode = 'burst',
      /fire.mode/,
    ],
    [
      'zero shot interval',
      d => d.fire.interval = 0,
      /fire.interval/,
    ],
    [
      'infinite shot interval',
      d => d.fire.interval = Infinity,
      /fire.interval/,
    ],
    [
      'negative draw',
      d => d.equip.draw = -1,
      /equip.draw/,
    ],
    [
      'NaN holster',
      d => d.equip.holster = Number.NaN,
      /equip.holster/,
    ],
    [
      'late feed',
      d => d.reload.empty.feed = 5,
      /feed/,
    ],
    [
      'negative inspect',
      d => d.inspectDuration = -1,
      /inspectDuration/,
    ],
    [
      'nonboolean ADS',
      d => d.capabilities.ads = 'yes',
      /capabilities.ads/,
    ],
    [
      'missing asset version',
      d => delete d.assets.assetVersion,
      /assetVersion/,
    ],
    [
      'unknown nested field',
      d => d.fire.rpm = 405,
      /not supported/,
    ],
    [
      'malformed recoil',
      d => d.recoil = {},
      /curve/,
    ],
  ]
  for (const [name, change, expected] of cases) {
    const source = structuredClone(classicDefinition)
    change(source)
    assert.throws(() => createWeaponDefinition(source), expected, name)
  }
  assert.throws(() => createWeaponDefinition(null), /plain object/)
  assert.throws(() => createWeaponDefinition([]), /plain object/)
})

test('Classic and Phantom preserve source timings and explicit project loadout defaults', () => {
  assert.equal(classicDefinition.capacity, 12)
  assert.equal(classicDefinition.initialReserve, 36)
  assert.deepEqual(classicDefinition.fire, { mode: 'semi', interval: 60 / 405 })
  assert.deepEqual(classicDefinition.equip, { draw: 0.75, holster: 0 })
  assert.deepEqual(classicDefinition.reload.tactical, { feed: 1.75, duration: 1.75 })
  assert.deepEqual(classicDefinition.reload.empty, { feed: 1.75, duration: 1.75 })
  assert.equal(classicDefinition.capabilities.ads, false)
  assert.equal(classicDefinition.assets.assetVersion, 'v4')
  assert.equal(classicDefinition.assets.defaultSkinId, 'ag')
  assert.deepEqual(classicDefinition.assets.skinIds, ['ag', 'smite', 'sakura'])
  assert.equal(phantomDefinition.capacity, 30)
  assert.equal(phantomDefinition.initialReserve, 90)
  assert.deepEqual(phantomDefinition.fire, { mode: 'auto', interval: 60 / 660 })
  assert.deepEqual(phantomDefinition.equip, { draw: 1, holster: 0 })
  assert.deepEqual(phantomDefinition.reload.tactical, { feed: 1.2, duration: 2.5 })
  assert.deepEqual(phantomDefinition.reload.empty, { feed: 2.25, duration: 2.5 })
  assert.equal(phantomDefinition.capabilities.ads, true)
  assert.equal(phantomDefinition.assets.assetVersion, 'v3')
  assert.equal(phantomDefinition.assets.defaultSkinId, 'tactiplay')
  assert.deepEqual(phantomDefinition.assets.skinIds, ['tactiplay', 'smite', 'rush', 'prism'])
})

test('inventory resolves slots and defaults without conflating slots, definitions or instances', () => {
  const inventory = new WeaponInventory(loadout())
  assert.deepEqual(inventory.ids(), ['rifle', 'pistol', 'other-pistol'])
  assert.equal(inventory.instanceAt('secondary'), 'pistol')
  assert.equal(inventory.slotFor('other-pistol'), 'spare')
  assert.equal(inventory.definition('pistol').id, 'classic')
  assert.equal(inventory.definition('pistol'), inventory.definition('other-pistol'))
  assert.deepEqual(inventory.get('pistol'), {
    instanceId: 'pistol',
    definitionId: 'classic',
    skinId: 'ag',
    magazine: 12,
    reserve: 36,
    nextFireAt: 0,
    blockedUntil: 0,
    shotSequence: 0,
  })
  assert.equal(inventory.get('other-pistol').skinId, 'sakura')
  assert.equal(inventory.get('other-pistol').magazine, 4)
  assert.equal(inventory.get('other-pistol').reserve, 9)
  assert.equal(inventory.instanceAt('empty'), null)
  assert.equal(inventory.instanceAt('missing'), null)
  assert.equal(inventory.slotFor('missing'), null)
  assert.equal(inventory.get('missing'), null)
  assert.equal(inventory.definition('missing'), null)
  assert.deepEqual(new WeaponInventory({ definitions: [], slots: [] }).snapshot(), { slots: [], weapons: [] })
})

test('inventory owns its input and keeps same-gun instances and inventory copies independent', () => {
  const source = loadout()
  const inventory = new WeaponInventory(source)
  const second = new WeaponInventory(source)
  source.definitions[0].capacity = 1
  source.definitions[0].reload.tactical.feed = 0
  source.slots[1].weapon.magazine = 0
  source.slots[1].id = 'changed'
  source.slots.length = 0
  assert.equal(inventory.definition('pistol').capacity, 12)
  assert.equal(inventory.definition('pistol').reload.tactical.feed, 1.75)
  assert.equal(inventory.instanceAt('secondary'), 'pistol')
  assert.equal(inventory.get('pistol').magazine, 12)
  const before = inventory.snapshot()
  const updated = inventory.update('pistol', {
    magazine: 11,
    reserve: 30,
    nextFireAt: 2,
    blockedUntil: 3,
    shotSequence: 1,
  })
  assert.equal(updated.magazine, 11)
  assert.equal(inventory.get('other-pistol').magazine, 4)
  assert.equal(second.get('pistol').magazine, 12)
  assert.equal(before.weapons[1].magazine, 12)
  assert.equal(inventory.snapshot().weapons[1].magazine, 11)
})

test('all inventory reads are immutable and cannot bypass controlled updates', () => {
  const inventory = new WeaponInventory(loadout())
  const snapshot = inventory.snapshot()
  for (const value of [
    snapshot,
    snapshot.slots,
    ...snapshot.slots,
    snapshot.weapons,
    ...snapshot.weapons,
    inventory.ids(),
    inventory.get('pistol'),
    inventory.update('pistol', {}),
  ]) {
    assert.ok(Object.isFrozen(value))
  }
  assert.throws(() => {
    snapshot.weapons[1].magazine = 0
  }, TypeError)
  assert.throws(() => {
    snapshot.slots[1].instanceId = 'rifle'
  }, TypeError)
  assert.throws(() => {
    inventory.definition('pistol').fire.interval = 0
  }, TypeError)
  assert.throws(() => inventory.ids().push('injected'), TypeError)
  assert.equal(inventory.get('pistol').magazine, 12)
})

test('inventory rejects duplicate identity and malformed loadouts', () => {
  const cases = [
    [
      d => d.definitions.push(d.definitions[0]),
      /Duplicate weapon definition/,
    ],
    [
      d => d.slots.push({ id: 'empty', weapon: null }),
      /Duplicate slot/,
    ],
    [
      d => d.slots[2].weapon.instanceId = 'pistol',
      /Duplicate weapon instance/,
    ],
    [
      d => d.slots[1].weapon.definitionId = 'absent',
      /Unknown weapon definition/,
    ],
    [
      d => d.slots[1].weapon.instanceId = '',
      /instanceId/,
    ],
    [
      d => d.slots[1].weapon.skinId = ' ',
      /skinId/,
    ],
    [
      d => d.slots[1].weapon.magazine = 13,
      /capacity/,
    ],
    [
      d => d.slots[1].weapon.magazine = -1,
      /magazine/,
    ],
    [
      d => d.slots[1].weapon.magazine = 0.5,
      /magazine/,
    ],
    [
      d => d.slots[1].weapon.reserve = null,
      /reserve/,
    ],
    [
      d => d.slots[1].weapon.reserve = Infinity,
      /reserve/,
    ],
    [
      d => d.slots[1].weapon.nextFireAt = 5,
      /not supported/,
    ],
    [
      d => delete d.slots[1].weapon,
      /plain object/,
    ],
  ]
  for (const [change, expected] of cases) {
    const source = loadout()
    change(source)
    assert.throws(() => new WeaponInventory(source), expected)
  }
  assert.throws(() => new WeaponInventory({ definitions: [], slots: null }), /arrays/)
  assert.throws(() => new WeaponInventory({
    definitions: [],
    slots: Array.from({ length: 1 }),
  }), /plain object/)
  const sparseSlots = []
  sparseSlots.length = 1
  assert.throws(() => new WeaponInventory({ definitions: [], slots: sparseSlots }), /plain object/)
})

test('invalid state patches are atomic and cannot replace identity or insert unsupported state', () => {
  const inventory = new WeaponInventory(loadout())
  const before = inventory.get('pistol')
  for (const patch of [
    { magazine: 11, reserve: -1 },
    { magazine: 13 },
    { magazine: 0.5 },
    { magazine: Number.NaN },
    { reserve: Number.MAX_SAFE_INTEGER + 1 },
    { nextFireAt: -1 },
    { nextFireAt: Infinity },
    { blockedUntil: Number.NaN },
    { shotSequence: -1 },
    { shotSequence: 0.5 },
    { instanceId: 'other-pistol' },
    { definitionId: 'phantom' },
    { skinId: 'other' },
    { unsupported: true },
    { reserve: undefined },
  ]) {
    assert.throws(() => inventory.update('pistol', patch))
    assert.deepEqual(inventory.get('pistol'), before)
  }
  assert.throws(() => inventory.update('missing', {}), /Unknown weapon instance/)
  assert.throws(() => inventory.update('pistol', null), /plain object/)
  const patch = {
    magazine: 0,
    reserve: 0,
    nextFireAt: 0,
    blockedUntil: 0,
    shotSequence: 0,
  }
  inventory.update('pistol', patch)
  patch.magazine = 12
  assert.equal(inventory.get('pistol').magazine, 0)
})
