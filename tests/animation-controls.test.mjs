import assert from 'node:assert/strict'
import test from 'node:test'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { AnimationClip, Group, NumberKeyframeTrack, VectorKeyframeTrack } from 'three/webgpu'
import { AnimationPlayer } from '../src/engine/runtime/function/animation/animation-player.js'
import { ClipLibrary } from '../src/engine/runtime/function/animation/clip-library.js'
import { ammoControlSamples } from '../src/game/weapons/assets/weapon-control-profile.js'
import { controlFixture, controlRig, visibleIndicators } from './weapon-control-fixture.mjs'

const close = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`)

function fixture(t, data, controls = data.runtimeControls) {
  const rig = controlRig(data)
  const tracks = [
    ...new Set(Object.values(controls).flatMap(profile => profile.tracks)),
  ].map(name => new VectorKeyframeTrack(name, [0, 2], [1, 1, 1, 1, 1, 1]))
  const main = new AnimationClip('main', 2, [
    ...tracks,
    new VectorKeyframeTrack('righthand.scale', [0, 2], [2, 3, 4, 2, 3, 4]),
    new NumberKeyframeTrack('.position[x]', [0, 2], [0, 2]),
  ])
  const clips = [...rig.clips, main]
  const actions = {
    main: {
      clip: 'main',
      markers: [
        { id: 'main-marker', time: 1 },
      ],
    },
  }
  const player = new AnimationPlayer({
    root: rig.root,
    clips,
    actions,
    controls,
  })
  t.after(() => player.dispose())
  return {
    ...rig,
    player,
    allClips: clips,
    actions,
  }
}

for (const id of ['judge', 'odin']) {
  test(`${id} source-derived controls exclude the actual unrelated hand track and never start Mixer actions/events`, async (t) => {
    const data = await controlFixture(id)
    const f = fixture(t, data)
    assert.ok(data.clips.every(clip => clip.sourceCurveCount > clip.tracks.length * 3))
    f.player.setControls({ ammoDisplay: data.clips[0].duration })
    assert.equal(f.player.snapshot().current, null)
    assert.deepEqual(f.player.snapshot().stats, { actions: 0, bindings: 0 })
    assert.deepEqual(f.player.advance(0), [])
    assert.deepEqual(f.bones.get('righthand').scale.toArray(), [1, 1, 1])
    f.player.play('main', { fade: 0 })
    f.player.advance(0.5)
    assert.deepEqual(f.bones.get('righthand').scale.toArray(), [2, 3, 4])
    assert.equal(visibleIndicators(f.root, data), 0)
    close(f.root.position.x, 0.5)
    const before = f.player.snapshot()
    f.player.setControls({ ammoDisplay: 0 })
    assert.equal(visibleIndicators(f.root, data), data.runtimeControls.ammoDisplay.tracks.length)
    assert.deepEqual(f.player.snapshot().current, before.current)
    assert.deepEqual(f.player.snapshot().stats, before.stats)
    assert.equal(f.player.advance(0.5).filter(event => event.type === 'marker').length, 1)
    assert.deepEqual(f.player.advance(0), [])
  })

  test(`${id} explicit visible-feed thresholds saturate above the authored window, not at a guessed capacity`, async (t) => {
    const data = await controlFixture(id)
    const f = fixture(t, data)
    const count = data.runtimeControls.ammoDisplay.tracks.length
    for (const magazine of [
      100,
      count + 2,
      count,
      ...Array.from({ length: count }, (_, i) => count - i - 1),
      3,
      0,
      count,
    ]) {
      f.player.setControls(ammoControlSamples(data, magazine))
      assert.equal(visibleIndicators(f.root, data), Math.min(magazine, count), `magazine=${magazine}`)
    }
    for (const value of [-1, 1.5, NaN, Infinity]) assert.throws(() => ammoControlSamples(data, value), /magazine/)
  })

  test(`${id} absolute control sampling is repeatable, reversible and independent at 30/60/144 FPS`, async (t) => {
    const data = await controlFixture(id)
    const checkpoints = [0.07, 0.1, 0.12345, 0.5, 0.63, 0.8, 1]
    const stable = value => JSON.parse(JSON.stringify(value, (_key, entry) => typeof entry === 'number'
      ? Number(entry.toFixed(8))
      : entry))
    let expected
    for (const fps of [30, 60, 144, null]) {
      const f = fixture(t, data)
      f.player.play('main')
      const frames = new Set(checkpoints)
      if (fps) {
        for (let frame = 1; frame / fps < 1; frame++) frames.add(frame / fps)
      }
      let previous = 0
      const poses = []
      for (const at of [...frames].sort((a, b) => a - b)) {
        f.player.advance(at - previous)
        f.player.setControls({ ammoDisplay: at * data.clips[0].duration })
        previous = at
        if (checkpoints.includes(at)) {
          const pose = () => stable({
            x: f.root.position.x,
            scales: data.runtimeControls.ammoDisplay.tracks.map(name => f.bones.get(name.split('.')[0]).scale.toArray()),
          })
          const first = pose()
          f.player.setControls({ ammoDisplay: 0 })
          f.player.setControls({ ammoDisplay: data.clips[0].duration })
          f.player.setControls({ ammoDisplay: at * data.clips[0].duration })
          assert.deepEqual(pose(), first)
          poses.push(first)
        }
      }
      if (expected)
        assert.deepEqual(poses, expected, `FPS=${fps ?? 'catch-up'}`)
      expected ??= poses
    }
  })

  test(`${id} two instances share source tracks but never bindings, interpolants or underlying poses`, async (t) => {
    const data = await controlFixture(id)
    const a = fixture(t, data)
    const bRoot = a.root.clone(true)
    const b = new AnimationPlayer({
      root: bRoot,
      clips: a.allClips,
      actions: a.actions,
      controls: data.runtimeControls,
    })
    t.after(() => b.dispose())
    const before = a.allClips.map(clip => clip.tracks.map(track => Array.from(track.values)))
    a.player.play('main')
    b.play('main')
    a.player.setControls(ammoControlSamples(data, 0))
    b.setControls(ammoControlSamples(data, 3))
    assert.equal(visibleIndicators(a.root, data), 0)
    assert.equal(visibleIndicators(bRoot, data), 3)
    a.player.setControls(ammoControlSamples(data, 5))
    assert.equal(visibleIndicators(bRoot, data), 3)
    a.player.dispose()
    assert.deepEqual(a.player.snapshot().controls, { samples: {}, bindings: 0 })
    b.advance(0.5)
    assert.equal(visibleIndicators(bRoot, data), 3)
    assert.deepEqual(a.allClips.map(clip => clip.tracks.map(track => Array.from(track.values))), before)
  })
}

test('Odin STEP hides exactly at every encoded Float32 key, not just near its nominal decimal timestamp', async (t) => {
  const data = await controlFixture('odin')
  const f = fixture(t, data)
  for (const track of f.clips[0].tracks.filter(track => track.name.startsWith('group_'))) {
    const index = Array.from(track.times).findIndex((_time, i) => track.values[i * 3] < 0.5)
    const boundary = track.times[index]
    f.player.setControls({ ammoDisplay: boundary - 1e-7 })
    assert.equal(f.bones.get(track.name.split('.')[0]).scale.x, 1)
    f.player.setControls({ ammoDisplay: boundary })
    close(f.bones.get(track.name.split('.')[0]).scale.x, 1e-5)
    f.player.setControls({ ammoDisplay: boundary + 1e-7 })
    close(f.bones.get(track.name.split('.')[0]).scale.x, 1e-5)
  }
})

test('Judge linear fades and meaningful constant bolt pose both sample without the unrelated authored poses', async (t) => {
  const data = await controlFixture('judge')
  const f = fixture(t, data)
  f.player.play('main')
  f.player.setControls({ ammoDisplay: (6.5 - 1) / 60, boltCaught: 0.025 })
  close(f.bones.get('bullet4').scale.x, (1 + 0.7997601628303528) / 2)
  close(f.bones.get('bullets').scale.x, 1e-5)
  assert.equal(visibleIndicators(f.root, data), 0, 'constant parent pose still changes actual descendants')
  assert.deepEqual(f.bones.get('righthand').scale.toArray(), [2, 3, 4])
  f.player.setControls({ ammoDisplay: (6.5 - 1) / 60 })
  assert.equal(f.bones.get('bullets').scale.x, 1)
  assert.equal(visibleIndicators(f.root, data), 5)
})

test('Odin barrel clip controls the two weighted red scale indicators, not an invented barrel rotation', async (t) => {
  const data = await controlFixture('odin')
  const f = fixture(t, data)
  f.player.play('main')
  f.player.setControls({
    barrelIndicators: (55.5 - 1) / 60,
    ammoDisplay: Math.fround(0.8),
  })
  close(f.bones.get('red_2').scale.x, 5 / 6)
  assert.equal(f.bones.get('red_1').scale.x, 1)
  assert.equal(visibleIndicators(f.root, data), 0)
  f.player.setControls({ barrelIndicators: (88.5 - 1) / 60 })
  close(f.bones.get('red_1').scale.x, 5 / 6, 2e-6)
  close(f.bones.get('red_2').scale.x, 1e-5)
  assert.deepEqual(f.bones.get('red_1').quaternion.toArray(), [0, 0, 0, 1])
  assert.equal(data.weightedDescendants.red_1['Weapon_Body.008'].red_1, 432)
})

test('clearing overrides restores the current cached Mixer pose, and activation never captures an overridden original', (t) => {
  const root = new Group()
  root.name = 'joint'
  root.scale.setScalar(0.7)
  const clips = [
    new AnimationClip('other', 1, [
      new NumberKeyframeTrack('.position[x]', [0, 1], [0, 1]),
    ]),
    new AnimationClip('main', 1, [
      new VectorKeyframeTrack('.scale', [0, 1], [0.5, 0.5, 0.5, 0.5, 0.5, 0.5]),
    ]),
    new AnimationClip('control', 1, [
      new VectorKeyframeTrack('joint.scale', [0, 1], [0.01, 0.01, 0.01, 0.01, 0.01, 0.01]),
    ]),
  ]
  const player = new AnimationPlayer({
    root,
    clips,
    actions: {
      other: { clip: 'other' },
      main: { clip: 'main' },
    },
    controls: {
      test: {
        clip: 'control',
        tracks: ['joint.scale'],
      },
    },
  })
  t.after(() => player.dispose())
  player.setControls({ test: 0 })
  player.play('other')
  player.play('main', { fade: 1 })
  player.advance(0.5)
  player.clearControls()
  close(root.scale.x, 0.6)
  player.advance(0.5)
  close(root.scale.x, 0.5)
  for (let i = 0; i < 3; i++) {
    player.setControls({ test: 0 })
    player.advance(0)
    player.clearControls()
    close(root.scale.x, 0.5, 1e-9)
  }
  player.setControls({ test: 0 })
  player.play('other', { fade: 0 })
  close(root.scale.x, 0.01)
  player.clearControls()
  close(root.scale.x, 0.7, 1e-9)
  player.setControls({ test: 1 })
  player.stop()
  assert.equal(root.scale.x, 0.7)
  assert.deepEqual(player.snapshot().stats, { actions: 0, bindings: 0 })
  assert.deepEqual(player.snapshot().controls, { samples: {}, bindings: 0 })
  player.dispose()
  player.dispose()
  assert.throws(() => player.setControls({ test: 0 }), /disposed/)
})

test('control requests validate atomically, including resolved aliases and whole-property/index overlap', (t) => {
  const root = new Group()
  root.name = 'joint'
  const clip = new AnimationClip('control', 1, [
    new VectorKeyframeTrack('joint.scale', [0, 1], [1, 2, 3, 3, 4, 5]),
    new NumberKeyframeTrack(`${root.uuid}.scale[x]`, [0, 1], [0, 1]),
    new NumberKeyframeTrack('joint.scale[y]', [0, 1], [0, 1]),
  ])
  const controls = {
    whole: {
      clip: 'control',
      tracks: ['joint.scale'],
    },
    x: {
      clip: 'control',
      tracks: [`${root.uuid}.scale[x]`],
    },
    y: {
      clip: 'control',
      tracks: ['joint.scale[y]'],
    },
  }
  const player = new AnimationPlayer({
    root,
    clips: [clip],
    actions: {},
    controls,
  })
  t.after(() => player.dispose())
  player.setControls({ whole: 0.5 })
  const before = player.snapshot()
  const pose = root.scale.toArray()
  for (const samples of [
    null,
    [],
    'whole',
    { absent: 0 },
    { whole: -1 },
    { whole: NaN },
    { whole: Infinity },
    { whole: 1.01 },
    { whole: 0.25, x: 0.5 },
  ]) {
    assert.throws(() => player.setControls(samples))
    assert.deepEqual(player.snapshot(), before)
    assert.deepEqual(root.scale.toArray(), pose)
  }
  player.setControls({ x: 0.3, y: 0.7 })
  close(root.scale.x, 0.3)
  close(root.scale.y, 0.7)
  assert.equal(root.scale.z, 1)
  player.clearControls()
  assert.deepEqual(root.scale.toArray(), [1, 1, 1])
})

test('invalid control profiles fail preflight instead of silently skipping properties or accepting a mismatched size', () => {
  const root = new Group()
  const clip = new AnimationClip('control', 1, [
    new VectorKeyframeTrack('.scale', [0, 1], [1, 1, 1, 2, 2, 2]),
  ])
  for (const controls of [
    null,
    [],
    {
      bad: {
        clip: 'absent',
        tracks: ['.scale'],
      },
    },
    {
      bad: { clip: 'control', tracks: [] },
    },
    {
      bad: {
        clip: 'control',
        tracks: ['.scale', '.scale'],
      },
    },
    {
      bad: {
        clip: 'control',
        tracks: ['.position'],
      },
    },
    {
      bad: {
        clip: 'control',
        tracks: ['.scale'],
        loop: true,
      },
    },
  ]) {
    assert.throws(() => new ClipLibrary({
      root,
      clips: [clip],
      actions: {},
      controls,
    }), /control/i)
  }
  const wrong = new AnimationClip('wrong', 1, [
    new NumberKeyframeTrack('.scale', [0, 1], [0, 1]),
  ])
  assert.throws(() => new ClipLibrary({
    root,
    clips: [wrong],
    actions: {},
    controls: {
      bad: {
        clip: 'wrong',
        tracks: ['.scale'],
      },
    },
  }), /numeric control binding/)
})

test('source GLTF CUBICSPLINE factories retain their tangent layout and per-instance output buffers', async (t) => {
  const binary = new Float32Array([
    0,
    1,
    0,
    0,
    0,
    1,
    2,
    3,
    1,
    0,
    -1,
    -1,
    0,
    1,
    3,
    4,
    5,
    0,
    0,
    0,
  ])
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [
      {
        nodes: [0],
      },
    ],
    nodes: [
      { name: 'joint' },
    ],
    buffers: [
      { byteLength: binary.byteLength },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 8 },
      { buffer: 0, byteOffset: 8, byteLength: 72 },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 2,
        type: 'SCALAR',
        min: [0],
        max: [1],
      },
      {
        bufferView: 1,
        componentType: 5126,
        count: 6,
        type: 'VEC3',
      },
    ],
    animations: [
      {
        name: 'cubic',
        samplers: [
          { input: 0, output: 1, interpolation: 'CUBICSPLINE' },
        ],
        channels: [
          {
            sampler: 0,
            target: { node: 0, path: 'scale' },
          },
        ],
      },
    ],
  }
  const text = new TextEncoder().encode(JSON.stringify(json))
  const length = Math.ceil(text.length / 4) * 4
  const glb = new ArrayBuffer(12 + 8 + length + 8 + binary.byteLength)
  const view = new DataView(glb)
  for (const [offset, value] of [
    [0, 0x46546C67],
    [4, 2],
    [8, glb.byteLength],
    [12, length],
    [16, 0x4E4F534A],
    [20 + length, binary.byteLength],
    [24 + length, 0x004E4942],
  ]) view.setUint32(offset, value, true)
  new Uint8Array(glb, 20, length).fill(32)
  new Uint8Array(glb, 20, text.length).set(text)
  new Uint8Array(glb, 28 + length).set(new Uint8Array(binary.buffer))
  const gltf = await new GLTFLoader().parseAsync(glb, '')
  assert.equal(gltf.animations[0].tracks[0].getValueSize(), 9)
  const player = new AnimationPlayer({
    root: gltf.scene,
    clips: gltf.animations,
    actions: {},
    controls: {
      cubic: {
        clip: 'cubic',
        tracks: ['joint.scale'],
      },
    },
  })
  t.after(() => player.dispose())
  player.setControls({ cubic: 0.5 })
  assert.deepEqual(gltf.scene.getObjectByName('joint').scale.toArray(), [2.25, 3, 3.75])
  player.clearControls()
  assert.deepEqual(gltf.scene.getObjectByName('joint').scale.toArray(), [1, 1, 1])
})

test('non-finite interpolant output rejects the whole request without corrupting a previously applied pose', (t) => {
  const root = new Group()
  const track = new VectorKeyframeTrack('.scale', [0, 1], [1, 1, 1, 1, 1, 1])
  track.createInterpolant = (result = new Float64Array(3)) => ({
    valueSize: 3,
    evaluate: time => result.fill(time > 0.5
      ? Infinity
      : 0.25),
  })
  const player = new AnimationPlayer({
    root,
    clips: [
      new AnimationClip('control', 1, [track]),
    ],
    actions: {},
    controls: {
      test: {
        clip: 'control',
        tracks: ['.scale'],
      },
    },
  })
  t.after(() => player.dispose())
  player.setControls({ test: 0 })
  const before = player.snapshot()
  assert.throws(() => player.setControls({ test: 0.75 }), /Non-finite/)
  assert.deepEqual(player.snapshot(), before)
  assert.deepEqual(root.scale.toArray(), [0.25, 0.25, 0.25])
})
