import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three/webgpu'
import { Engine } from '../src/engine/runtime/engine.js'
import { CameraComponent, Level, MotorComponent, TransformComponent } from '../src/engine/runtime/function/framework/index.js'
import { createPhysicsSystem } from '../src/engine/runtime/function/physics/index.js'
import { playerConfig } from '../src/game/player/config.js'
import { createPlayer, PlayerComponent } from '../src/game/player/player.js'
import { createCollisionLayer } from '../src/game/range-room/collision.js'

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
    isDown: action => ({
      right: intent.moveX > 0,
      left: intent.moveX < 0,
      forward: intent.moveZ > 0,
      back: intent.moveZ < 0,
      walk: intent.walk,
      crouch: intent.crouch,
    })[action] ?? false,
    consumeLook: () => [0, 0],
    setEnabled() {},
    consumePressed(action) {
      if (action !== 'jump')
        return false
      const queued = jump
      jump = false
      return queued
    },
  }
  const camera = new THREE.PerspectiveCamera()
  const level = new Level({
    scene: new THREE.Scene(),
  })
  const physics = createPhysicsSystem()
  const object = level.addObject(createPlayer({ camera, collision, input, physics }))
  const player = object.requireComponent(PlayerComponent)
  player.setEnabled(true)
  const step = (count = 1) => {
    for (let i = 0; i < count; i++) {
      const frame = {
        time: { delta: 1 / 60, fixedDelta: 1 / 60 },
      }
      level.tickComponents('input', frame)
      level.tickComponents('fixed', frame)
      level.tickComponents('postPhysics', frame)
    }
  }
  return {
    player,
    level,
    input,
    intent,
    camera,
    step,
    collision,
    present: (alpha, rawDelta) => level.tickComponents('presentation', {
      time: { alpha, rawDelta },
    }),
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
  const { player, intent, camera, step, present } = setup()
  step(10)
  intent.moveZ = 1
  step(10)
  const before = player.position.clone()
  step()
  const after = player.position.clone()
  present(0.5, 10)
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
  camera.quaternion.setFromEuler(new THREE.Euler(0.25, -0.6, 0, 'YXZ'))
  player.placeAtCamera()
  player.position.toArray().forEach((value, i) => near(value, [10, 2, 10][i], 1e-9, `free pose axis ${i}`))
  assert.equal(player.respawns, 0)
  near(player.yaw, -0.6, 1e-12, 'handoff yaw')
  near(player.pitch, 0.25, 1e-12, 'handoff pitch')
  camera.position.set(5, playerConfig.standEye, 5)
  player.placeAtCamera()
  assert.deepEqual(player.position.toArray(), [0, 0, 0])
  assert.equal(player.respawns, 1)
  near(player.pitch, 0, 1e-12, 'blocked placement resets pitch')
})

test('look is consumed once per frame before Motor, while only Camera publishes the view', (t) => {
  const { player, level, input, intent, camera } = setup()
  t.after(() => level.dispose())
  const view = player.owner.requireComponent(CameraComponent)
  assert.equal(view, player.cameraComponent)
  assert.deepEqual(player.owner.components.map(component => component.constructor), [
    TransformComponent,
    MotorComponent,
    CameraComponent,
    PlayerComponent,
  ])
  const engine = new Engine({ world: level })
  t.after(() => engine.destroy())
  let reads = 0
  let look = [0, 0]
  input.consumeLook = () => {
    reads++
    const result = look
    look = [0, 0]
    return result
  }
  engine.step(0)
  look = [90 / (playerConfig.degreesPerCount * playerConfig.sensitivity), -100]
  engine.step(1)
  assert.equal(engine.time.fixedSteps, 0)
  assert.equal(reads, 2)
  near(player.yaw, -Math.PI / 2, 1e-12, 'look works on a zero-step frame')
  near(player.pitch, THREE.MathUtils.degToRad(2.8), 1e-12, 'local pitch')
  intent.moveZ = 1
  engine.step(101)
  assert.equal(engine.time.fixedSteps, 5)
  assert.equal(reads, 3, 'five fixed steps do not consume input five times')
  assert.ok(player.position.x > 0, 'fixed motion uses the updated heading')
  near(player.position.z, 0, 1e-12, 'yaw rotates the movement plane')
  const published = camera.position.clone()
  const quaternion = camera.quaternion.clone()
  const eye = view.currentVerticalOffset
  engine.rendererTick()
  engine.rendererTick()
  assert.ok(camera.position.equals(published) && camera.quaternion.equals(quaternion))
  near(view.currentVerticalOffset, eye, 1e-12, 'render does not advance camera smoothing')
  assert.throws(() => player.owner.removeComponent(CameraComponent), /required component/)
})

test('camera follows resolved crouch state under a ceiling and respawn resets view history', (t) => {
  const { player, level, intent, camera, step, present } = setup([
    {
      name: 'COL_Ceiling',
      min: [-5, 1.6, -5],
      max: [5, 2, 5],
    },
  ])
  t.after(() => level.dispose())
  const view = player.cameraComponent
  intent.crouch = true
  step()
  present(1, 0.05)
  const expected = playerConfig.crouchEye + (playerConfig.standEye - playerConfig.crouchEye) * Math.exp(-playerConfig.eyeSmoothing * 0.05)
  near(camera.position.y, expected, 1e-12, 'eye smoothly approaches crouch height')
  intent.crouch = false
  step()
  present(1, 0.05)
  assert.equal(player.crouched, true)
  assert.equal(view.verticalOffset, playerConfig.crouchEye, 'blocked stand-up retains crouch view')
  player.teleport([10, 0, 10], 0.5, 0.2)
  present(0, 0)
  assert.deepEqual(camera.position.toArray(), [10, playerConfig.standEye, 10])
  assert.equal(view.currentVerticalOffset, playerConfig.standEye)
  player.respawn()
  present(0.5, 0)
  assert.deepEqual(camera.position.toArray(), [0, playerConfig.standEye, 0])
  assert.equal(player.pitch, 0)
})

test('disabling player releases camera output and re-enabling adopts the observer pose', (t) => {
  const { player, level, camera, present } = setup()
  t.after(() => level.dispose())
  player.setEnabled(false)
  assert.equal(player.cameraComponent.enabled, false)
  camera.position.set(10, 3 + playerConfig.standEye, 10)
  camera.quaternion.setFromEuler(new THREE.Euler(-0.2, 0.5, 0, 'YXZ'))
  const position = camera.position.clone()
  const quaternion = camera.quaternion.clone()
  present(1, 0.1)
  assert.ok(camera.position.equals(position) && camera.quaternion.equals(quaternion))
  player.setEnabled(true)
  player.placeAtCamera()
  present(0, 0)
  assert.equal(player.cameraComponent.enabled, true)
  assert.ok(camera.position.equals(position))
  assert.ok(camera.quaternion.angleTo(quaternion) < 1e-7)
  level.dispose()
  assert.equal(player.cameraComponent.disposed, true)
  assert.equal(player.cameraComponent.enabled, false)
})
