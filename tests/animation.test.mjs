import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AnimationClip,
  Bone,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  InterpolateDiscrete,
  Mesh,
  MeshBasicMaterial,
  NumberKeyframeTrack,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  VectorKeyframeTrack,
} from 'three'
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js'
import { AnimationPlayer } from '../src/engine/runtime/function/animation/animation-player.js'
import { ClipLibrary } from '../src/engine/runtime/function/animation/clip-library.js'

function close(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-5, message ?? `expected ${actual} to equal ${expected}`)
}

function rig() {
  const root = new Group()
  root.name = 'visualRoot'
  const joint = new Bone()
  joint.name = 'joint'
  joint.position.set(2, 0, 0)
  root.add(joint)
  return { root, joint }
}

function positionClip(name, from, to = from, duration = 1) {
  return new AnimationClip(name, duration, [
    new VectorKeyframeTrack('joint.position', duration === 0
      ? [0]
      : [0, duration], duration === 0
      ? [from, 0, 0]
      : [from, 0, 0, to, 0, 0]),
  ])
}

function setup(t, { clips = [
  positionClip('move', 0, 10),
], actions = {
  move: { clip: 'move' },
}, root: suppliedRoot } = {}) {
  const { root, joint } = suppliedRoot
    ? {
        root: suppliedRoot,
        joint: suppliedRoot.getObjectByName('joint'),
      }
    : rig()
  const player = new AnimationPlayer({ root, clips, actions })
  t.after(() => player.dispose())
  return { player, root, joint, clips }
}

function markers(events) {
  return events.filter(event => event.type === 'marker')
}

test('the first action starts at full weight and a one-shot holds its final pose', (t) => {
  const { player, joint } = setup(t)
  const id = player.play('move')
  assert.ok(Number.isSafeInteger(id) && id > 0)
  assert.equal(player.snapshot().layers.length, 1)
  close(player.snapshot().layers[0].weight, 1)
  player.advance(0)
  close(joint.position.x, 0)
  player.advance(0.5)
  close(joint.position.x, 5)
  const finished = player.advance(1)
  assert.equal(finished.filter(event => event.type === 'finished').length, 1)
  close(finished.find(event => event.type === 'finished').at, 1)
  close(joint.position.x, 10)
  assert.equal(player.snapshot().current.finished, true)
  close(player.snapshot().current.localTime, 1)
  assert.deepEqual(player.advance(2), [])
  close(joint.position.x, 10)
})

test('reselecting the current role is idempotent but restart creates a new playback', (t) => {
  const { player, joint } = setup(t)
  const first = player.play('move')
  player.advance(0.4)
  assert.equal(player.play('move'), first)
  close(player.snapshot().current.localTime, 0.4)
  close(joint.position.x, 4)
  const restarted = player.play('move', { restart: true, fade: 0 })
  assert.notEqual(restarted, first)
  player.advance(0)
  close(player.snapshot().current.localTime, 0)
  close(joint.position.x, 0)
  player.advance(0.2)
  close(joint.position.x, 2)
})

test('STEP channels hold their previous value until the exact next key', (t) => {
  const stepTrack = new VectorKeyframeTrack('joint.scale', [0, 0.5, 1], [1, 1, 1, 0, 0, 0, 1, 1, 1], InterpolateDiscrete)
  const clip = new AnimationClip('visibility', 1, [stepTrack])
  const { player, joint } = setup(t, {
    clips: [clip],
    actions: {
      hide: { clip: 'visibility', fade: 0 },
    },
  })
  player.play('hide')
  player.advance(0.499)
  assert.deepEqual(joint.scale.toArray(), [1, 1, 1])
  player.advance(0.001)
  assert.deepEqual(joint.scale.toArray(), [0, 0, 0])
  player.advance(0.499)
  assert.deepEqual(joint.scale.toArray(), [0, 0, 0])
  player.advance(0.001)
  assert.deepEqual(joint.scale.toArray(), [1, 1, 1])
  assert.equal(stepTrack.getInterpolation(), InterpolateDiscrete)
})

test('required clips, missing target nodes, missing properties and duplicate binding names fail preparation', () => {
  const { root } = rig()
  const valid = positionClip('move', 0, 10)
  assert.throws(() => new ClipLibrary({
    root,
    clips: [valid],
    actions: {
      fire: { clip: 'absent' },
    },
  }))
  const missingNode = new AnimationClip('missing', 1, [
    new NumberKeyframeTrack('absent.visible', [0, 1], [1, 0]),
  ])
  assert.throws(() => new ClipLibrary({
    root,
    clips: [missingNode],
    actions: {
      fire: { clip: 'missing' },
    },
  }))
  const missingProperty = new AnimationClip('missingProperty', 1, [
    new NumberKeyframeTrack('joint.nonexistent', [0, 1], [0, 1]),
  ])
  assert.throws(() => new ClipLibrary({
    root,
    clips: [missingProperty],
    actions: {
      fire: { clip: 'missingProperty' },
    },
  }))
  const duplicate = new Group()
  duplicate.name = 'joint'
  root.add(duplicate)
  assert.throws(() => new ClipLibrary({
    root,
    clips: [valid],
    actions: {
      move: { clip: 'move' },
    },
  }))
})

test('unsupported compound bindings reject explicitly instead of silently dropping tracks', () => {
  const { root } = rig()
  const clip = new AnimationClip('compound', 1, [
    new NumberKeyframeTrack('visualRoot.bones[joint].position[x]', [0, 1], [0, 1]),
  ])
  assert.throws(() => new ClipLibrary({
    root,
    clips: [clip],
    actions: {
      move: { clip: 'compound' },
    },
  }))
})

test('direct indexed properties and named morph targets remain valid bindings', (t) => {
  const { root, joint } = rig()
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0], 3))
  const morph = new Float32BufferAttribute([1, 0, 0], 3)
  morph.name = 'open'
  geometry.morphAttributes.position = [morph]
  const material = new MeshBasicMaterial()
  const mesh = new Mesh(geometry, material)
  mesh.name = 'morph'
  root.add(mesh)
  t.after(() => {
    geometry.dispose()
    material.dispose()
  })
  const clip = new AnimationClip('indexed', 1, [
    new NumberKeyframeTrack('joint.position[x]', [0, 1], [0, 10]),
    new NumberKeyframeTrack('morph.morphTargetInfluences[open]', [0, 1], [0, 1]),
  ])
  const { player } = setup(t, {
    root,
    clips: [clip],
    actions: {
      move: { clip: 'indexed' },
    },
  })
  player.play('move')
  player.advance(0.5)
  close(joint.position.x, 5)
  close(mesh.morphTargetInfluences[0], 0.5)
})

test('clip library rejects duplicate clips and invalid action timing before playing', () => {
  const { root } = rig()
  const clip = positionClip('move', 0, 10)
  assert.throws(() => new ClipLibrary({
    root,
    clips: [
      clip,
      clip.clone(),
    ],
    actions: {
      move: { clip: 'move' },
    },
  }))
  for (const action of [
    { clip: 'move', rate: 0 },
    { clip: 'move', rate: Number.NaN },
    { clip: 'move', fade: -1 },
    {
      clip: 'move',
      markers: [
        { id: 'outside', time: 1.1 },
      ],
    },
    {
      clip: 'move',
      markers: [
        { id: 'duplicate', time: 0.2 },
        { id: 'duplicate', time: 0.4 },
      ],
    },
  ]) {
    assert.throws(() => new ClipLibrary({
      root,
      clips: [clip],
      actions: { move: action },
    }))
  }
})

test('one-shot marker timestamps use playback rate and the event time, not the discovery frame', (t) => {
  const { player } = setup(t, {
    actions: {
      move: {
        clip: 'move',
        rate: 2,
        markers: [
          { id: 'start', time: 0 },
          { id: 'middle', time: 0.5 },
          { id: 'end', time: 1 },
        ],
      },
    },
  })
  const id = player.play('move')
  const zero = player.advance(0)
  assert.deepEqual(markers(zero).map(event => event.marker.id), ['start'])
  assert.equal(zero[0].at, 0)
  assert.deepEqual(player.advance(0), [])
  const crossed = player.advance(0.8)
  assert.deepEqual(crossed.map(event => event.type), ['marker', 'marker', 'finished'])
  assert.deepEqual(markers(crossed).map(event => event.marker.id), ['middle', 'end'])
  assert.deepEqual(crossed.map(event => event.at), [0.25, 0.5, 0.5])
  assert.ok([
    ...zero,
    ...crossed,
  ].every(event => event.playbackId === id && event.role === 'move'))
  assert.ok(Object.isFrozen(crossed))
  assert.deepEqual(player.advance(1), [])
  close(player.snapshot().time, 1.8)
})

test('a large advance emits every crossed loop marker once with deterministic boundary ordering', (t) => {
  const { player } = setup(t, {
    actions: {
      move: {
        clip: 'move',
        loop: true,
        markers: [
          { id: 'start', time: 0 },
          { id: 'middle', time: 0.5 },
          { id: 'end', time: 1 },
        ],
      },
    },
  })
  player.play('move')
  const events = player.advance(2.2)
  assert.deepEqual(events.map(event => event.type), Array.from({ length: 7 }).fill('marker'))
  assert.deepEqual(events.map(event => event.marker.id), [
    'start',
    'middle',
    'end',
    'start',
    'middle',
    'end',
    'start',
  ])
  assert.deepEqual(events.map(event => event.at), [0, 0.5, 1, 1, 1.5, 2, 2])
  close(player.snapshot().current.localTime, 0.2)
  assert.equal(player.snapshot().current.finished, false)
  assert.deepEqual(player.advance(0), [])
  const next = player.advance(0.3)
  assert.equal(next.length, 1)
  assert.equal(next[0].marker.id, 'middle')
  close(next[0].at, 2.5)
})

test('different frame partitions produce identical marker identities, times and final pose', (t) => {
  const options = {
    actions: {
      move: {
        clip: 'move',
        loop: true,
        markers: [
          { id: 'begin', time: 0 },
          { id: 'middle', time: 0.4 },
          { id: 'end', time: 1 },
        ],
      },
    },
  }
  const whole = setup(t, options)
  const split = setup(t, options)
  whole.player.play('move')
  split.player.play('move')
  const batch = whole.player.advance(2.5)
  const partitioned = Array.from({ length: 25 }, () => split.player.advance(0.1)).flat()
  assert.deepEqual(partitioned.map(event => [event.type, event.marker?.id]), batch.map(event => [event.type, event.marker?.id]))
  for (let index = 0; index < batch.length; index++) close(partitioned[index].at, batch[index].at)
  close(split.joint.position.x, whole.joint.position.x)
})

test('300 updates at 60 Hz reach the same loop boundary as one five-second update', (t) => {
  const options = {
    actions: {
      move: {
        clip: 'move',
        loop: true,
        markers: [
          { id: 'start', time: 0 },
          { id: 'end', time: 1 },
        ],
      },
    },
  }
  const whole = setup(t, options)
  const split = setup(t, options)
  whole.player.play('move')
  split.player.play('move')
  const batch = whole.player.advance(5)
  const partitioned = []
  for (let frame = 0; frame < 300; frame++) partitioned.push(...split.player.advance(1 / 60))
  assert.deepEqual(partitioned.map(event => [event.type, event.marker.id, event.at]), batch.map(event => [event.type, event.marker.id, event.at]))
  assert.equal(partitioned.length, 11)
  close(split.player.snapshot().time, 5)
  close(split.player.snapshot().current.localTime, 0)
  close(split.joint.position.x, whole.joint.position.x)
  assert.deepEqual(split.player.advance(0), [])
})

test('interrupted fade continues from every current weight without a pose jump', (t) => {
  const { player, joint } = setup(t, {
    clips: [
      positionClip('a', 0, 0, 10),
      positionClip('b', 10, 10, 10),
      positionClip('c', 20, 20, 10),
    ],
    actions: {
      a: { clip: 'a', loop: true, fade: 1 },
      b: { clip: 'b', loop: true, fade: 1 },
      c: { clip: 'c', loop: true, fade: 1 },
    },
  })
  player.play('a')
  player.advance(0)
  player.play('b')
  player.advance(0.5)
  close(joint.position.x, 5)
  const before = player.snapshot().layers
  player.play('c')
  player.advance(0)
  close(joint.position.x, 5)
  for (const layer of before) {
    close(player.snapshot().layers.find(next => next.playbackId === layer.playbackId).weight, layer.weight)
  }
  player.advance(0.5)
  const weights = Object.fromEntries(player.snapshot().layers.map(layer => [layer.role, layer.weight]))
  close(weights.a, 0.25)
  close(weights.b, 0.25)
  close(weights.c, 0.5)
  close(joint.position.x, 12.5)
  close(player.snapshot().layers.reduce((sum, layer) => sum + layer.weight, 0), 1)
  player.advance(0.5)
  assert.equal(player.snapshot().layers.length, 1)
  close(joint.position.x, 20)
})

test('restarting the same clip keeps a separate outgoing pose and silences its future events', (t) => {
  const { player, joint } = setup(t, {
    actions: {
      move: {
        clip: 'move',
        markers: [
          { id: 'late', time: 0.9 },
        ],
      },
    },
  })
  const previous = player.play('move')
  player.advance(0.6)
  close(joint.position.x, 6)
  const current = player.play('move', { restart: true, fade: 0.5 })
  assert.notEqual(current, previous)
  assert.equal(player.snapshot().layers.length, 2)
  player.advance(0)
  close(joint.position.x, 6)
  const during = player.advance(0.25)
  close(joint.position.x, 5.5)
  assert.deepEqual(during, [])
  const endsOld = player.advance(0.25)
  assert.deepEqual(endsOld, [])
  assert.equal(player.snapshot().layers.length, 1)
  close(joint.position.x, 5)
  const endsNew = player.advance(0.5)
  assert.deepEqual(endsNew.map(event => event.type), ['marker', 'finished'])
  assert.ok(endsNew.every(event => event.playbackId === current))
  close(endsNew[0].at, 1.5)
  close(endsNew[1].at, 1.6)
})

test('continuous restarts faster than the fade keep mixer actions bounded and stop releases them', (t) => {
  const { player } = setup(t, {
    actions: {
      move: { clip: 'move', fade: 0.1 },
    },
  })
  player.play('move')
  for (let shot = 0; shot < 500; shot++) {
    player.advance(0.09)
    player.play('move', { restart: true })
    const snapshot = player.snapshot()
    assert.ok(snapshot.stats.actions < 10, `shot ${shot + 1} retained ${snapshot.stats.actions} actions`)
    close(snapshot.layers.reduce((sum, layer) => sum + layer.weight, 0), 1)
  }
  player.stop()
  assert.equal(player.snapshot().layers.length, 0)
  assert.deepEqual(player.snapshot().stats, { actions: 0, bindings: 0 })
})

test('zero-length poses finish once while zero-length loops remain finite and static', (t) => {
  const clips = [
    positionClip('pose', 7, 7, 0),
  ]
  const once = setup(t, {
    clips,
    actions: {
      pose: {
        clip: 'pose',
        markers: [
          { id: 'start', time: 0 },
        ],
      },
    },
  })
  once.player.play('pose')
  assert.deepEqual(once.player.advance(0).map(event => event.type), ['marker', 'finished'])
  assert.deepEqual(once.player.advance(10), [])
  close(once.joint.position.x, 7)
  const loop = setup(t, {
    clips,
    actions: {
      pose: {
        clip: 'pose',
        loop: true,
        markers: [
          { id: 'start', time: 0 },
        ],
      },
    },
  })
  loop.player.play('pose')
  assert.deepEqual(loop.player.advance(0).map(event => event.type), ['marker'])
  assert.deepEqual(loop.player.advance(10), [])
  assert.equal(loop.player.snapshot().current.finished, false)
  close(loop.player.snapshot().current.localTime, 0)
  close(loop.joint.position.x, 7)
})

test('invalid advance or play parameters leave the published pose, time and pending marker untouched', (t) => {
  const { player, joint } = setup(t, {
    actions: {
      move: {
        clip: 'move',
        markers: [
          { id: 'start', time: 0 },
        ],
      },
    },
  })
  player.play('move')
  const before = player.snapshot()
  const beforePosition = joint.position.clone()
  for (const value of [-0.1, Number.NaN, Infinity]) {
    assert.throws(() => player.advance(value))
    assert.deepEqual(player.snapshot(), before)
    assert.ok(joint.position.equals(beforePosition))
  }
  assert.throws(() => player.play('unknown'))
  assert.throws(() => player.play('move', { restart: true, rate: 0 }))
  assert.throws(() => player.play('move', { restart: true, fade: -1 }))
  assert.deepEqual(player.snapshot(), before)
  assert.deepEqual(markers(player.advance(0)).map(event => event.marker.id), ['start'])
})

test('stop restores the bind pose and cancels all pending playback events', (t) => {
  const { player, joint } = setup(t, {
    actions: {
      move: {
        clip: 'move',
        markers: [
          { id: 'late', time: 0.9 },
        ],
      },
    },
  })
  const first = player.play('move')
  player.advance(0.5)
  close(joint.position.x, 5)
  player.stop()
  close(joint.position.x, 2)
  assert.equal(player.snapshot().current, null)
  assert.equal(player.snapshot().layers.length, 0)
  assert.deepEqual(player.advance(3), [])
  const replay = player.play('move')
  assert.notEqual(replay, first)
  player.advance(0.1)
  close(joint.position.x, 1)
})

test('independently cloned skeletons can share immutable clips and geometry without sharing animation state', (t) => {
  const { root: template, joint: templateJoint } = rig()
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3))
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(Array.from({ length: 12 }).fill(0), 4))
  geometry.setAttribute('skinWeight', new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4))
  const material = new MeshBasicMaterial()
  const mesh = new SkinnedMesh(geometry, material)
  mesh.name = 'weapon'
  template.add(mesh)
  template.updateMatrixWorld(true)
  mesh.bind(new Skeleton([templateJoint]))
  const a = cloneSkeleton(template)
  const b = cloneSkeleton(template)
  const clips = [
    positionClip('move', 0, 10),
  ]
  const first = setup(t, { root: a, clips })
  const second = setup(t, { root: b, clips })
  const aMesh = a.getObjectByName('weapon')
  const bMesh = b.getObjectByName('weapon')
  assert.notEqual(aMesh.skeleton, bMesh.skeleton)
  assert.notEqual(aMesh.skeleton.bones[0], bMesh.skeleton.bones[0])
  assert.equal(aMesh.geometry, bMesh.geometry)
  first.player.play('move')
  first.player.advance(0.7)
  second.player.play('move')
  second.player.advance(0.2)
  close(first.joint.position.x, 7)
  close(second.joint.position.x, 2)
  close(templateJoint.position.x, 2)
  let geometryDisposals = 0
  let materialDisposals = 0
  geometry.addEventListener('dispose', () => geometryDisposals++)
  material.addEventListener('dispose', () => materialDisposals++)
  first.player.dispose()
  assert.equal(geometryDisposals, 0)
  assert.equal(materialDisposals, 0)
  second.player.advance(0.2)
  close(second.joint.position.x, 4)
  assert.deepEqual(Array.from(clips[0].tracks[0].values), [0, 0, 0, 10, 0, 0])
  t.after(() => {
    for (const visual of [template, a, b]) visual.getObjectByName('weapon').skeleton.dispose()
    geometry.dispose()
    material.dispose()
  })
})

test('dispose releases mixer caches, restores pose, is idempotent and rejects future playback', (t) => {
  const { player, joint } = setup(t)
  player.play('move')
  player.advance(0.5)
  assert.ok(player.snapshot().stats.actions > 0)
  assert.ok(player.snapshot().stats.bindings > 0)
  player.dispose()
  close(joint.position.x, 2)
  assert.equal(player.snapshot().layers.length, 0)
  assert.deepEqual(player.snapshot().stats, { actions: 0, bindings: 0 })
  assert.doesNotThrow(() => player.dispose())
  assert.throws(() => player.play('move'))
  assert.throws(() => player.advance(0))
})
