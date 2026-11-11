import assert from 'node:assert/strict'
import test from 'node:test'
import { PerspectiveCamera, Scene } from 'three/webgpu'
import { inputBindings } from '../src/configs/input-bindings.js'
import { Engine } from '../src/engine/runtime/engine.js'
import { Level } from '../src/engine/runtime/function/framework/index.js'
import { CollisionWorld, createPhysicsSystem } from '../src/engine/runtime/function/physics/index.js'
import { createPlayer, PlayerComponent } from '../src/game/player/player.js'
import { setupInput } from './input-fixture.mjs'

function setup(t, bindings = inputBindings) {
  const events = setupInput({ bindings })
  const { input, element } = events
  const camera = new PerspectiveCamera()
  const physics = createPhysicsSystem()
  const level = new Level({
    scene: new Scene(),
  })
  const collision = {
    world: new CollisionWorld([
      {
        min: [-100, -1, -100],
        max: [100, 0, 100],
      },
    ]),
    spawn: {
      position: [0, 0, 0],
      yaw: 0,
    },
    isOutOfBounds: () => false,
  }
  const player = level.addObject(createPlayer({ camera, collision, input, physics })).requireComponent(PlayerComponent)
  input.setEnabled(true)
  player.setEnabled(true)
  element.focus()
  let nextFrame = null
  const engine = new Engine({
    world: level,
    frameDriver: {
      request(callback) {
        nextFrame = callback
        return 1
      },
      cancel() { nextFrame = null },
    },
  })
  t.after(() => {
    engine.destroy()
    level.dispose()
    physics.dispose()
    input.dispose()
  })
  return {
    ...events,
    camera,
    player,
    engine,
    advance(now) {
      assert.ok(nextFrame, 'a running engine must request its next frame')
      const callback = nextFrame
      nextFrame = null
      callback(now)
    },
  }
}

test('real input drives movement and R respawn without constructing editor tools', (t) => {
  const { player, camera, engine, key } = setup(t)
  engine.step(0)
  key('keydown', 'KeyW')
  for (let frame = 1; frame <= 12; frame++) engine.step(frame * 1000 / 60)
  key('keyup', 'KeyW')
  assert.ok(player.position.z < -0.1)
  const position = player.position.clone()
  key('keydown', 'KeyR')
  assert.ok(player.position.equals(position), 'DOM events only record commands')
  engine.step(13 * 1000 / 60)
  assert.deepEqual(player.position.toArray(), [0, 0, 0])
  assert.equal(camera.position.z, 0)
  assert.equal(player.respawns, 1)
  key('keydown', 'KeyR', { repeat: true })
  engine.step(14 * 1000 / 60)
  assert.equal(player.respawns, 1, 'holding R does not repeatedly respawn')
  key('keyup', 'KeyR')
  key('keydown', 'KeyR')
  engine.step(15 * 1000 / 60)
  assert.equal(player.respawns, 2)
})

test('paused keyboard and tool respawns coalesce and publish together on the resumed tick', (t) => {
  const { player, camera, engine, key, advance } = setup(t)
  player.teleport([5, 0, 0], 0)
  engine.step(0)
  engine.start()
  engine.pause()
  const frame = engine.time.frame
  player.requestRespawn()
  player.requestRespawn()
  key('keydown', 'KeyR')
  key('keyup', 'KeyR')
  engine.rendererTick()
  assert.equal(engine.time.frame, frame)
  assert.equal(player.respawns, 0)
  assert.equal(player.position.x, 5)
  assert.equal(camera.position.x, 5)
  engine.resume()
  advance(20)
  assert.equal(player.respawns, 1, 'keyboard and tools share one pending respawn')
  assert.equal(player.position.x, 0)
  assert.equal(camera.position.x, 0)
  advance(40)
  assert.equal(player.respawns, 1, 'the command is consumed once')
})

test('disabling player discards queued gameplay commands before camera handoff', (t) => {
  const { player, input, engine, key } = setup(t)
  player.teleport([5, 0, 0], 0)
  engine.step(0)
  key('keydown', 'KeyR')
  player.requestRespawn()
  player.setEnabled(false)
  input.setEnabled(false)
  player.requestRespawn()
  player.setEnabled(true)
  input.setEnabled(true)
  engine.step(20)
  assert.equal(player.position.x, 5)
  assert.equal(player.respawns, 0)
})

test('game maps configurable actions to movement rather than depending on physical keys', (t) => {
  const { player, engine, key } = setup(t, { ArrowRight: 'right', Enter: 'respawn' })
  engine.step(0)
  key('keydown', 'ArrowRight')
  engine.step(100)
  key('keyup', 'ArrowRight')
  assert.ok(player.position.x > 0)
  key('keydown', 'KeyR')
  engine.step(120)
  assert.equal(player.respawns, 0)
  key('keydown', 'Enter')
  engine.step(140)
  assert.equal(player.respawns, 1)
  assert.equal(player.position.x, 0)
})
