import { createWeaponDefinition } from './weapon-definition.js'

const mutableFields = [
  'magazine',
  'reserve',
  'nextFireAt',
  'blockedUntil',
  'shotSequence',
]

function record(value, name, fields) {
  if (value === null || typeof value !== 'object'
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError(`${name} must be a plain object`)
  }
  for (const key of Reflect.ownKeys(value)) {
    if (!fields.includes(key))
      throw new TypeError(`${name}.${String(key)} is not supported`)
  }
}

function identifier(value, name) {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value)
    throw new TypeError(`${name} must be a nonempty, trimmed string`)
  return value
}

function validateState(state, definition) {
  for (const key of ['magazine', 'reserve', 'shotSequence']) {
    if (!Number.isSafeInteger(state[key]) || state[key] < 0)
      throw new RangeError(`${key} must be a nonnegative safe integer`)
  }
  if (state.magazine > definition.capacity)
    throw new RangeError('magazine must not exceed capacity')
  for (const key of ['nextFireAt', 'blockedUntil']) {
    if (!Number.isFinite(state[key]) || state[key] < 0)
      throw new RangeError(`${key} must be finite nonnegative seconds`)
  }
}

/** Controller-owned state. Every public read is immutable and detached from later updates. */
export class WeaponInventory {
  #definitions = new Map()
  #weapons = new Map()
  #slotInstances = new Map()
  #instanceSlots = new Map()
  #slots

  constructor(input) {
    record(input, 'inventory', ['definitions', 'slots'])
    if (!Array.isArray(input.definitions) || !Array.isArray(input.slots))
      throw new TypeError('definitions and slots must be arrays')

    for (const source of input.definitions) {
      const definition = createWeaponDefinition(source)
      if (this.#definitions.has(definition.id))
        throw new Error(`Duplicate weapon definition: ${definition.id}`)
      this.#definitions.set(definition.id, definition)
    }

    this.#slots = Object.freeze(Array.from(input.slots, (slot) => {
      record(slot, 'slot', ['id', 'weapon'])
      const slotId = identifier(slot.id, 'slot.id')
      if (this.#slotInstances.has(slotId))
        throw new Error(`Duplicate slot: ${slotId}`)

      let instanceId = null
      if (slot.weapon !== null) {
        const source = slot.weapon
        record(source, 'weapon', [
          'instanceId',
          'definitionId',
          'skinId',
          'magazine',
          'reserve',
        ])
        instanceId = identifier(source.instanceId, 'weapon.instanceId')
        const definitionId = identifier(source.definitionId, 'weapon.definitionId')
        if (this.#weapons.has(instanceId))
          throw new Error(`Duplicate weapon instance: ${instanceId}`)
        const definition = this.#definitions.get(definitionId)
        if (!definition)
          throw new Error(`Unknown weapon definition: ${definitionId}`)

        const state = {
          instanceId,
          definitionId,
          skinId: identifier(Object.hasOwn(source, 'skinId')
            ? source.skinId
            : definition.assets.defaultSkinId, 'weapon.skinId'),
          magazine: Object.hasOwn(source, 'magazine')
            ? source.magazine
            : definition.capacity,
          reserve: Object.hasOwn(source, 'reserve')
            ? source.reserve
            : definition.initialReserve,
          nextFireAt: 0,
          blockedUntil: 0,
          shotSequence: 0,
        }
        validateState(state, definition)
        this.#weapons.set(instanceId, state)
        this.#instanceSlots.set(instanceId, slotId)
      }
      this.#slotInstances.set(slotId, instanceId)
      return Object.freeze({ id: slotId, instanceId })
    }))
  }

  definition(instanceId) {
    const state = this.#weapons.get(instanceId)
    return state
      ? this.#definitions.get(state.definitionId)
      : null
  }

  get(instanceId) {
    const state = this.#weapons.get(instanceId)
    return state
      ? Object.freeze({ ...state })
      : null
  }

  /** Validate the complete replacement before changing any state. Identity is never patchable. */
  update(instanceId, patch) {
    const state = this.#weapons.get(instanceId)
    if (!state)
      throw new Error(`Unknown weapon instance: ${instanceId}`)
    record(patch, 'patch', mutableFields)
    const next = {
      ...state,
      ...patch,
    }
    validateState(next, this.#definitions.get(state.definitionId))
    this.#weapons.set(instanceId, next)
    return this.get(instanceId)
  }

  /** Returns an instance ID, or null for an empty or unknown slot. */
  instanceAt(slotId) {
    return this.#slotInstances.get(slotId) ?? null
  }

  slotFor(instanceId) {
    return this.#instanceSlots.get(instanceId) ?? null
  }

  ids() {
    return Object.freeze([
      ...this.#weapons.keys(),
    ])
  }

  snapshot() {
    return Object.freeze({
      slots: this.#slots,
      weapons: Object.freeze(this.ids().map(id => this.get(id))),
    })
  }
}
