import assert from 'node:assert/strict'
import test from 'node:test'
import { Group, Scene, Vector3 } from 'three/webgpu'
import { Engine } from '../src/engine/runtime/engine.js'
import { Component, GameObject, Level, MeshComponent, TransformComponent } from '../src/engine/runtime/function/framework/index.js'

const frame = {
  time: { delta: 0.5, fixedDelta: 1 / 60, alpha: 0.5 },
}

test('each phase scans GO compositions in assembly order, including static objects', () => {
  const level = new Level({
    scene: new Scene(),
  })
  const calls = []
  class A extends Component {
    static phases = ['input']
    tick() { calls.push(`A:${this.owner.name}`) }
  }
  class B extends Component {
    static phases = ['input']
    tick() { calls.push(`B:${this.owner.name}`) }
  }
  const first = new GameObject({ name: '1', mobility: 'static' })
  first.addComponent(new A())
  first.addComponent(new B())
  const second = new GameObject({ name: '2' })
  second.addComponent(new B())
  second.addComponent(new A())
  level.addObject(first)
  level.addObject(second)
  level.tickComponents('motion', frame)
  assert.deepEqual(calls, [])
  level.tickComponents('input', frame)
  assert.deepEqual(calls, ['A:1', 'B:1', 'B:2', 'A:2'])
  calls.length = 0
  second.active = false
  first.requireComponent(B).enabled = false
  level.tickComponents('input', frame)
  assert.deepEqual(calls, ['A:1'])
  assert.equal(level.scene.children.length, 0, 'logic objects do not allocate scene roots')
  level.dispose()
})

test('whole-phase snapshots defer additions and immediately skip removals/disable', () => {
  const level = new Level({
    scene: new Scene(),
  })
  const calls = []
  class Added extends Component {
    static phases = ['input']
    tick() { calls.push(this.owner.name) }
  }
  const first = level.addObject(new GameObject())
  const second = level.addObject(new GameObject({ name: 'second' }))
  const removed = level.addObject(new GameObject())
  const disabled = level.addObject(new GameObject())
  let once = true
  class Mutator extends Component {
    static phases = ['input']
    tick() {
      if (!once)
        return
      once = false
      second.addComponent(new Added())
      level.addObject(new GameObject({ name: 'new' })).addComponent(new Added())
      level.removeObject(removed.id)
      disabled.getComponent(Added).enabled = false
    }
  }
  first.addComponent(new Mutator())
  removed.addComponent(new Added())
  disabled.addComponent(new Added())
  level.tickComponents('input', frame)
  assert.deepEqual(calls, [])
  level.tickComponents('input', frame)
  assert.deepEqual(calls, ['second', 'new'])
  calls.length = 0
  second.removeComponent(Added)
  level.tickComponents('input', frame)
  assert.deepEqual(calls, ['new'])
  level.dispose()
  calls.length = 0
  level.tickComponents('input', frame)
  assert.deepEqual(calls, [])
  assert.equal(level.objects.size, 0)
})

test('assembly checks direct dependencies and defers attachment until Level entry', () => {
  const scene = new Scene()
  const level = new Level({ scene })
  const object = new GameObject()
  const root = new Group()
  let releases = 0
  const mesh = new MeshComponent({
    root,
    scene,
    release: () => releases++,
  })
  assert.throws(() => object.addComponent(mesh), /Missing required component/)
  assert.equal(mesh.owner, null)
  object.addComponent(new TransformComponent({
    position: new Vector3(1, 2, 3),
  }))
  object.addComponent(mesh)
  assert.equal(root.parent, null)
  assert.throws(() => new GameObject().addComponent(mesh), /owned component/)
  assert.throws(() => object.addComponent(new TransformComponent()), /duplicate/)
  assert.throws(() => object.removeComponent(TransformComponent), /required component/)
  level.addObject(object)
  assert.equal(root.parent, scene)
  assert.deepEqual(root.position.toArray(), [1, 2, 3])
  object.dispose()
  object.dispose()
  level.dispose()
  assert.equal(releases, 1)
  assert.equal(scene.children.length, 0)
  assert.equal(level.objects.size, 0)
  assert.equal(mesh.owner, null)
})

test('failed GO and live-component attachments roll back scene, membership and reverse-order resources', () => {
  const level = new Level({
    scene: new Scene(),
  })
  const object = new GameObject()
  const calls = []
  class Broken extends Component {
    static requires = [MeshComponent]
    static phases = ['input']
    onAttach() { throw new Error('attachment failed') }
    tick() { calls.push('unexpected tick') }
    dispose() { calls.push('broken') }
  }
  const addMesh = (owner) => {
    owner.addComponent(new TransformComponent())
    owner.addComponent(new MeshComponent({
      root: new Group(),
      scene: level.scene,
      release: () => calls.push('mesh'),
    }))
  }
  addMesh(object)
  const broken = object.addComponent(new Broken())
  assert.throws(() => level.addObject(object), /attachment failed/)
  assert.deepEqual(calls, ['broken', 'mesh'])
  assert.equal(broken.owner, null)
  assert.equal(level.objects.size, 0)
  assert.equal(level.scene.children.length, 0)
  const live = new GameObject()
  addMesh(live)
  level.addObject(live)
  assert.throws(() => live.addComponent(new Broken()), /attachment failed/)
  assert.equal(live.getComponent(Broken), undefined)
  level.tickComponents('input', frame)
  assert.deepEqual(calls, ['broken', 'mesh', 'broken'])
  level.dispose()
  assert.deepEqual(calls, ['broken', 'mesh', 'broken', 'mesh'])
})

test('Mesh consumes Transform samples, preserves child poses and releases only its instance', () => {
  const scene = new Scene()
  const level = new Level({ scene })
  const object = new GameObject()
  const transform = object.addComponent(new TransformComponent())
  const root = new Group()
  const child = new Group()
  child.position.set(7, 8, 9)
  root.add(child)
  object.addComponent(new MeshComponent({ root, scene }))
  level.addObject(object)
  transform.interpolate = true
  transform.capturePosition()
  transform.position.set(10, 20, 30)
  transform.scale.set(2, 3, 4)
  transform.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), 0.5)
  level.tickComponents('presentation', frame)
  assert.deepEqual(root.position.toArray(), [5, 10, 15])
  assert.deepEqual(transform.position.toArray(), [10, 20, 30])
  assert.deepEqual(child.position.toArray(), [7, 8, 9])
  assert.ok(root.quaternion.equals(transform.quaternion))
  assert.ok(root.scale.equals(transform.scale))
  root.position.set(100, 100, 100)
  level.tickComponents('presentation', frame)
  assert.deepEqual(root.position.toArray(), [5, 10, 15], 'node edits are not simulation state')
  transform.teleport(new Vector3(40, 50, 60))
  level.tickComponents('presentation', frame)
  assert.deepEqual(root.position.toArray(), [40, 50, 60])
  transform.interpolate = false
  transform.position.x = 80
  assert.equal(transform.samplePosition(0).x, 80, 'frame motion is not interpolated twice')
  level.dispose()
})

test('phase declarations fail before attachment side effects and dispatch rejects typos', () => {
  const level = new Level({
    scene: new Scene(),
  })
  const object = new GameObject()
  let attachments = 0
  class Invalid extends Component {
    static phases = ['presenation']
    onAttach() { attachments++ }
  }
  const invalid = new Invalid()
  assert.throws(() => object.addComponent(invalid), /Unknown tick phase/)
  assert.equal(invalid.owner, null)
  Invalid.phases = ['input', 'input']
  assert.throws(() => object.addComponent(invalid), /duplicates/)
  Invalid.phases = ['input']
  object.addComponent(invalid)
  Invalid.phases = ['typo']
  assert.throws(() => level.addObject(object), /Unknown tick phase/)
  assert.equal(object.level, null)
  assert.equal(level.objects.size, 0)
  assert.equal(attachments, 0)
  assert.throws(() => level.tickComponents('typo', frame), /Unknown tick phase/)
  object.dispose()
  level.dispose()
})

test('phase snapshots permit enable-before-visit, skip self-removal and reject recursive dispatch', () => {
  const level = new Level({
    scene: new Scene(),
  })
  const calls = []
  const first = level.addObject(new GameObject())
  const second = level.addObject(new GameObject())
  class Later extends Component {
    enabled = false
    static phases = ['input']
    tick(context) {
      assert.equal(context.delta, frame.time.delta)
      calls.push('later')
    }
  }
  const later = second.addComponent(new Later())
  class First extends Component {
    static phases = ['input']
    tick(context) {
      calls.push('first')
      assert.throws(() => level.tickComponents('motion', frame), /reenter/)
      assert.throws(() => {
        context.delta = 20
      }, TypeError)
      assert.throws(() => {
        context.time.delta = 20
      }, TypeError)
      later.enabled = true
      this.owner.removeComponent(First)
    }
  }
  first.addComponent(new First())
  level.tickComponents('input', frame)
  level.tickComponents('input', frame)
  assert.deepEqual(calls, ['first', 'later', 'later'])
  level.dispose()
})

test('new components join subsequent phases and substeps, never the active phase snapshot', () => {
  const level = new Level({
    scene: new Scene(),
  })
  const calls = []
  const first = level.addObject(new GameObject({ name: 'first' }))
  const second = level.addObject(new GameObject({ name: 'second' }))
  class Spawned extends Component {
    static phases = ['fixed', 'postPhysics', 'presentation']
    tick({ phase, time }) { calls.push([phase, time.fixedStepIndex]) }
  }
  class Spawner extends Component {
    static phases = ['fixed']
    tick() {
      if (!second.getComponent(Spawned))
        second.addComponent(new Spawned())
    }
  }
  first.addComponent(new Spawner())
  const engine = new Engine({ world: level })
  engine.step(0)
  engine.step(50)
  assert.deepEqual(calls, [
    ['postPhysics', 0],
    ['fixed', 1],
    ['postPhysics', 1],
    ['fixed', 2],
    ['postPhysics', 2],
    ['presentation', null],
  ])
  engine.destroy()
  level.dispose()
})

test('unload inside a tick skips pending callbacks and releases live GO before shared resources', () => {
  const level = new Level({
    scene: new Scene(),
  })
  const calls = []
  class Release extends Component {
    static phases = ['input']
    tick() { calls.push(`tick:${this.owner.name}`) }
    dispose() { calls.push(`release:${this.owner.name}`) }
  }
  const removed = new GameObject({ name: 'removed' })
  removed.addComponent(new Release())
  level.addObject(removed)
  level.removeObject(removed.id)
  const first = new GameObject({ name: 'first' })
  class Unload extends Component {
    static phases = ['input']
    tick() { level.dispose() }
  }
  first.addComponent(new Unload())
  first.addComponent(new Release())
  level.addObject(first)
  level.disposer.add(() => calls.push('shared'))
  const last = new GameObject({ name: 'last' })
  last.addComponent(new Release())
  level.addObject(last)
  level.tickComponents('input', frame)
  level.dispose()
  assert.deepEqual(calls, [
    'release:removed',
    'release:last',
    'release:first',
    'shared',
  ])
  assert.equal(level.objects.size, 0)
})
