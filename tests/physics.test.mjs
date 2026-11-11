import assert from 'node:assert/strict'
import test from 'node:test'
import { moveAABB } from '../src/engine/runtime/function/controller/character-controller.js'
import { CollisionWorld, createPhysicsSystem, overlaps } from '../src/engine/runtime/function/physics/index.js'

function player(x, y, z, height = 1.8) {
  return {
    min: [x - 0.3, y, z - 0.3],
    max: [x + 0.3, y + height, z + 0.3],
  }
}
const floor = {
  name: 'floor',
  min: [-10, -1, -10],
  max: [10, 0, 10],
}
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} != ${expected}`)

test('overlap is strict and query returns only intersecting boxes', () => {
  const world = new CollisionWorld([
    floor,
    {
      name: 'far',
      min: [50, 0, 50],
      max: [51, 1, 51],
    },
  ])
  assert.equal(overlaps(player(0, 0, 0), floor), false, 'touching faces do not overlap')
  assert.equal(overlaps(player(0, -0.1, 0), floor), true)
  assert.deepEqual(world.queryAABB(player(0, -0.1, 0)).map(box => box.name), ['floor'])
  const added = world.add({
    name: 'wall',
    min: [1, 0, -1],
    max: [2, 2, 1],
  })
  assert.equal(world.boxes.at(-1), added)
})

test('falls and lands on the floor', () => {
  const world = new CollisionWorld([floor])
  const box = player(0, 1, 0)
  const result = moveAABB(world, box, [0, -2, 0])
  near(box.min[1], 0, 'feet')
  assert.equal(result.hitY, true)
  assert.equal(result.grounded, true)
})

test('slides along a wall and does not stick in a corner', () => {
  const world = new CollisionWorld([
    floor,
    {
      name: 'wallX',
      min: [1, 0, -5],
      max: [2, 3, 5],
    },
    {
      name: 'wallZ',
      min: [-5, 0, 1],
      max: [5, 3, 2],
    },
  ])
  const slide = player(0, 0, -2)
  const a = moveAABB(world, slide, [2, -0.01, 1])
  near(slide.max[0], 1, 'clamped at wall')
  near(slide.min[2], -2.3 + 1, 'slid along z')
  assert.equal(a.hitX, true)
  assert.equal(a.hitZ, false)
  const corner = player(0, 0, 0)
  moveAABB(world, corner, [2, -0.01, 2])
  near(corner.max[0], 1, 'corner x')
  near(corner.max[2], 1, 'corner z')
})

test('steps up a 0.5 m slab but is blocked by a full block', () => {
  const slab = new CollisionWorld([
    floor,
    {
      name: 'slab',
      min: [0.5, 0, -2],
      max: [3, 0.5, 2],
    },
  ])
  const onSlab = player(0, 0, 0)
  const stepped = moveAABB(slab, onSlab, [0.5, -0.01, 0], { stepHeight: 0.55 })
  assert.equal(stepped.stepped, true)
  near(onSlab.min[1], 0.5, 'on slab top')
  near(onSlab.min[0], 0.2, 'advanced full distance')
  const block = new CollisionWorld([
    floor,
    {
      name: 'block',
      min: [0.5, 0, -2],
      max: [3, 1, 2],
    },
  ])
  const blocked = player(0, 0, 0)
  const result = moveAABB(block, blocked, [0.5, -0.01, 0], { stepHeight: 0.55 })
  assert.equal(result.stepped, false)
  assert.equal(result.hitX, true)
  near(blocked.max[0], 0.5, 'stopped at block face')
  near(blocked.min[1], 0, 'stayed on floor')
})

test('does not step while airborne', () => {
  const world = new CollisionWorld([
    {
      name: 'slab',
      min: [0.5, 0, -2],
      max: [3, 0.5, 2],
    },
  ])
  const box = player(0, 0.2, 0)
  const result = moveAABB(world, box, [0.5, -0.01, 0], { stepHeight: 0.55 })
  assert.equal(result.stepped, false)
  near(box.max[0], 0.5, 'blocked in the air')
})

test('a 50 m/s fall step does not tunnel through a thin floor', () => {
  const world = new CollisionWorld([
    {
      name: 'thin',
      min: [-5, -0.1, -5],
      max: [5, 0, 5],
    },
  ])
  const box = player(0, 0.5, 0)
  moveAABB(world, box, [0, -50 / 60, 0])
  near(box.min[1], 0, 'stopped on thin floor')
})

test('snaps down a 0.5 m stair when walking off an edge, but not without snapDown', () => {
  const stairs = () => new CollisionWorld([
    {
      name: 'upper',
      min: [-10, -1, -10],
      max: [0, 0, 10],
    },
    {
      name: 'lower',
      min: [0, -1.5, -10],
      max: [10, -0.5, 10],
    },
  ])
  const snapped = player(-0.2, 0, 0)
  const a = moveAABB(stairs(), snapped, [1, -0.003, 0], { snapDown: 0.55 })
  near(snapped.min[1], -0.5, 'snapped to lower step')
  assert.equal(a.grounded, true)
  const falling = player(-0.2, 0, 0)
  const b = moveAABB(stairs(), falling, [1, -0.003, 0])
  assert.ok(falling.min[1] > -0.01, 'no snap without snapDown')
  assert.equal(b.grounded, false)
})

test('jumping up is never grounded and a ceiling stops the rise', () => {
  const world = new CollisionWorld([
    floor,
    {
      name: 'ceiling',
      min: [-5, 2, -5],
      max: [5, 3, 5],
    },
  ])
  const box = player(0, 0, 0)
  const result = moveAABB(world, box, [0, 0.5, 0])
  near(box.max[1], 2, 'head at ceiling')
  assert.equal(result.hitY, true)
  assert.equal(result.grounded, false)
})

test('physics service synchronously returns displacement/contacts and records solve time', () => {
  const physics = createPhysicsSystem()
  const world = new CollisionWorld([
    {
      min: [-10, -1, -10],
      max: [10, 0, 10],
    },
  ])
  const box = player(0, 1, 0)
  const before = structuredClone(box)
  const result = physics.move(world, box, [0, -2, 0])
  assert.deepEqual(result.displacement, [0, -1, 0])
  assert.equal(result.grounded, true)
  assert.equal(result.hitY, true)
  assert.deepEqual(box, before)
  assert.ok(physics.lastStepMs >= 0)
  assert.equal(physics.overlaps(world, box), false)
  assert.equal(physics.overlaps(world, {
    min: [-1, -0.5, -1],
    max: [1, 1, 1],
  }), true)
  physics.dispose()
  physics.dispose()
  assert.throws(() => physics.move(world, box, [0, -1, 0]), /Disposed/)
})
