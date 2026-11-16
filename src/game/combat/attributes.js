function record(value, name, fields) {
  if (value === null || typeof value !== 'object'
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError(`${name} must be a plain object`)
  }
  if (fields) {
    for (const key of Reflect.ownKeys(value)) {
      if (!fields.includes(key))
        throw new TypeError(`${name}.${String(key)} is not supported`)
    }
  }
}

function points(value, name, positive = false) {
  if (!Number.isFinite(value) || value < 0 || (positive && value === 0))
    throw new RangeError(`${name} must be finite ${positive ? 'positive' : 'nonnegative'} points`)
  return value === 0
    ? 0
    : value
}

/** Pure settlement: armor absorbs at most two thirds; any shortfall reaches health. */
export function resolveDamage(state, amount) {
  record(state, 'state')
  const health = points(state.health, 'health')
  const armor = points(state.armor, 'armor')
  const damage = points(amount, 'damage')
  // Validate even a dead target's request, but never drain its remaining armor.
  const armorDamage = health > 0
    ? Math.min(armor, damage * (2 / 3))
    : 0
  const healthDamage = health > 0
    ? Math.min(health, damage - armorDamage)
    : 0
  const nextHealth = health - healthDamage
  return Object.freeze({
    health: nextHealth,
    armor: armor - armorDamage,
    healthDamage,
    armorDamage,
    killed: health > 0 && nextHealth === 0,
  })
}

/** Object-local gameplay state; no tick, rendering, subscriptions or global registration. */
export class CombatAttributes {
  #maxHealth
  #maxArmor
  #health
  #armor

  constructor(input = {}) {
    record(input, 'attributes', ['maxHealth', 'maxArmor'])
    const maxHealth = Object.hasOwn(input, 'maxHealth')
      ? input.maxHealth
      : 100
    const maxArmor = Object.hasOwn(input, 'maxArmor')
      ? input.maxArmor
      : 0
    this.#maxHealth = points(maxHealth, 'maxHealth', true)
    this.#maxArmor = points(maxArmor, 'maxArmor')
    this.#health = this.#maxHealth
    this.#armor = this.#maxArmor
  }

  /** Validate and compute the complete result before committing either value. */
  applyDamage(amount) {
    const result = resolveDamage({ health: this.#health, armor: this.#armor }, amount)
    this.#health = result.health
    this.#armor = result.armor
    return result
  }

  /** The future owning gameplay object chooses when a respawn/reset is committed. */
  reset() {
    this.#health = this.#maxHealth
    this.#armor = this.#maxArmor
    return this.snapshot()
  }

  snapshot() {
    return Object.freeze({
      maxHealth: this.#maxHealth,
      maxArmor: this.#maxArmor,
      health: this.#health,
      armor: this.#armor,
      alive: this.#health > 0,
    })
  }
}
