import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import * as THREE from 'three/webgpu'
import { Time } from '../src/engine/runtime/core/time.js'
import { Engine } from '../src/engine/runtime/engine.js'
import { CameraComponent, Level, MotorComponent, TransformComponent } from '../src/engine/runtime/function/framework/index.js'
import { createPhysicsSystem } from '../src/engine/runtime/function/physics/index.js'
import { playerConfig } from '../src/game/player/config.js'
import { createPlayer, PlayerComponent } from '../src/game/player/player.js'
import { createCollisionLayer } from '../src/game/range-room/collision.js'

const near = (actual, expected, tolerance, message) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`)

function setup(boxes = [], spawn = [0, 0, 0], groundHeight = 0) {
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
    height: groundHeight,
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
  const time = new Time()
  time.tick(0)
  let frameIndex = 0
  const step = (count = 1) => {
    for (let i = 0; i < count; i++) {
      time.tick(++frameIndex * 1000 / 60)
      level.tickComponents('input', {
        time: time.snapshot(),
      })
      for (let index = 0; index < time.fixedSteps; index++) {
        const context = {
          time: time.snapshot(index),
        }
        level.tickComponents('fixed', context)
        level.tickComponents('postPhysics', context)
        time.completeFixedStep(index)
      }
    }
  }
  return {
    player,
    level,
    input,
    intent,
    camera,
    step,
    time,
    collision,
    present(alpha, rawDelta) {
      const context = {
        time: {
          ...time.snapshot(),
          alpha,
          rawDelta,
          presentationTime: Math.max(0, time.fixedElapsed - time.fixedDelta + alpha * time.fixedDelta),
        },
      }
      level.tickComponents('motion', context)
      level.tickComponents('presentation', context)
    },
    pressJump: () => { jump = true },
  }
}

const horizontalSpeed = player => Math.hypot(player.velocity.x, player.velocity.z)

function setupCorridor(extraBoxes = []) {
  const { boxes, spawn } = JSON.parse(readFileSync(new URL('../public/collision/range-room.json', import.meta.url), 'utf8'))
  const corridorBoxes = [
    ...boxes,
    ...extraBoxes,
  ]
  return setup(corridorBoxes, spawn.position, 7.865)
}

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

test('look commits the Valorant scale and pitch clamp on the next fixed step', () => {
  const { player, step } = setup()
  player.look(100, 0)
  assert.equal(player.yaw, 0, 'queued look does not modify the published fixed view')
  step()
  near(player.yaw, THREE.MathUtils.degToRad(-100 * playerConfig.degreesPerCount * playerConfig.sensitivity), 1e-12, 'yaw')
  player.look(0, -1e7)
  step()
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

test('smooths the view in both directions on the corridor stairs at full run speed', () => {
  const dt = 1 / 60
  const routes = [
    {
      start: [0, 8, -14.2],
      yaw: Math.PI,
      stepTicks: [10, 15],
      landings: [8.5, 9],
    },
    {
      start: [0, 9, -11.2],
      yaw: 0,
      stepTicks: [17, 21],
      landings: [8.5, 8],
    },
  ]
  for (const { start, yaw, stepTicks, landings } of routes) {
    const { player, intent, camera, step, present, collision } = setupCorridor()
    const [firstStep, lastStep] = stepTicks
    const direction = Math.sign(landings[0] - start[1])
    player.teleport(start, yaw)
    step()
    present(0, dt)
    intent.moveZ = 1

    const actualStepTicks = []
    const actualLandings = []
    const eyeHeights = [camera.position.y]
    for (let tick = 1; tick <= lastStep + 6; tick++) {
      const before = player.position.clone()
      step()
      present(0, dt)
      if (Math.abs(player.position.y - before.y) > 1e-9) {
        actualStepTicks.push(tick)
        actualLandings.push(player.position.y)
        near(Math.abs(player.position.z - before.z), playerConfig.runSpeed * dt, 1e-9, 'full run displacement on a step')
        assert.equal(player.grounded, true)
      }
      const eyeChange = (camera.position.y - eyeHeights.at(-1)) * direction
      assert.ok(eyeChange >= -1e-9 && eyeChange < 0.2, 'the eye moves smoothly across both stairs')
      eyeHeights.push(camera.position.y)
    }

    assert.deepEqual(actualStepTicks, stepTicks)
    assert.deepEqual(actualLandings, landings)
    near(eyeHeights[firstStep], start[1] + playerConfig.standEye, 1e-9, 'the first step follows the fixed-step interpolation')
    const targetEye = landings.at(-1) + playerConfig.standEye
    near(eyeHeights[lastStep + 6], targetEye - (targetEye - eyeHeights[lastStep]) * 0.1, 1e-9, '90% catch-up after 100 ms')

    player.respawn()
    present(0, 0)
    near(camera.position.y, collision.spawn.position[1] + playerConfig.standEye, 1e-9, 'respawn clears the remaining step offset')
  }
})

test('reverses the camera step direction without a rebound or residual offset on corridor stairs', () => {
  const { player, intent, camera, step, present, time } = setupCorridor()
  const motor = player.owner.requireComponent(MotorComponent)
  const dt = 1 / 60
  const halfTurn = 180 / (playerConfig.degreesPerCount * playerConfig.sensitivity)
  player.teleport([0, 8, -14.2], Math.PI)
  step()
  present(0, dt)
  intent.moveZ = 1

  const corrections = []
  const landings = []
  const directions = [
    { at: time.fixedElapsed, direction: 0 },
  ]
  let previousTotal = 0
  let previousEyeY = camera.position.y
  for (let tick = 1; tick <= 90; tick++) {
    step()
    present(0, dt)
    const total = motor.sampleStepDeltaY(1)
    if (total !== previousTotal) {
      corrections.push(total - previousTotal)
      landings.push(player.position.y)
      if (corrections.length === 1)
        player.look(halfTurn, 0)
      else if (corrections.length === 2)
        player.look(-halfTurn, 0)
      else if (corrections.length === 4)
        intent.moveZ = 0
    }
    directions.push({
      at: time.fixedElapsed,
      direction: Math.sign(corrections.at(-1) ?? 0),
    })
    // alpha=0 shows the preceding completed step; do not compare that eye with a future reversal.
    const presentationTime = time.fixedElapsed - time.fixedDelta
    const displayedDirection = directions.findLast(entry => entry.at <= presentationTime + 1e-10).direction
    const eyeChange = (camera.position.y - previousEyeY) * displayedDirection
    assert.ok(eyeChange >= -1e-9 && eyeChange < 0.2, `camera follows the displayed step at tick ${tick}`)
    previousTotal = total
    previousEyeY = camera.position.y
  }

  assert.deepEqual(corrections, [0.5, -0.5, 0.5, 0.5])
  assert.deepEqual(landings, [8.5, 8, 8.5, 9])
  assert.equal(horizontalSpeed(player), 0)
  assert.equal(camera.position.y, player.position.y + playerConfig.standEye)
})

test('keeps the eye and near plane clear when running down into a low entrance', () => {
  const roof = {
    name: 'COL_Test_LowEntrance',
    min: [-1, 9.8005, -14.35],
    max: [1, 10.2, -13.65],
  }
  const { player, intent, camera, step, present } = setupCorridor([roof])
  camera.aspect = 16 / 9
  camera.near = 0.05
  camera.updateProjectionMatrix()
  const dt = 1 / 60
  player.teleport([0, 9, -11.2], 0, THREE.MathUtils.degToRad(65))
  step()
  present(0, dt)
  intent.moveZ = 1

  const roofBounds = new THREE.Box3(new THREE.Vector3(...roof.min), new THREE.Vector3(...roof.max))
  const cameraBounds = new THREE.Box3()
  const corner = new THREE.Vector3()
  let clearance = Infinity
  let previousEyeY = camera.position.y
  for (let tick = 1; tick <= 36; tick++) {
    step()
    present(0, dt)
    camera.updateMatrixWorld()
    cameraBounds.set(camera.position, camera.position)
    for (const x of [-1, 1]) {
      for (const y of [-1, 1]) {
        cameraBounds.expandByPoint(corner.set(x, y, -1).unproject(camera))
      }
    }
    assert.equal(cameraBounds.intersectsBox(roofBounds), false, 'the camera and near plane clear the roof')
    if (cameraBounds.min.z < roofBounds.max.z && cameraBounds.max.z > roofBounds.min.z)
      clearance = Math.min(clearance, roofBounds.min.y - cameraBounds.max.y)
    assert.ok(camera.position.y <= previousEyeY + 1e-9, 'the camera does not rebound after the ceiling')
    previousEyeY = camera.position.y
  }
  assert.ok(clearance > 0 && clearance < 0.001, 'the roof actively limited the step offset')
  assert.ok(player.position.z < roof.min[2], 'the player ran through the low entrance')
  near(player.position.y, 8, 1e-9, 'feet on the lower floor')
  near(horizontalSpeed(player), playerConfig.runSpeed, 1e-9, 'full run speed through the entrance')
  assert.equal(player.respawns, 0)
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

test('look is collected once per frame and committed by fixed motion, while only Camera publishes the view', (t) => {
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
  near(player.yaw, 0, 1e-12, 'zero-step frames retain pending yaw')
  near(player.pitch, 0, 1e-12, 'zero-step frames retain pending pitch')
  intent.moveZ = 1
  engine.step(101)
  assert.equal(engine.time.fixedSteps, 5)
  assert.equal(reads, 3, 'five fixed steps do not consume input five times')
  near(player.yaw, -Math.PI / 2, 1e-12, 'the first fixed step commits the queued yaw once')
  near(player.pitch, THREE.MathUtils.degToRad(2.8), 1e-12, 'the first fixed step commits the queued pitch once')
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
  step(3)
  present(1, 0.05)
  const expected = playerConfig.crouchEye + (playerConfig.standEye - playerConfig.crouchEye) * Math.exp(-playerConfig.eyeSmoothing * 0.05)
  near(camera.position.y, expected, 1e-12, 'eye smoothly approaches crouch height')
  intent.crouch = false
  step(3)
  present(1, 0.05)
  assert.equal(player.crouched, true)
  const blockedEye = playerConfig.crouchEye + (playerConfig.standEye - playerConfig.crouchEye) * Math.exp(-playerConfig.eyeSmoothing * 0.1)
  near(camera.position.y, blockedEye, 1e-12, 'blocked stand-up continues toward the resolved crouch eye height')
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

test('Editor return anchors the first fixed interval at its left boundary and preserves new look', (t) => {
  const { player, level, camera } = setup()
  const engine = new Engine({ world: level })
  t.after(() => engine.destroy())
  engine.step(0)
  engine.step(20)
  player.setEnabled(false)
  for (let frame = 1; frame <= 10; frame++) engine.step(20 + frame * 100)
  camera.position.set(10, playerConfig.standEye, 5)
  camera.quaternion.setFromEuler(new THREE.Euler(0.1, 0.4, 0, 'YXZ'))
  const observerPosition = camera.position.clone()
  const observerRotation = camera.quaternion.clone()
  player.setEnabled(true)
  player.placeAtCamera()
  player.look(-90 / (playerConfig.degreesPerCount * playerConfig.sensitivity), 0)
  engine.step(1021)
  assert.equal(engine.time.fixedSteps, 0)
  assert.ok(camera.position.equals(observerPosition))
  assert.ok(camera.quaternion.angleTo(observerRotation) < 1e-7, 'zero-step return keeps the adopted view')
  engine.step(1037)
  assert.equal(engine.time.fixedSteps, 1)
  const time = engine.time.snapshot()
  const view = player.snapshot().view
  near(player.yaw, 0.4 + Math.PI / 2, 1e-10, 'the new look commits once')
  near(view.baseYaw, 0.4 + Math.PI / 2 * time.alpha, 1e-10, 'the first presentation samples its own fixed interval')
  assert.ok(camera.position.equals(observerPosition), 'reanchoring time does not move the adopted eye')
  engine.step(1054)
  near(player.yaw, 0.4 + Math.PI / 2, 1e-10, 'later steps do not replay pending look')
})

test('enable after skipped global ticks also rebases when no placement reset was requested', (t) => {
  const { player, level, camera } = setup()
  const engine = new Engine({ world: level })
  t.after(() => engine.destroy())
  engine.step(0)
  engine.step(20)
  const pose = camera.position.clone()
  player.setEnabled(false)
  for (let frame = 1; frame <= 10; frame++) engine.step(20 + frame * 100)
  player.setEnabled(true)
  assert.doesNotThrow(() => engine.step(1037))
  assert.ok(camera.position.equals(pose))
})

test('timeScale pause preserves the existing view clock rather than creating an Editor history boundary', (t) => {
  const { player, level, camera } = setup()
  const engine = new Engine({ world: level })
  t.after(() => engine.destroy())
  engine.step(0)
  player.look(-20, -10)
  engine.step(20)
  const view = player.snapshot().view
  const elapsed = engine.time.fixedElapsed
  const position = camera.position.clone()
  const rotation = camera.quaternion.clone()
  engine.time.timeScale = 0
  engine.step(120)
  engine.step(220)
  assert.equal(engine.time.fixedElapsed, elapsed)
  assert.deepEqual(player.snapshot().view, view)
  assert.ok(camera.position.equals(position) && camera.quaternion.equals(rotation))
  engine.time.timeScale = 1
  engine.step(221)
  assert.equal(engine.time.fixedElapsed, elapsed)
  assert.equal(player.snapshot().view.at, engine.time.snapshot().presentationTime)
  engine.step(237)
  near(player.yaw, THREE.MathUtils.degToRad(20 * playerConfig.degreesPerCount * playerConfig.sensitivity), 1e-12, 'pause does not reset heading')
})
