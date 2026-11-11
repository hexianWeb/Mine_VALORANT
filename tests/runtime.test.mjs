import assert from 'node:assert/strict'
import test from 'node:test'
import { Engine } from '../src/engine/runtime/engine.js'
import { WorldManager } from '../src/engine/runtime/function/framework/index.js'
import { RuntimeContext } from '../src/engine/runtime/function/global/runtime-context.js'

function frameDriver() {
  const frames = new Map()
  let id = 0
  let visibility
  return {
    request(callback) {
      frames.set(++id, callback)
      return id
    },
    cancel: id => frames.delete(id),
    onVisibility(callback) {
      visibility = callback
      return () => {
        visibility = null
      }
    },
    hidden: hidden => visibility?.(hidden),
    get pending() { return frames.size },
    advance(now) {
      const batch = [
        ...frames.values(),
      ]
      frames.clear()
      for (const callback of batch) callback(now)
    },
  }
}

test('explicit frame order preserves fixed steps, scaled pause and independent rendering', () => {
  const calls = []
  const engine = new Engine({
    world: {
      tickComponents: phase => calls.push(phase),
    },
    render: {
      swapLogicRenderData: () => calls.push('swap'),
      update: () => calls.push('render'),
    },
  })
  engine.events.on('input', () => calls.push('tools'))
  engine.events.on('frame', () => calls.push('ui'))
  engine.step(0)
  assert.deepEqual(calls, [
    'tools',
    'input',
    'motion',
    'presentation',
    'swap',
    'render',
    'ui',
  ])
  calls.length = 0
  engine.step(50)
  assert.deepEqual(calls, [
    'tools',
    'input',
    'fixed',
    'postPhysics',
    'fixed',
    'postPhysics',
    'fixed',
    'postPhysics',
    'motion',
    'presentation',
    'swap',
    'render',
    'ui',
  ])
  calls.length = 0
  const before = engine.time.frame
  engine.rendererTick()
  engine.rendererTick()
  assert.deepEqual(calls, ['render', 'render'])
  assert.equal(engine.time.frame, before)
  calls.length = 0
  assert.throws(() => engine.logicalTick(), /no unconsumed logical tick/)
  assert.deepEqual(calls, [])
  calls.length = 0
  engine.time.timeScale = 0
  engine.step(100)
  assert.equal(calls.filter(value => value === 'fixed').length, 0)
  assert.equal(engine.time.delta, 0)
  assert.ok(engine.time.rawDelta > 0)
  engine.time.timeScale = 1
  calls.length = 0
  engine.step(1000)
  assert.equal(calls.filter(value => value === 'fixed').length, 5)
  engine.destroy()
  calls.length = 0
  engine.step(2000)
  assert.deepEqual(calls, [])
})

test('fixed stages share step snapshots, frame observers see committed time and scale changes latch next frame', () => {
  const stages = []
  const inputs = []
  const frames = []
  const engine = new Engine({
    world: {
      tickComponents: (phase, frame) => stages.push({ phase, time: frame.time }),
    },
  })
  engine.events.on('input', ({ time }) => {
    inputs.push(time)
    if (time.frame === 2)
      engine.time.timeScale = 0
  })
  engine.events.on('frame', ({ time }) => frames.push(time))
  engine.step(0)
  engine.step(50)
  const fixed = stages.filter(({ phase }) => phase === 'fixed')
  const post = stages.filter(({ phase }) => phase === 'postPhysics')
  assert.deepEqual(fixed.map(({ time }) => time.fixedTick), [1, 2, 3])
  assert.deepEqual(fixed.map(({ time }) => time.fixedStepIndex), [0, 1, 2])
  assert.deepEqual(fixed.map(({ time }) => time.fixedElapsed), [1 / 60, 2 / 60, 3 / 60])
  for (let i = 0; i < fixed.length; i++) {
    assert.equal(fixed[i].time, post[i].time)
    assert.equal(fixed[i].time.timeScale, 1)
    assert.equal(fixed[i].time.elapsed, 0.05)
  }
  assert.equal(inputs[1].fixedTick, 0)
  assert.equal(frames[1].fixedTick, 3)
  assert.equal(frames[1].completedFixedSteps, 3)
  assert.equal(frames[1].fixedStepIndex, null)
  assert.throws(() => {
    frames[1].alpha = 99
  }, TypeError)
  engine.step(100)
  assert.equal(frames[2].timeScale, 0)
  assert.equal(frames[2].delta, 0)
  assert.equal(frames[2].rawDelta, 0.05)
  assert.equal(frames[2].fixedTick, 3)
  assert.equal(frames[1].frame, 2, 'previous frame snapshots remain unchanged')
  engine.destroy()
})

test('recursive step/logical/render calls cannot advance or publish an unfinished frame', () => {
  let renders = 0
  const engine = new Engine({
    world: {
      tickComponents() {
        const frame = engine.time.frame
        assert.throws(() => engine.step(999), /reenter/)
        assert.throws(() => engine.logicalTick(), /reenter/)
        assert.throws(() => engine.rendererTick(), /completed logical frame/)
        assert.equal(engine.time.frame, frame)
      },
    },
    render: {
      update() {
        renders++
        assert.throws(() => engine.step(999), /reenter/)
        assert.throws(() => engine.rendererTick(), /reenter/)
      },
    },
  })
  assert.throws(() => engine.logicalTick(), /no unconsumed/)
  engine.step(0)
  engine.step(50)
  assert.equal(engine.time.frame, 2)
  assert.equal(engine.time.fixedTick, 3)
  assert.equal(renders, 2)
  engine.rendererTick()
  assert.equal(renders, 3)
  assert.equal(engine.time.fixedTick, 3)
  engine.destroy()
})

test('a failed fixed step is not committed, rendered, swapped or replayed', () => {
  const calls = []
  const engine = new Engine({
    world: {
      tickComponents(phase) {
        calls.push(phase)
        if (phase === 'postPhysics')
          throw new Error('post failed')
      },
    },
    render: {
      swapLogicRenderData: () => calls.push('swap'),
      update: () => calls.push('render'),
    },
  })
  engine.step(0)
  calls.length = 0
  assert.throws(() => engine.step(50), /post failed/)
  assert.deepEqual(calls, ['input', 'fixed', 'postPhysics'])
  assert.equal(engine.time.fixedTick, 0)
  assert.equal(engine.time.completedFixedSteps, 0)
  assert.throws(() => engine.logicalTick(), /no unconsumed/)
  assert.throws(() => engine.rendererTick(), /completed logical frame/)
  engine.destroy()
})

test('visibility resumes only automatic pauses and frame failures stop the driver', () => {
  const driver = frameDriver()
  let fail = false
  const engine = new Engine({
    frameDriver: driver,
    world: {
      tickComponents() {
        if (fail)
          throw new Error('tick failed')
      },
    },
  })
  engine.start()
  assert.equal(driver.pending, 1)
  driver.advance(0)
  driver.advance(30)
  assert.ok(engine.time.delta > 0)
  driver.hidden(true)
  assert.equal(driver.pending, 0)
  assert.equal(engine.state, 'paused')
  driver.hidden(false)
  driver.advance(3000)
  assert.equal(engine.time.delta, 0)
  engine.pause()
  driver.hidden(true)
  driver.hidden(false)
  assert.equal(engine.state, 'paused')
  let error
  engine.events.on('error', (event) => {
    error = event.error
  })
  engine.resume()
  fail = true
  driver.advance(4000)
  assert.match(error.message, /tick failed/)
  assert.equal(engine.state, 'paused')
  assert.equal(driver.pending, 0)
  engine.destroy()
})

function runtimeFixture(overrides = {}, options = {}) {
  const disposed = []
  const owned = name => ({
    dispose: () => disposed.push(name),
  })
  const runtime = new RuntimeContext({
    ...options,
    factories: {
      size: () => ({
        ...owned('size'),
        aspect: 1,
      }),
      resources: () => owned('resources'),
      scene: () => ({}),
      camera: () => ({}),
      render: async ({ size, engine }) => {
        assert.equal(size.aspect, 1)
        assert.equal(engine, undefined, 'render receives size, not an engine service locator')
        return owned('render')
      },
      input: () => owned('input'),
      physics: () => owned('physics'),
      world: () => owned('level'),
      frameDriver,
      ...overrides,
    },
  })
  runtime.events.on('dispose', () => disposed.push('editor'))
  return { runtime, disposed }
}

test('runtime passes caller-provided key bindings to the input factory', async () => {
  const canvas = {}
  const inputBindings = { ArrowUp: 'forward', Enter: 'jump' }
  let received
  const { runtime } = runtimeFixture({
    input(options) {
      received = options
      return {
        dispose() {},
      }
    },
  }, { canvas, inputBindings })
  await runtime.initialize()
  assert.equal(received.element, canvas)
  assert.equal(received.bindings, inputBindings)
  runtime.dispose()
})

test('engine destruction closes tools and levels before renderer/assets, exactly once', async () => {
  const { runtime, disposed } = runtimeFixture()
  await runtime.initialize()
  runtime.engine.destroy()
  runtime.dispose()
  assert.deepEqual(disposed, [
    'editor',
    'level',
    'physics',
    'input',
    'render',
    'resources',
    'size',
  ])
  assert.equal(runtime.state, 'disposed')
  await assert.rejects(runtime.initialize(), /Cannot initialize/)
})

test('failed initialization rolls back completed systems in reverse dependency order', async () => {
  const { runtime, disposed } = runtimeFixture({
    input() { throw new Error('input failed') },
  })
  await assert.rejects(runtime.initialize(), /input failed/)
  assert.deepEqual(disposed, [
    'editor',
    'render',
    'resources',
    'size',
  ])
})

test('destroying during renderer initialization releases the late result without starting input', async () => {
  const pending = Promise.withResolvers()
  let lateDisposals = 0
  let inputs = 0
  const { runtime, disposed } = runtimeFixture({
    render: () => pending.promise,
    input() {
      inputs++
      return {
        dispose() {},
      }
    },
  })
  const initializing = runtime.initialize()
  const rejected = assert.rejects(initializing, { name: 'AbortError' })
  runtime.dispose()
  pending.resolve({
    dispose() { lateDisposals++ },
  })
  await rejected
  assert.equal(lateDisposals, 1)
  assert.equal(inputs, 0)
  assert.deepEqual(disposed, ['editor', 'resources', 'size'])
})

test('runtime instances have independent services, clocks and shutdown', async () => {
  const a = runtimeFixture()
  const b = runtimeFixture()
  await Promise.all([
    a.runtime.initialize(),
    b.runtime.initialize(),
  ])
  assert.notEqual(a.runtime.scene, b.runtime.scene)
  assert.notEqual(a.runtime.engine.time, b.runtime.engine.time)
  a.runtime.dispose()
  assert.equal(b.runtime.state, 'ready')
  assert.deepEqual(b.disposed, [])
  b.runtime.dispose()
})

test('WorldManager excludes concurrent loads, cleans cancellation and allows a fresh level', async () => {
  const world = new WorldManager()
  const pending = Promise.withResolvers()
  let disposals = 0
  let signal
  const load = world.loadLevel(() => ({
    load(options) {
      signal = options.signal
      return pending.promise
    },
    dispose() { disposals++ },
  }))
  const cancelled = assert.rejects(load, { name: 'AbortError' })
  assert.equal(world.activeLevel, null)
  await assert.rejects(world.loadLevel(() => {
    throw new Error('must not construct')
  }), /Unload/)
  const unload = world.unloadLevel()
  assert.equal(signal.aborted, true)
  assert.equal(disposals, 1)
  await assert.rejects(world.loadLevel(() => ({})), /Unload/)
  pending.resolve()
  await Promise.all([cancelled, unload])
  const calls = []
  const level = {
    async load() {},
    tickComponents: phase => calls.push(phase),
    dispose() { disposals++ },
  }
  await world.loadLevel(() => level)
  assert.equal(world.activeLevel, level)
  world.tickComponents('input', {})
  assert.deepEqual(calls, ['input'])
  await world.unloadLevel()
  world.tickComponents('input', {})
  assert.equal(disposals, 2)
  world.dispose()
  world.dispose()
  assert.equal(disposals, 2)
})

test('failed and shutdown-time level loads never publish partially initialized levels', async () => {
  const world = new WorldManager()
  let disposed = 0
  await assert.rejects(world.loadLevel(() => ({
    async load() { throw new Error('asset failed') },
    dispose() { disposed++ },
  })), /asset failed/)
  assert.equal(world.activeLevel, null)
  assert.equal(world.state, 'idle')
  const pending = Promise.withResolvers()
  const load = world.loadLevel(() => ({
    load: () => pending.promise,
    dispose() { disposed++ },
  }))
  const rejected = assert.rejects(load, { name: 'AbortError' })
  world.dispose()
  pending.resolve()
  await rejected
  assert.equal(disposed, 2)
  assert.equal(world.state, 'disposed')
  assert.equal(world.activeLevel, null)
})

test('level tools detach before assets on unload and failed tool mounting rolls back', async () => {
  const world = new WorldManager()
  const calls = []
  world.events.on('load', () => calls.push('mount tools'))
  world.events.on('unload', () => calls.push('detach tools'))
  const create = () => ({
    async load() {},
    dispose: () => calls.push('release level'),
  })
  await world.loadLevel(create)
  await world.unloadLevel()
  assert.deepEqual(calls, ['mount tools', 'detach tools', 'release level'])
  world.events.on('load', () => {
    throw new Error('tool failed')
  })
  await assert.rejects(world.loadLevel(create), /tool failed/)
  assert.equal(world.activeLevel, null)
  assert.equal(world.state, 'idle')
  assert.deepEqual(calls.slice(-2), ['detach tools', 'release level'])
  world.dispose()
})
