import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three/webgpu'
import { createCollisionLayer } from '../src/world/collision-layer.js'
import { createPlayer, playerConfig } from '../src/world/player.js'

const near = (actual, expected, tolerance, message) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`)

function setup(boxes = [], spawn = [0, 0, 0]) {
  const collision = createCollisionLayer({
    schemaVersion: 1,
    spawn: { position: spawn, yawDeg: 0 },
    boxes: [
      ...boxes,
      {
        name: 'COL_Far',
        min: [90, 0, 90],
        max: [91, 1, 91],
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
  const intent = {
    moveX: 0,
    moveZ: 0,
    walk: false,
    crouch: false,
  }
  let jump = false
  const input = {
    intent,
    consumeJump() {
      const queued = jump
      jump = false
      return queued
    },
  }
  const camera = new THREE.PerspectiveCamera()
  const player = createPlayer({ camera, collision, input })
  player.setEnabled(true)
  const step = (count = 1) => {
    for (let i = 0; i < count; i++) player.fixedUpdate(1 / 60)
  }
  return {
    player,
    intent,
    camera,
    step,
    collision,
    pressJump: () => { jump = true },
  }
}

const horizontalSpeed = player => Math.hypot(player.velocity.x, player.velocity.z)

test('settles on the runtime ground at the spawn', () => {
  const { player, step } = setup()
  step(30)
  assert.equal(player.grounded, true)
  near(player.position.y, 0, 1e-9, 'feet on ground')
  assert.equal(player.respawns, 0)
})

test('reaches run speed and counter-strafes to a stop within 0.1 s; walk is slower', () => {
  const { player, intent, step } = setup()
  step(10)
  intent.moveZ = 1
  step(6)
  near(horizontalSpeed(player), playerConfig.runSpeed, 1e-9, 'run speed')
  near(player.velocity.z, -playerConfig.runSpeed, 1e-9, 'yaw 0 moves toward -Z')
  intent.moveZ = 0
  step(6)
  near(horizontalSpeed(player), 0, 1e-9, 'stopped')
  intent.moveX = 1
  intent.walk = true
  step(10)
  near(player.velocity.x, playerConfig.walkSpeed, 1e-9, 'walk speed to the right')
})

test('jump apex is 1.1 m and the player lands again', () => {
  const { player, step, pressJump } = setup()
  step(10)
  pressJump()
  let apex = 0
  for (let i = 0; i < 60; i++) {
    step()
    apex = Math.max(apex, player.position.y)
  }
  near(apex, playerConfig.jumpHeight, 0.01, 'apex')
  assert.equal(player.grounded, true)
  near(player.position.y, 0, 1e-9, 'landed')
})

test('crouch cannot stand up under a low ceiling but stands when free', () => {
  const low = setup([
    {
      name: 'COL_Ceiling',
      min: [-5, 1.6, -5],
      max: [5, 2, 5],
    },
  ])
  low.intent.crouch = true
  low.step(10)
  assert.equal(low.player.crouched, true)
  low.intent.crouch = false
  low.step(5)
  assert.equal(low.player.crouched, true, 'ceiling blocks standing')
  const free = setup()
  free.intent.crouch = true
  free.step(5)
  free.intent.crouch = false
  free.step(1)
  assert.equal(free.player.crouched, false)
})

test('clipping under a floor box respawns; standing on it or beside it does not', () => {
  const floorBox = {
    name: 'COL_Test_Floor_01',
    min: [-5, 1, -5],
    max: [5, 1.5, 5],
  }
  const onTop = setup([floorBox], [0, 1.5, 0])
  onTop.step(30)
  near(onTop.player.position.y, 1.5, 1e-9, 'stands on floor box')
  assert.equal(onTop.player.respawns, 0)
  onTop.player.position.set(0, 0, 0)
  onTop.step()
  assert.equal(onTop.player.respawns, 1)
  near(onTop.player.position.y, 1.5, 1e-9, 'back at spawn')
  const beside = setup([
    {
      name: 'COL_Test_Floor_02',
      min: [0.3, 0.5, -1],
      max: [5, 1, 1],
    },
  ])
  beside.intent.moveX = 1
  beside.step(60)
  near(beside.player.position.x, 0, 1e-9, 'pressed against the slab side')
  assert.equal(beside.player.respawns, 0)
})

test('falling below killY respawns', () => {
  const { player, step } = setup()
  player.position.set(0, -11, 0)
  step()
  assert.equal(player.respawns, 1)
  near(player.position.y, 0, 1e-9, 'back at spawn')
})

test('look uses Valorant scale and clamps pitch', () => {
  const { player } = setup()
  player.look(100, 0)
  near(player.yaw, THREE.MathUtils.degToRad(-100 * playerConfig.degreesPerCount * playerConfig.sensitivity), 1e-12, 'yaw')
  player.look(0, -1e7)
  near(player.pitch, THREE.MathUtils.degToRad(playerConfig.maxPitchDeg), 1e-12, 'pitch clamp')
})

test('camera interpolates between fixed steps at eye height', () => {
  const { player, intent, camera, step } = setup()
  step(10)
  intent.moveZ = 1
  step(10)
  const before = player.position.clone()
  step()
  const after = player.position.clone()
  player.updateCamera(0.5, 10)
  near(camera.position.z, (before.z + after.z) / 2, 1e-9, 'interpolated z')
  near(camera.position.y, after.y + playerConfig.standEye, 1e-6, 'eye height')
})

test('placeAtCamera keeps a free pose and falls back to spawn when blocked', () => {
  const { player, camera } = setup([
    {
      name: 'COL_Block',
      min: [4, 0, 4],
      max: [6, 3, 6],
    },
  ], [0, 0, 0])
  camera.position.set(10, 2 + playerConfig.standEye, 10)
  player.placeAtCamera()
  player.position.toArray().forEach((value, i) => near(value, [10, 2, 10][i], 1e-9, `free pose axis ${i}`))
  assert.equal(player.respawns, 0)
  camera.position.set(5, playerConfig.standEye, 5)
  player.placeAtCamera()
  assert.deepEqual(player.position.toArray(), [0, 0, 0])
  assert.equal(player.respawns, 1)
})
