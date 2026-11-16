import assert from 'node:assert/strict'
import test from 'node:test'
import { AnimationClip, Group, NumberKeyframeTrack, Scene, Vector3 } from 'three/webgpu'
import { AnimationPlayer } from '../src/engine/runtime/function/animation/animation-player.js'
import { WeaponViewModel } from '../src/game/weapons/weapon-viewmodel.js'

const h = 0.02
const roles = [
  'idle',
  'aim',
  'fire',
  'fireAds',
  'draw',
  'holster',
  'reloadTactical',
  'reloadEmpty',
  'inspect',
]
const walkRoles = [
  'walkForward',
  'walkBackward',
  'walkSide',
  'walkAim',
]

async function fixture(t, { fireDuration = 0.04, locomotion = false, jumpFeedback } = {}) {
  const ticket = { epoch: 1, requestId: 1, instanceId: 'gun' }
  const weapon = {
    instanceId: 'gun',
    definitionId: 'test',
    skinId: 'default',
    magazine: 10,
    reserve: 30,
  }
  const definition = {
    id: 'test',
    assets: { modelId: 'test', assetVersion: 'v1' },
    reload: {
      tactical: { duration: 0.2 },
      empty: { duration: 0.2 },
    },
  }
  const modelRoles = locomotion
    ? [
        ...roles,
        ...walkRoles,
      ]
    : roles
  const clips = modelRoles.map((role) => {
    const duration = ['fire', 'fireAds'].includes(role)
      ? fireDuration
      : 1
    const values = ['fire', 'fireAds'].includes(role)
      ? [2, 3]
      : [0, 1]
    return new AnimationClip(role, duration, [
      new NumberKeyframeTrack('.position[x]', [0, duration], values),
    ])
  })
  const handle = {
    locomotion: locomotion
      ? Object.fromEntries(walkRoles.map(role => [role, role]))
      : {},
    manifest: {
      view: {
        mountOffset: [0, 0, 0],
      },
      actions: Object.fromEntries(roles.map(role => [role, role])),
      clips: clips.map(clip => ({ name: clip.name, duration: clip.duration })),
    },
  }
  const root = new Group()
  const player = new AnimationPlayer({
    root,
    clips,
    actions: Object.fromEntries(modelRoles.map(role => [
      role,
      {
        clip: role,
        loop: ['idle', 'aim', ...walkRoles].includes(role),
      },
    ])),
  })
  const layer = {
    scene: new Scene(),
    setEnabled() {},
    setFov() {},
  }
  const view = new WeaponViewModel({
    assets: {
      load: async () => handle,
      instantiate: () => ({
        root,
        player,
        dispose: () => player.dispose(),
      }),
    },
    layer,
    definitions: [definition],
    jumpFeedback,
    queue() {},
  })
  t.after(() => view.dispose())
  let snapshot = {
    epoch: 1,
    phase: 'Empty',
    preparation: { ticket },
    inventory: {
      weapons: [weapon],
    },
  }
  let sequence = 0
  const receive = (type, at, payload = {}) => view.receive({
    effects: [],
    events: [
      {
        epoch: 1,
        sequence: ++sequence,
        type,
        at,
        instanceId: 'gun',
        payload: { weapon, ...payload },
      },
    ],
  }, snapshot)
  const motion = at => view.motion({ presentationTime: at, fixedDelta: h }, snapshot, { viewmodelFov: 70 })
  const receivePose = pose => view.receive({ events: [], effects: [] }, snapshot, pose)
  const aim = (at, aiming, duration = 0.15, gait) => receivePose({ at, aiming, duration, gait })
  view.receive({
    events: [],
    effects: [
      { type: 'PrepareWeapon', ticket },
    ],
  }, snapshot)
  await Promise.resolve()
  await Promise.resolve()
  motion(0)
  snapshot = { ...snapshot, phase: 'Ready', preparation: null }
  receive('EquipCommitted', 0, { ticket })
  receive('EquipReady', 0)
  motion(0)
  return {
    root,
    handle,
    layer,
    player,
    view,
    receive,
    motion,
    aim,
    receivePose,
  }
}

test('muzzle flash stays scene-local when the viewmodel layer follows the world camera', async (t) => {
  const f = await fixture(t)
  const socket = new Group()
  socket.name = 'Muzzle'
  socket.position.set(0.2, -0.1, -0.8)
  f.root.add(socket)
  f.handle.manifest.sockets = { muzzle: socket.name }
  f.layer.scene.position.set(4, 10, -7)
  f.layer.scene.rotation.set(0.2, 0.8, -0.1)
  f.layer.scene.updateMatrixWorld(true)
  f.receive('ShotFired', 0.1, { aiming: false, shotSequence: 17 })
  const shots = f.motion(0.1)
  const flash = f.layer.scene.getObjectByName('Weapon muzzle flash')
  const expected = f.layer.scene.worldToLocal(socket.getWorldPosition(new Vector3()))
  assert.ok(flash.position.distanceTo(expected) < 1e-12)
  assert.equal(flash.visible, true)
  assert.deepEqual(shots.map(shot => shot.muzzle), [
    expected.toArray(),
  ])
  assert.equal(shots[0].event.at, 0.1)
  assert.equal(shots[0].event.payload.shotSequence, 17)
  assert.deepEqual(f.motion(0.13), [], 'a render frame cannot replay a shot')
  f.motion(0.15)
  assert.equal(flash.visible, false)
})

test('muzzle event samples do not depend on render-frame subdivision', async (t) => {
  const samples = []
  for (const frames of [
    [0.5],
    [0.1, 0.2, 0.3, 0.4, 0.5],
  ]) {
    const f = await fixture(t)
    const socket = new Group()
    socket.name = 'Muzzle'
    socket.position.set(0.2, -0.1, -0.8)
    f.root.add(socket)
    f.handle.manifest.sockets = { muzzle: socket.name }
    f.receive('ShotFired', 0.1, { shotSequence: 1 })
    f.receive('ShotFired', 0.3, { shotSequence: 2 })
    const shots = frames.flatMap(at => f.motion(at))
    samples.push(shots.map(({ event, muzzle }) => ({
      at: event.at,
      muzzle: muzzle.map(value => Number(value.toFixed(10))),
    })))
  }
  assert.deepEqual(samples[0], samples[1])
  assert.deepEqual(samples[0].map(shot => shot.at), [0.1, 0.3])
})

test('private ADS facts use the weapon definition transition duration', async (t) => {
  const f = await fixture(t)
  f.aim(0.1, true, 0.3)
  f.motion(0.25)
  assert.ok(Math.abs(f.player.snapshot().current.weight - 0.5) < 1e-12)
  f.motion(0.4)
  assert.equal(f.player.snapshot().current.weight, 1)
})

test('walking samples the player gait at presentation time and preserves the cycle across ADS', async (t) => {
  const f = await fixture(t, { locomotion: true })
  const gait = (at, direction, steps, aiming = false) => f.aim(at, aiming, 0.15, { direction, steps })
  gait(0.10, 'forward', 0.2)
  gait(0.20, 'forward', 0.6)
  f.motion(0.09)
  assert.equal(f.view.snapshot().action, 'idle')
  f.motion(0.15)
  const walk = f.player.snapshot().current
  assert.equal(walk.role, 'walkForward')
  assert.ok(Math.abs(walk.localTime - 0.2) < 1e-12)
  f.motion(0.18)
  assert.equal(f.player.snapshot().current.playbackId, walk.playbackId)

  gait(0.22, 'backward', 0.8)
  f.motion(0.22)
  assert.equal(f.view.snapshot().action, 'walkBackward')
  gait(0.24, 'side', 0.9)
  f.motion(0.24)
  assert.equal(f.view.snapshot().action, 'walkSide')
  gait(0.28, 'side', 1.2, true)
  f.motion(0.28)
  const aimWalk = f.player.snapshot().current
  assert.equal(aimWalk.role, 'walkAim')
  assert.equal(aimWalk.localTime, 0.6)

  f.receive('ShotFired', 0.30, { aiming: true })
  gait(0.31, null, 1.3, true)
  f.motion(0.32)
  assert.equal(f.view.snapshot().action, 'fireAds')
  f.motion(0.35)
  assert.equal(f.view.snapshot().action, 'aim')
})

test('airborne pose uses the configured amplitude, landing duration, and ADS scale', async (t) => {
  const jumpFeedback = {
    airReferenceSpeed: 8,
    airOffset: 0.05,
    airPitchRad: 0.03,
    landingMinSpeed: 3,
    landingFullSpeed: 8,
    landingOffset: 0.1,
    landingPitchRad: 0.05,
    landingDuration: 0.3,
    adsScale: 0.5,
  }
  const hip = await fixture(t, { jumpFeedback })
  const aimed = await fixture(t, { jumpFeedback })
  const gait = { direction: null, steps: 0 }
  const landing = { at: 0.65, speed: 6.6 }
  const offsets = []
  for (const [f, ads] of [
    [hip, 0],
    [aimed, 1],
  ]) {
    const pose = (at, verticalSpeed, impact = null) => f.receivePose({
      at,
      gait,
      ads,
      aiming: !!ads,
      verticalSpeed,
      landing: impact,
    })
    pose(0.1, 6.6)
    pose(0.63, -6.6)
    pose(0.65, 0, landing)
    pose(0.68, 0, landing)
    pose(1, 0, { at: 1, speed: 2.5 })
    const anchor = f.root.parent
    f.motion(0.09)
    assert.equal(anchor.position.y, 0)
    f.motion(0.1)
    const scale = ads ? jumpFeedback.adsScale : 1
    assert.ok(Math.abs(anchor.position.y + scale * jumpFeedback.airOffset * 6.6 / jumpFeedback.airReferenceSpeed) < 1e-12)
    assert.ok(Math.abs(anchor.rotation.x + scale * jumpFeedback.airPitchRad * 6.6 / jumpFeedback.airReferenceSpeed) < 1e-12)
    f.motion(0.63)
    assert.ok(anchor.position.y > 0.01, 'falling raises the viewmodel')
    f.motion(0.695)
    assert.ok(anchor.position.y < -0.01, 'impact presses the viewmodel down')
    assert.ok(anchor.rotation.x < 0)
    offsets.push(anchor.position.y)
    f.motion(0.9)
    assert.ok(anchor.position.y > 0, 'the configured duration extends the rebound')
    f.motion(0.96)
    assert.equal(anchor.position.y, 0)
    f.motion(1.05)
    assert.equal(anchor.position.y, 0, 'shallow ground contact does not cause a bounce')
  }
  assert.ok(Math.abs(offsets[1] / offsets[0] - jumpFeedback.adsScale) < 1e-12)
})

test('ADS changes interrupt a long firing tail without replaying the shot, then the next shot selects fireAds', async (t) => {
  const f = await fixture(t, { fireDuration: 1 })
  f.receive('ShotFired', 0.1, { aiming: false })
  f.aim(0.2, true)
  f.motion(0.199)
  assert.equal(f.view.snapshot().action, 'fire')
  f.motion(0.2)
  assert.equal(f.view.snapshot().action, 'aim')
  f.motion(0.35)
  assert.equal(f.player.snapshot().current.weight, 1, 'ADS does not wait for the one-second firing tail')
  assert.equal(f.view.snapshot().lastShot.at, 0.1, 'the visual interruption cannot create a shot')
  f.receive('ShotFired', 0.4, { aiming: true })
  f.motion(0.4)
  assert.equal(f.view.snapshot().action, 'fireAds')
  f.aim(0.5, false)
  f.motion(0.65)
  assert.equal(f.view.snapshot().action, 'idle')
  assert.equal(f.player.snapshot().current.weight, 1)
  assert.equal(f.view.snapshot().lastShot.at, 0.4)
})

for (const ads of [false, true]) {
  test(`${ads ? 'ADS' : 'hip'} fire completion consumes the remaining interval equally at 30/60/144 FPS and during catch-up`, async (t) => {
    for (const fps of [30, 60, 144, null]) {
      const f = await fixture(t)
      f.aim(0, ads)
      f.receive('ShotFired', 0.1, { aiming: ads })
      f.receive('ShotFired', 0.18, { aiming: ads })
      if (fps) {
        for (let frame = 1; frame / fps < 0.3; frame++) f.motion(frame / fps)
      }
      f.motion(0.3)
      const state = f.player.snapshot()
      assert.equal(state.current.role, ads ? 'aim' : 'idle')
      assert.ok(Math.abs(state.current.localTime - 0.08) < 1e-12, `incorrect remainder at ${fps ?? 'single-frame catch-up'}`)
      assert.equal(state.current.weight, 1)
      assert.equal(state.layers.length, 1)
      assert.ok(Math.abs(f.root.position.x - 0.08) < 1e-12)
      f.motion(0.3)
      assert.deepEqual(f.player.snapshot(), state, 'sampling the same presentation time must not replay completion')
    }
  })
}

test('draw, holster, reload and inspect wait for gameplay facts even when their clips have finished', async (t) => {
  for (const [role, type, payload, endType] of [
    [
      'draw',
      'DrawStarted',
      { readyTick: 15 },
      'EquipReady',
    ],
    [
      'holster',
      'SwitchStarted',
      { commitTick: 15 },
      'EquipReady',
    ],
    [
      'reloadTactical',
      'ReloadStarted',
      { branch: 'tactical', endTick: 15 },
      'ReloadFinished',
    ],
    [
      'reloadEmpty',
      'ReloadStarted',
      { branch: 'empty', endTick: 15 },
      'ReloadFinished',
    ],
    [
      'inspect',
      'InspectStarted',
      { endTick: 15 },
      'InspectFinished',
    ],
  ]) {
    const f = await fixture(t)
    f.receive(type, 0.1, payload)
    f.motion(1.2)
    assert.equal(f.view.snapshot().action, role, `${role} must not manufacture a gameplay completion`)
    assert.equal(f.player.snapshot().current.finished, true)
    f.receive(endType, 1.3)
    f.motion(1.3)
    assert.equal(f.view.snapshot().action, 'idle')
    assert.equal(f.player.snapshot().current.localTime, 0)
  }
})

test('fixed ADS changes and intervening shots produce identical poses at shared presentation times across frame subdivisions', async (t) => {
  const checkpoints = [
    0.119,
    0.12,
    0.15,
    0.21,
    0.26,
    0.31,
    0.37,
    0.43,
    0.53,
    0.7,
  ]
  let expected
  for (const fps of [30, 60, 144, 10, null]) {
    const f = await fixture(t)
    for (const [at, aiming] of [
      [0.12, true],
      [0.24, false],
      [0.32, true],
      [0.5, false],
    ]) f.aim(at, aiming)
    for (const [at, aiming] of [
      [0.18, true],
      [0.29, false],
      [0.36, true],
    ]) f.receive('ShotFired', at, { aiming })
    const frames = new Set(checkpoints)
    if (fps) {
      for (let frame = 1; frame / fps < 0.7; frame++) frames.add(frame / fps)
    }
    const samples = []
    for (const at of [...frames].sort((a, b) => a - b)) {
      f.motion(at)
      if (checkpoints.includes(at)) {
        const state = f.player.snapshot()
        // Tolerate accumulation noise, while comparing transition IDs, weights and sampled pose.
        const stable = value => JSON.parse(JSON.stringify(value, (_key, entry) => typeof entry === 'number'
          ? Number(entry.toFixed(10))
          : entry))
        samples.push(stable({
          at,
          current: state.current,
          layers: state.layers,
          x: f.root.position.x,
        }))
      }
    }
    assert.equal(samples[0].current.role, 'idle', 'a future ADS input must not alter the earlier pose')
    assert.equal(samples[1].current.role, 'aim')
    assert.equal(samples[1].current.localTime, 0)
    assert.equal(samples[2].current.weight, 0.2, 'ADS fade starts at the fixed input timestamp, not its first rendered frame')
    assert.equal(samples[3].current.role, 'fireAds')
    assert.equal(samples[5].current.role, 'fire')
    assert.equal(samples[6].current.role, 'fireAds')
    assert.equal(samples[7].current.role, 'aim', 'fire completion uses the ADS state at its own natural boundary')
    assert.equal(samples.at(-1).current.role, 'idle')
    assert.equal(samples.at(-1).current.localTime, 0.2)
    if (expected)
      assert.deepEqual(samples, expected, `different historical pose at ${fps ?? 'checkpoint-only catch-up'} FPS`)
    expected ??= samples
  }
})
