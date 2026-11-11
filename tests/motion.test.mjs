import assert from 'node:assert/strict'
import test from 'node:test'
import { PerspectiveCamera, Scene } from 'three/webgpu'
import { Engine } from '../src/engine/runtime/engine.js'
import { characterMotion } from '../src/engine/runtime/function/character/character-motion.js'
import { Component, GameObject, Level, MeshComponent, MotorComponent, TransformComponent } from '../src/engine/runtime/function/framework/index.js'
import { CollisionWorld, createPhysicsSystem } from '../src/engine/runtime/function/physics/index.js'
import { playerConfig } from '../src/game/player/config.js'
import { createPlayer, PlayerComponent } from '../src/game/player/player.js'
import { createFloatingTeapot } from '../src/game/range-room/floating-teapot.js'

test('shared Motor clocks give 0/1/5 solves, queued jump once, pause and renderer-only isolation', () => {
  const scene = new Scene()
  const level = new Level({ scene })
  const physics = createPhysicsSystem()
  let solves = 0
  const service = {
    ...physics,
    move(...args) {
      solves++
      return physics.move(...args)
    },
  }
  let jump = false
  const input = {
    isDown: () => false,
    consumePressed(action) {
      if (action !== 'jump')
        return false
      const queued = jump
      jump = false
      return queued
    },
    consumeLook: () => [0, 0],
    setEnabled() {},
  }
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
  const playerObject = level.addObject(createPlayer({
    camera: new PerspectiveCamera(),
    collision,
    input,
    physics: service,
  }))
  const teapot = level.addObject(createFloatingTeapot({ scene }))
  const player = playerObject.requireComponent(PlayerComponent)
  const body = playerObject.requireComponent(MotorComponent)
  const prop = teapot.requireComponent(MotorComponent)
  assert.equal(body.constructor, prop.constructor)
  assert.equal(player.position, playerObject.requireComponent(TransformComponent).position)
  assert.equal(player.velocity, body.velocity)
  player.setEnabled(true)
  const engine = new Engine({ world: level })
  engine.step(0)
  assert.equal(solves, 0)
  engine.step(20)
  assert.equal(solves, 1)
  assert.equal(player.grounded, true)
  jump = true
  engine.step(21)
  assert.equal(solves, 1)
  assert.equal(body.command.jump, true, 'zero-step frame retains jump')
  engine.step(1000)
  assert.equal(solves, 6, 'long frame is capped at five more solves')
  assert.equal(body.command.jump, false)
  assert.ok(Math.abs(body.velocity.y - (Math.sqrt(2 * playerConfig.gravity * playerConfig.jumpHeight) - 5 * playerConfig.gravity / 60)) < 1e-10)
  assert.ok(Math.abs(body.elapsed - 6 / 60) < 1e-12)
  assert.ok(Math.abs(prop.elapsed - 0.121) < 1e-12)
  const elapsed = prop.elapsed
  const position = player.position.clone()
  engine.rendererTick()
  engine.rendererTick()
  engine.time.timeScale = 0
  engine.step(1020)
  assert.equal(solves, 6)
  assert.equal(prop.elapsed, elapsed)
  assert.ok(player.position.equals(position))
  engine.time.timeScale = 1
  player.setEnabled(false)
  engine.step(1040)
  assert.equal(solves, 6)
  assert.ok(prop.elapsed > elapsed, 'teapot runs while player control is disabled')
  player.setEnabled(true)
  playerObject.active = false
  engine.step(1060)
  assert.equal(solves, 6)
  level.dispose()
  engine.step(1080)
  assert.equal(solves, 6)
  assert.equal(scene.children.length, 0)
  assert.equal(level.objects.size, 0)
  physics.dispose()
  engine.destroy()
})

test('a command-driven character uses Transform/Motor without Player, camera or input', () => {
  const level = new Level({
    scene: new Scene(),
  })
  const physics = createPhysicsSystem()
  const object = new GameObject({ name: 'Command-controlled body' })
  const transform = object.addComponent(new TransformComponent())
  const motor = object.addComponent(new MotorComponent({
    motion: characterMotion,
    state: playerConfig,
    physics,
    world: new CollisionWorld([
      {
        min: [-100, -1, -100],
        max: [100, 0, 100],
      },
    ]),
  }))
  level.addObject(object)
  motor.command = { moveX: 1 }
  const frame = {
    time: { fixedDelta: 1 / 60 },
  }
  for (let i = 0; i < 60; i++) level.tickComponents('fixed', frame)
  assert.ok(transform.position.x > 5)
  assert.equal(motor.velocity.x, playerConfig.runSpeed)
  assert.equal(motor.grounded, true)
  assert.equal(level.scene.children.length, 0)
  assert.throws(() => object.removeComponent(TransformComponent), /required component/)
  object.removeComponent(MotorComponent)
  assert.equal(transform.interpolate, false)
  const stopped = transform.position.clone()
  level.tickComponents('fixed', frame)
  assert.ok(transform.position.equals(stopped))
  level.dispose()
  physics.dispose()
})

test('global phase barriers publish every fixed Motor before postPhysics and frame motion before Mesh', () => {
  const scene = new Scene()
  const level = new Level({ scene })
  const trace = []
  const bodies = []
  class Control extends Component {
    static requires = [MotorComponent, TransformComponent]
    static phases = ['input', 'postPhysics', 'presentation']
    tick({ phase, time }) {
      trace.push(`${phase}:${this.owner.name}`)
      const motor = this.owner.requireComponent(MotorComponent)
      if (phase === 'input')
        motor.command.speed = Number(this.owner.name)
      if (phase === 'postPhysics') {
        for (const body of bodies) {
          const position = body.requireComponent(TransformComponent).position.x
          assert.ok(
            Math.abs(position - Number(body.name) * time.fixedElapsed) < 1e-12,
            'postPhysics must see all objects after the current fixed step',
          )
        }
      }
    }
  }
  for (const speed of [2, 4]) {
    const object = new GameObject({
      name: String(speed),
    })
    object.addComponent(new TransformComponent())
    object.addComponent(new MotorComponent({
      motion(motor, delta) {
        trace.push(`fixed:${motor.owner.name}`)
        return {
          displacement: [motor.command.speed * delta, 0, 0],
        }
      },
    }))
    object.addComponent(new Control())
    bodies.push(level.addObject(object))
  }
  const teapot = level.addObject(createFloatingTeapot({ scene }))
  const prop = teapot.requireComponent(MotorComponent)
  const moveProp = prop.motion
  prop.motion = (motor, delta) => {
    trace.push('motion:teapot')
    return moveProp(motor, delta)
  }
  const engine = new Engine({ world: level })
  engine.step(0)
  trace.length = 0
  engine.step(50)
  assert.deepEqual(trace, [
    'input:2',
    'input:4',
    'fixed:2',
    'fixed:4',
    'postPhysics:2',
    'postPhysics:4',
    'fixed:2',
    'fixed:4',
    'postPhysics:2',
    'postPhysics:4',
    'fixed:2',
    'fixed:4',
    'postPhysics:2',
    'postPhysics:4',
    'motion:teapot',
    'presentation:2',
    'presentation:4',
  ])
  assert.equal(prop.elapsed, 0.05)
  assert.ok(teapot.requireComponent(MeshComponent).root.position.equals(teapot.requireComponent(TransformComponent).position))
  assert.equal(GameObject.prototype.tick, undefined, 'GO does not implement an independent gameplay loop')
  level.dispose()
  engine.destroy()
})
