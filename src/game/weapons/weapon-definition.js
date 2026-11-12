import { createAimProfile } from './aim-profile.js'

function record(value, name, fields) {
  if (value === null || typeof value !== 'object'
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError(`${name} must be a plain object`)
  }
  for (const key of Reflect.ownKeys(value)) {
    if (!fields.includes(key))
      throw new TypeError(`${name}.${String(key)} is not supported`)
  }
  return value
}

function identifier(value, name) {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value)
    throw new TypeError(`${name} must be a nonempty, trimmed string`)
  return value
}

function integer(value, name, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum)
    throw new RangeError(`${name} must be a safe integer >= ${minimum}`)
  return value
}

function seconds(value, name, positive = false) {
  if (!Number.isFinite(value) || value < 0 || (positive && value === 0))
    throw new RangeError(`${name} must be finite ${positive ? 'positive' : 'nonnegative'} seconds`)
  return value
}

function reloadPlan(value, name) {
  record(value, name, ['feed', 'duration'])
  const feed = seconds(value.feed, `${name}.feed`)
  const duration = seconds(value.duration, `${name}.duration`)
  if (feed > duration)
    throw new RangeError(`${name}.feed must not exceed duration`)
  return Object.freeze({ feed, duration })
}

/** Copy validated gameplay data; no source configuration object is retained or frozen. */
export function createWeaponDefinition(input) {
  record(input, 'definition', [
    'id',
    'capacity',
    'initialReserve',
    'fire',
    'equip',
    'reload',
    'inspectDuration',
    'capabilities',
    'assets',
    'recoil',
    'spread',
    'aim',
  ])
  record(input.fire, 'fire', ['mode', 'interval'])
  record(input.equip, 'equip', ['draw', 'holster'])
  record(input.reload, 'reload', ['tactical', 'empty'])
  record(input.capabilities, 'capabilities', ['ads'])
  record(input.assets, 'assets', [
    'modelId',
    'assetVersion',
    'defaultSkinId',
    'skinIds',
  ])
  if (!['semi', 'auto'].includes(input.fire.mode))
    throw new TypeError('fire.mode must be semi or auto')
  if (typeof input.capabilities.ads !== 'boolean')
    throw new TypeError('capabilities.ads must be a boolean')
  const defaultSkinId = identifier(input.assets.defaultSkinId, 'assets.defaultSkinId')
  const skinIds = input.assets.skinIds ?? [defaultSkinId]
  if (!Array.isArray(skinIds) || !skinIds.includes(defaultSkinId)
    || new Set(skinIds).size !== skinIds.length) {
    throw new TypeError('assets.skinIds must be unique and include defaultSkinId')
  }
  for (const skinId of skinIds) identifier(skinId, 'assets.skinIds')

  return Object.freeze({
    ...createAimProfile(input),
    id: identifier(input.id, 'id'),
    capacity: integer(input.capacity, 'capacity', 1),
    initialReserve: integer(input.initialReserve, 'initialReserve'),
    fire: Object.freeze({
      mode: input.fire.mode,
      interval: seconds(input.fire.interval, 'fire.interval', true),
    }),
    equip: Object.freeze({
      draw: seconds(input.equip.draw, 'equip.draw'),
      holster: seconds(input.equip.holster, 'equip.holster'),
    }),
    reload: Object.freeze({
      tactical: reloadPlan(input.reload.tactical, 'reload.tactical'),
      empty: reloadPlan(input.reload.empty, 'reload.empty'),
    }),
    inspectDuration: seconds(input.inspectDuration, 'inspectDuration'),
    capabilities: Object.freeze({ ads: input.capabilities.ads }),
    assets: Object.freeze({
      modelId: identifier(input.assets.modelId, 'assets.modelId'),
      assetVersion: identifier(input.assets.assetVersion, 'assets.assetVersion'),
      defaultSkinId,
      skinIds: Object.freeze([...skinIds]),
    }),
  })
}
