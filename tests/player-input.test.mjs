import assert from 'node:assert/strict'
import test from 'node:test'
import { PerspectiveCamera, Scene } from 'three/webgpu'
import { inputBindings } from '../src/configs/input-bindings.js'
import { Engine } from '../src/engine/runtime/engine.js'
import { Level } from '../src/engine/runtime/function/framework/index.js'
import { CollisionWorld, createPhysicsSystem } from '../src/engine/runtime/function/physics/index.js'
import { createPlayer, PlayerComponent } from '../src/game/player/player.js'
import { setupInput } from './input-fixture.mjs'

function setup(t, bindings = inputBindings, weapons = null) {
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
  const player = level.addObject(createPlayer({
    camera,
    collision,
    input,
    physics,
    weapons,
  })).requireComponent(PlayerComponent)
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
  // Match bootstrap's actual pause/resume wiring; paused frames do not run input ticks.
  engine.events.on('pause', () => player.setPaused(true))
  engine.events.on('resume', () => player.setPaused(false))
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

test('Engine pause/resume collects keyboard-only Home before clearing paused holds and look', (t) => {
  const f = setup(t)
  f.click()
  f.engine.step(0)
  f.player.teleport([5, 0, 0], 0)
  f.engine.start()
  f.engine.pause()
  f.key('keydown', 'Home')
  f.key('keyup', 'Home')
  f.mouse('mousedown', 0)
  f.mouse('mousedown', 2)
  f.move(100, 50)
  f.engine.resume()
  assert.equal(f.player.respawns, 0, 'resume listeners retain commands without committing them')
  assert.deepEqual(f.input.consumeLook(), [0, 0])
  assert.equal(f.input.isDown('fire'), false)
  assert.equal(f.input.isDown('aim'), false)
  f.advance(20)
  assert.equal(f.player.respawns, 0)
  f.advance(40)
  assert.equal(f.player.respawns, 1)
  assert.equal(f.player.position.x, 0)
  f.advance(60)
  assert.equal(f.player.respawns, 1)
})

test('zero-scale input ticks retain Home until simulation resumes', (t) => {
  const f = setup(t)
  f.engine.step(0)
  f.player.teleport([5, 0, 0], 0)
  f.engine.time.timeScale = 0
  f.engine.step(20)
  f.key('keydown', 'Home')
  f.key('keyup', 'Home')
  f.engine.step(40)
  f.engine.step(60)
  assert.equal(f.player.respawns, 0)
  f.engine.time.timeScale = 1
  f.engine.step(80)
  assert.equal(f.player.respawns, 1)
  assert.equal(f.player.position.x, 0)
})

test('actual Engine pause/resume wiring defers the latest slot selection until a resumed fixed step', (t) => {
  const requests = []
  const f = setup(t, inputBindings, {
    assets: {
      load(request) {
        requests.push(request)
        return new Promise(() => {})
      },
    },
    layer: {
      scene: new Scene(),
      setEnabled() {},
      setFov() {},
    },
  })
  f.engine.step(0)
  f.engine.step(20)
  assert.deepEqual(requests.map(request => request.weaponId), ['classic'])
  f.engine.start()
  f.engine.pause()
  f.key('keydown', 'Digit2')
  f.key('keyup', 'Digit2')
  f.key('keydown', 'Digit1')
  f.key('keydown', 'KeyR')
  f.key('keydown', 'KeyT')
  f.engine.resume()
  assert.equal(requests.length, 1)
  f.advance(100)
  assert.equal(requests.length, 1, 'the first resumed zero-step frame cannot load the queued slot')
  f.advance(120)
  assert.deepEqual(requests.map(request => request.weaponId), ['classic', 'phantom'])
  assert.equal(f.player.weapons.snapshot().pendingTarget, 'rifle')
  assert.equal(f.player.weapons.snapshot().lastShot, null)
})

test('real input drives movement and Home respawn without constructing editor tools', (t) => {
  const { player, camera, engine, key } = setup(t)
  engine.step(0)
  key('keydown', 'KeyW')
  for (let frame = 1; frame <= 12; frame++) engine.step(frame * 1000 / 60)
  key('keyup', 'KeyW')
  assert.ok(player.position.z < -0.1)
  const position = player.position.clone()
  key('keydown', 'Home')
  assert.ok(player.position.equals(position), 'DOM events only record commands')
  engine.step(13 * 1000 / 60)
  assert.deepEqual(player.position.toArray(), [0, 0, 0])
  assert.equal(camera.position.z, 0)
  assert.equal(player.respawns, 1)
  key('keydown', 'Home', { repeat: true })
  engine.step(14 * 1000 / 60)
  assert.equal(player.respawns, 1, 'holding Home does not repeatedly respawn')
  key('keyup', 'Home')
  key('keydown', 'Home')
  engine.step(15 * 1000 / 60)
  assert.equal(player.respawns, 2)
})

test('paused respawn requests coalesce and commit on the first resumed fixed step', (t) => {
  const { player, camera, engine, key, advance } = setup(t)
  player.teleport([5, 0, 0], 0)
  engine.step(0)
  engine.start()
  engine.pause()
  const frame = engine.time.frame
  player.requestRespawn()
  player.requestRespawn()
  key('keydown', 'Home')
  key('keyup', 'Home')
  engine.rendererTick()
  assert.equal(engine.time.frame, frame)
  assert.equal(player.respawns, 0)
  assert.equal(player.position.x, 5)
  assert.equal(camera.position.x, 5)
  engine.resume()
  advance(20)
  assert.equal(player.respawns, 0, 'the first resumed frame has no fixed step and retains the pending request')
  assert.equal(player.position.x, 5)
  assert.equal(camera.position.x, 5)
  advance(40)
  assert.equal(player.respawns, 1, 'keyboard and tools share one pending respawn')
  assert.equal(player.position.x, 0)
  assert.equal(camera.position.x, 0)
  advance(60)
  assert.equal(player.respawns, 1, 'the command is consumed once')
})

test('disabling player discards queued gameplay commands before camera handoff', (t) => {
  const { player, input, engine, key } = setup(t)
  player.teleport([5, 0, 0], 0)
  engine.step(0)
  key('keydown', 'Home')
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
  key('keydown', 'Home')
  engine.step(120)
  assert.equal(player.respawns, 0)
  key('keydown', 'Enter')
  engine.step(140)
  assert.equal(player.respawns, 1)
  assert.equal(player.position.x, 0)
})
