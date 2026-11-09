import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { overlaps } from '../src/engine/systems/physics/collision-world.js'
import { createCollisionLayer, validateCollisionData } from '../src/world/collision-layer.js'

const data = JSON.parse(fs.readFileSync(new URL('../public/collision/range-room.json', import.meta.url)))
// Runtime model bounds measured in the browser (`__RANGE_ROOM__.world.snapshot().bounds`).
const ROOM_BOUNDS = {
  min: [-25, 7.875, -22.005],
  max: [26, 30.125, 23],
}
const GROUND = {
  height: 7.865,
  outer: {
    minX: -8191.5,
    maxX: 8192.5,
    minZ: -8191.5,
    maxZ: 8192.5,
  },
}
function standing([x, y, z]) {
  return {
    min: [x - 0.3, y, z - 0.3],
    max: [x + 0.3, y + 1.8, z + 0.3],
  }
}

test('exported collision layer is valid and inside the room bounds', () => {
  assert.doesNotThrow(() => validateCollisionData(data))
  assert.equal(data.boxes.length, 390)
  for (const box of data.boxes) {
    for (let i = 0; i < 3; i++) {
      assert.ok(box.min[i] < box.max[i], `${box.name} degenerate on axis ${i}`)
      assert.ok(box.min[i] >= ROOM_BOUNDS.min[i] - 2 && box.max[i] <= ROOM_BOUNDS.max[i] + 2, `${box.name} outside room bounds`)
    }
  }
})

test('spawn stands on a floor without overlapping any box', () => {
  const feet = data.spawn.position
  const body = standing(feet)
  assert.deepEqual(data.boxes.filter(box => overlaps(body, box)).map(box => box.name), [])
  const support = data.boxes.filter(box => box.min[0] <= feet[0] && feet[0] <= box.max[0] && box.min[2] <= feet[2] && feet[2] <= box.max[2] && Math.abs(box.max[1] - feet[1]) < 0.01)
  assert.ok(support.length > 0, 'a floor box is directly under the spawn')
})

test('runtime layer adds the ground box, killY and converts spawn yaw to radians', () => {
  const layer = createCollisionLayer(data, GROUND)
  const ground = layer.world.boxes.at(-1)
  assert.equal(ground.name, 'Ground')
  assert.deepEqual(ground.min, [GROUND.outer.minX, GROUND.height - 1, GROUND.outer.minZ])
  assert.deepEqual(ground.max, [GROUND.outer.maxX, GROUND.height, GROUND.outer.maxZ])
  assert.ok(Math.abs(layer.killY - (GROUND.height - 10)) < 1e-9)
  assert.equal(layer.floors.length, 50)
  assert.ok(Math.abs(layer.spawn.yaw - data.spawn.yawDeg * Math.PI / 180) < 1e-12)
  assert.deepEqual(layer.snapshot(), {
    id: data.id,
    boxes: 390,
    floors: 50,
    groundHeight: GROUND.height,
    killY: layer.killY,
  })
})

test('out of bounds: below killY or under a floor box, but not beside one', () => {
  const layer = createCollisionLayer({
    schemaVersion: 1,
    spawn: {
      position: [0, 1, 0],
      yawDeg: 0,
    },
    boxes: [
      {
        name: 'COL_Test_Floor_01',
        min: [-5, 0.5, -5],
        max: [5, 1, 5],
      },
    ],
  }, {
    height: 0,
    outer: {
      minX: -100,
      maxX: 100,
      minZ: -100,
      maxZ: 100,
    },
  })
  assert.equal(layer.isOutOfBounds(standing([0, 1, 0])), false, 'on top of the floor')
  assert.equal(layer.isOutOfBounds(standing([0, 0, 0])), true, 'under the floor')
  assert.equal(layer.isOutOfBounds(standing([5.3, 0, 0])), false, 'touching the floor side from outside')
  assert.equal(layer.isOutOfBounds(standing([20, -10.5, 0])), true, 'below killY')
  assert.equal(layer.isOutOfBounds(standing([20, 0, 0])), false, 'on the ground')
})

test('validation rejects broken data', () => {
  const box = {
    name: 'a',
    min: [0, 0, 0],
    max: [1, 1, 1],
  }
  const valid = {
    schemaVersion: 1,
    spawn: {
      position: [0, 0, 0],
      yawDeg: 0,
    },
    boxes: [box],
  }
  assert.throws(() => validateCollisionData({ ...valid, schemaVersion: 2 }), /schemaVersion/)
  assert.throws(() => validateCollisionData({
    ...valid,
    spawn: {
      position: [0, 0],
      yawDeg: 0,
    },
  }), /spawn/)
  assert.throws(() => validateCollisionData({ ...valid, boxes: [] }), /boxes/)
  assert.throws(() => validateCollisionData({
    ...valid,
    boxes: [
      {
        ...box,
        max: [1, 0, 1],
      },
    ],
  }), /Invalid box a/)
})
