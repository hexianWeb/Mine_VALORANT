import assert from 'node:assert/strict'
import test from 'node:test'
import { CombatAttributes, resolveDamage } from '../src/game/combat/index.js'

function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`)
}

test('combat attributes start full with explicit health and armor limits', () => {
  assert.deepEqual(new CombatAttributes().snapshot(), {
    maxHealth: 100,
    maxArmor: 0,
    health: 100,
    armor: 0,
    alive: true,
  })
  assert.deepEqual(new CombatAttributes({ maxHealth: 150, maxArmor: 50 }).snapshot(), {
    maxHealth: 150,
    maxArmor: 50,
    health: 150,
    armor: 50,
    alive: true,
  })
})

test('combat attributes copy configuration without retaining or freezing the source', () => {
  const source = { maxHealth: 100, maxArmor: 50 }
  const attributes = new CombatAttributes(source)
  assert.equal(Object.isFrozen(source), false)
  source.maxHealth = 1
  source.maxArmor = 0
  assert.equal(attributes.snapshot().maxHealth, 100)
  assert.equal(attributes.snapshot().maxArmor, 50)
  assert.equal(attributes.snapshot().armor, 50)

  const plain = Object.assign(Object.create(null), { maxHealth: 75, maxArmor: 25 })
  assert.equal(new CombatAttributes(plain).snapshot().health, 75)
})

test('unarmored damage is applied directly to health', () => {
  assert.deepEqual(resolveDamage({ health: 100, armor: 0 }, 30), {
    health: 70,
    armor: 0,
    healthDamage: 30,
    armorDamage: 0,
    killed: false,
  })
})

test('armor absorbs two thirds of damage rather than acting as a shield', () => {
  const attributes = new CombatAttributes({ maxArmor: 50 })
  assert.deepEqual(attributes.applyDamage(30), {
    health: 90,
    armor: 30,
    healthDamage: 10,
    armorDamage: 20,
    killed: false,
  })
  assert.equal(attributes.snapshot().alive, true)
})

test('insufficient armor sends all unabsorbed damage to health', () => {
  assert.deepEqual(resolveDamage({ health: 100, armor: 5 }, 30), {
    health: 75,
    armor: 0,
    healthDamage: 25,
    armorDamage: 5,
    killed: false,
  })
})

test('armor can be depleted exactly without discarding health damage', () => {
  const attributes = new CombatAttributes({ maxArmor: 20 })
  attributes.applyDamage(30)
  assert.equal(attributes.snapshot().health, 90)
  assert.equal(attributes.snapshot().armor, 0)
  assert.deepEqual(attributes.applyDamage(30), {
    health: 60,
    armor: 0,
    healthDamage: 30,
    armorDamage: 0,
    killed: false,
  })
})

test('fractional damage is not rounded to integer health or armor', () => {
  const attributes = new CombatAttributes({ maxArmor: 50 })
  const result = attributes.applyDamage(1)
  near(result.healthDamage, 1 / 3)
  near(result.armorDamage, 2 / 3)
  near(result.health, 100 - 1 / 3)
  near(result.armor, 50 - 2 / 3)
})

test('zero damage is a no-op and does not report a death', () => {
  const attributes = new CombatAttributes({ maxArmor: 50 })
  const before = attributes.snapshot()
  assert.deepEqual(attributes.applyDamage(0), {
    health: 100,
    armor: 50,
    healthDamage: 0,
    armorDamage: 0,
    killed: false,
  })
  assert.deepEqual(attributes.snapshot(), before)
})

test('lethal damage is clamped and killed reports only the live-to-dead transition', () => {
  const attributes = new CombatAttributes({ maxHealth: 10, maxArmor: 50 })
  assert.deepEqual(attributes.applyDamage(60), {
    health: 0,
    armor: 10,
    healthDamage: 10,
    armorDamage: 40,
    killed: true,
  })
  assert.equal(attributes.snapshot().alive, false)
  assert.deepEqual(attributes.applyDamage(60), {
    health: 0,
    armor: 10,
    healthDamage: 0,
    armorDamage: 0,
    killed: false,
  })
})

test('overkill and the largest finite damage cannot produce negative or infinite attributes', () => {
  for (const amount of [150, 1000, Number.MAX_VALUE]) {
    const attributes = new CombatAttributes({ maxArmor: 50 })
    assert.deepEqual(attributes.applyDamage(amount), {
      health: 0,
      armor: 0,
      healthDamage: 100,
      armorDamage: 50,
      killed: true,
    })
  }
})

test('reset restores configured limits and allows a new death transition', () => {
  const attributes = new CombatAttributes({ maxHealth: 75, maxArmor: 25 })
  attributes.applyDamage(200)
  assert.deepEqual(attributes.reset(), {
    maxHealth: 75,
    maxArmor: 25,
    health: 75,
    armor: 25,
    alive: true,
  })
  assert.deepEqual(attributes.reset(), attributes.snapshot())
  assert.equal(attributes.applyDamage(200).killed, true)
})

test('attribute instances do not share mutable health or armor', () => {
  const config = { maxHealth: 100, maxArmor: 50 }
  const first = new CombatAttributes(config)
  const second = new CombatAttributes(config)
  first.applyDamage(30)
  assert.equal(first.snapshot().health, 90)
  assert.equal(second.snapshot().health, 100)
  assert.equal(second.snapshot().armor, 50)
})

test('snapshots and damage results are frozen and detached from later changes', () => {
  const attributes = new CombatAttributes({ maxArmor: 50 })
  const before = attributes.snapshot()
  const result = attributes.applyDamage(30)
  const after = attributes.snapshot()
  for (const value of [
    before,
    result,
    after,
    attributes.reset(),
  ]) {
    assert.equal(Object.isFrozen(value), true)
    assert.throws(() => {
      value.health = 0
    }, TypeError)
  }
  assert.equal(before.health, 100)
  assert.equal(result.health, 90)
  assert.equal(after.health, 90)
  assert.equal(attributes.snapshot().health, 100)
})

test('damage resolution is pure and accepts a read-only attribute snapshot', () => {
  const attributes = new CombatAttributes({ maxArmor: 50 })
  const state = attributes.snapshot()
  const first = resolveDamage(state, 30)
  const second = resolveDamage(state, 30)
  assert.deepEqual(first, second)
  assert.notEqual(first, second)
  assert.equal(Object.isFrozen(first), true)
  assert.equal(attributes.snapshot().health, 100)

  const mutable = { health: 100, armor: 50 }
  resolveDamage(mutable, 30)
  assert.deepEqual(mutable, { health: 100, armor: 50 })
  assert.equal(Object.isFrozen(mutable), false)
})

test('invalid configuration is rejected instead of silently accepting attribute typos', () => {
  for (const input of [
    null,
    [],
    new Date(),
    100,
    '100',
  ]) {
    assert.throws(() => new CombatAttributes(input), TypeError)
  }
  for (const input of [
    { health: 100 },
    { maxArmour: 50 },
    { [Symbol('armor')]: 50 },
  ]) {
    assert.throws(() => new CombatAttributes(input), TypeError)
  }
  for (const maxHealth of [
    undefined,
    null,
    0,
    -1,
    Number.NaN,
    Infinity,
    '100',
  ]) {
    assert.throws(() => new CombatAttributes({ maxHealth }), RangeError)
  }
  for (const maxArmor of [
    undefined,
    null,
    -1,
    Number.NaN,
    Infinity,
    '50',
  ]) {
    assert.throws(() => new CombatAttributes({ maxArmor }), RangeError)
  }
})

test('invalid damage is rejected atomically, including after death', () => {
  const attributes = new CombatAttributes({ maxArmor: 50 })
  for (const dead of [false, true]) {
    if (dead)
      attributes.applyDamage(1000)
    const before = attributes.snapshot()
    for (const amount of [
      undefined,
      null,
      -1,
      Number.NaN,
      Infinity,
      -Infinity,
      '30',
      {},
      1n,
    ]) {
      assert.throws(() => attributes.applyDamage(amount), RangeError)
      assert.deepEqual(attributes.snapshot(), before)
    }
  }
})

test('pure damage resolution rejects invalid attribute values', () => {
  for (const state of [
    null,
    undefined,
    [],
    new Date(),
    'state',
  ]) {
    assert.throws(() => resolveDamage(state, 30), TypeError)
  }
  for (const value of [
    undefined,
    null,
    -1,
    Number.NaN,
    Infinity,
    '100',
  ]) {
    assert.throws(() => resolveDamage({ health: value, armor: 50 }, 30), RangeError)
    assert.throws(() => resolveDamage({ health: 100, armor: value }, 30), RangeError)
  }
})

test('damage invariants hold across health, armor and fractional damage boundaries', () => {
  for (const health of [0, 0.5, 1, 25, 100]) {
    for (const armor of [0, 0.25, 5, 50]) {
      for (const amount of [0, 0.25, 1, 3, 30, 150, 1000]) {
        const result = resolveDamage({ health, armor }, amount)
        assert.ok(result.health >= 0 && result.health <= health)
        assert.ok(result.armor >= 0 && result.armor <= armor)
        near(health - result.health, result.healthDamage)
        near(armor - result.armor, result.armorDamage)
        assert.ok(result.healthDamage + result.armorDamage <= amount + 1e-10)
        assert.equal(result.killed, health > 0 && result.health === 0)
        if (health === 0) {
          assert.equal(result.healthDamage, 0)
          assert.equal(result.armorDamage, 0)
        }
        else {
          near(result.armorDamage, Math.min(armor, amount * (2 / 3)))
          near(result.healthDamage, Math.min(health, amount - result.armorDamage))
        }
      }
    }
  }
})
