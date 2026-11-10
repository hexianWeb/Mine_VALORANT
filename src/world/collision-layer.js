import { CollisionWorld } from '../engine/function/physics/index.js'

export const collisionLayerConfig = Object.freeze({
  url: '/collision/range-room.json',
  groundThickness: 1,
  killDepth: 10,
  floorTag: '_Floor_',
})

const EPSILON = 1e-4
const isVector = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)

export function validateCollisionData(data) {
  if (data?.schemaVersion !== 1)
    throw new Error('[Collision] Unsupported schemaVersion')
  if (!isVector(data.spawn?.position) || !Number.isFinite(data.spawn?.yawDeg))
    throw new Error('[Collision] Invalid spawn')
  if (!Array.isArray(data.boxes) || !data.boxes.length)
    throw new Error('[Collision] No boxes')
  for (const box of data.boxes) {
    if (typeof box?.name !== 'string' || !isVector(box.min) || !isVector(box.max) || box.min.some((value, i) => value >= box.max[i]))
      throw new Error(`[Collision] Invalid box ${box?.name}`)
  }
  return data
}

/** Room boxes plus a ground box and killY derived from the superflat ground, so collision follows the visuals. */
export function createCollisionLayer(data, ground, config = {}) {
  const settings = {
    ...collisionLayerConfig,
    ...config,
  }
  validateCollisionData(data)
  const { height, outer } = ground
  const world = new CollisionWorld(data.boxes)
  world.add({
    name: 'Ground',
    group: 'Ground',
    min: [outer.minX, height - settings.groundThickness, outer.minZ],
    max: [outer.maxX, height, outer.maxZ],
  })
  const floors = world.boxes.filter(box => box.name.includes(settings.floorTag))
  const killY = height - settings.killDepth
  return {
    world,
    floors,
    killY,
    groundHeight: height,
    spawn: {
      position: [...data.spawn.position],
      yaw: data.spawn.yawDeg * Math.PI / 180,
    },
    /** Below killY, or entirely under a floor box it overlaps horizontally: only reachable by clipping. */
    isOutOfBounds(box) {
      if (box.min[1] < killY)
        return true
      return floors.some(floor => box.min[1] < floor.min[1]
        && box.min[0] < floor.max[0] - EPSILON && box.max[0] > floor.min[0] + EPSILON
        && box.min[2] < floor.max[2] - EPSILON && box.max[2] > floor.min[2] + EPSILON)
    },
    snapshot() {
      return {
        id: data.id,
        boxes: data.boxes.length,
        floors: floors.length,
        groundHeight: height,
        killY,
      }
    },
  }
}

export async function loadCollisionLayer({ ground, signal, config = {} }) {
  const url = config.url ?? collisionLayerConfig.url
  const response = await fetch(url, { signal })
  if (!response.ok)
    throw new Error(`[Collision] ${url}: HTTP ${response.status}`)
  return createCollisionLayer(await response.json(), ground, config)
}
