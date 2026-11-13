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

async function fixture(t, { fireDuration = 0.04 } = {}) {
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
  const clips = roles.map((role) => {
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
    actions: Object.fromEntries(roles.map(role => [
      role,
      {
        clip: role,
        loop: ['idle', 'aim'].includes(role),
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
  const aim = (at, aiming, duration = 0.15) => view.receive({ events: [], effects: [] }, snapshot, { at, aiming, duration })
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
  f.receive('ShotFired', 0.1, { aiming: false })
  f.motion(0.1)
  const flash = f.layer.scene.getObjectByName('Weapon muzzle flash')
  const expected = f.layer.scene.worldToLocal(socket.getWorldPosition(new Vector3()))
  assert.ok(flash.position.distanceTo(expected) < 1e-12)
  assert.equal(flash.visible, true)
})

test('private ADS facts use the weapon definition transition duration', async (t) => {
  const f = await fixture(t)
  f.aim(0.1, true, 0.3)
  f.motion(0.25)
  assert.ok(Math.abs(f.player.snapshot().current.weight - 0.5) < 1e-12)
  f.motion(0.4)
  assert.equal(f.player.snapshot().current.weight, 1)
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
