import assert from 'node:assert/strict'
import test from 'node:test'
import { AnimationClip, Group, NumberKeyframeTrack, PerspectiveCamera, Scene } from 'three/webgpu'
import { inputBindings } from '../src/configs/input-bindings.js'
import { AnimationPlayer } from '../src/engine/runtime/function/animation/animation-player.js'
import { AimState } from '../src/game/player/aim-state.js'
import { createAimProfile } from '../src/game/weapons/aim-profile.js'
import { classicDefinition } from '../src/game/weapons/definitions/classic.js'
import { phantomDefinition } from '../src/game/weapons/definitions/phantom.js'
import { PlayerWeapons } from '../src/game/weapons/player-weapons.js'
import { createWeaponDefinition } from '../src/game/weapons/weapon-definition.js'
import { setupInput } from './input-fixture.mjs'

const h = 0.1
const roles = [
  'idle',
  'draw',
  'holster',
  'fire',
  'reloadTactical',
  'reloadEmpty',
  'inspect',
]

function fakeAssets() {
  const requests = []
  const instances = []
  const live = new Set()
  const skinSwaps = []
  let maximum = 0
  return {
    audioScope: 'test-weapons',
    requests,
    instances,
    live,
    skinSwaps,
    get maximum() { return maximum },
    load(request) {
      return new Promise((resolve, reject) => requests.push({
        request,
        resolve,
        reject,
        settled: false,
      }))
    },
    async resolve(weaponId) {
      const request = requests.findLast(entry => !entry.settled && entry.request.weaponId === weaponId)
      assert.ok(request, `expected an unresolved ${weaponId} load`)
      request.settled = true
      const handle = {
        ...request.request,
        manifest: {
          actions: Object.fromEntries(roles.map(role => [role, role])),
          clips: roles.map(name => ({ name, duration: 1, loop: name === 'idle' })),
          view: {
            mountOffset: [0.1, -0.3, -0.5],
            verticalFov: 70,
          },
          sockets: { muzzle: 'muzzle' },
        },
      }
      request.resolve(handle)
      await Promise.resolve()
      await Promise.resolve()
      return handle
    },
    async reject(weaponId) {
      const request = requests.findLast(entry => !entry.settled && entry.request.weaponId === weaponId)
      assert.ok(request)
      request.settled = true
      request.reject(new Error(`${weaponId} load failed`))
      await Promise.resolve()
      await Promise.resolve()
    },
    instantiate(handle) {
      const root = new Group()
      root.name = 'visual'
      const muzzle = new Group()
      muzzle.name = 'muzzle'
      root.add(muzzle)
      const clips = roles.map(role => new AnimationClip(role, 1, [
        new NumberKeyframeTrack('muzzle.position[x]', [0, 1], [0, 0.05]),
      ]))
      const player = new AnimationPlayer({
        root,
        clips,
        actions: Object.fromEntries(roles.map(role => [
          role,
          { clip: role, loop: role === 'idle' },
        ])),
      })
      const visual = {
        root,
        player,
        weaponId: handle.weaponId,
        skinId: handle.skinId,
        disposed: false,
        dispose() {
          if (this.disposed)
            return
          this.disposed = true
          player.dispose()
          root.removeFromParent()
          live.delete(this)
        },
      }
      instances.push(visual)
      live.add(visual)
      maximum = Math.max(maximum, live.size)
      return visual
    },
    applySkin(visual, handle) {
      assert.equal(visual.disposed, false)
      assert.equal(visual.weaponId, handle.weaponId)
      visual.skinId = handle.skinId
      skinSwaps.push({ visual, handle })
    },
  }
}

function setup(t, { thirdWeapon = false } = {}) {
  const assets = fakeAssets()
  const aim = new AimState({ seed: 123, offsetSmoothing: 0 })
  aim.reset({
    feet: [0, 0, 0],
    yaw: 0,
    pitch: 0,
    at: 0,
  })
  const layer = {
    scene: new Scene(),
    camera: new PerspectiveCamera(70),
    enabled: false,
    setEnabled(value) { this.enabled = value },
    setFov(value) { this.camera.fov = value },
  }
  const definitions = [classicDefinition, phantomDefinition].map(definition => createWeaponDefinition({
    ...definition,
    ...createAimProfile(),
    fire: { ...definition.fire, interval: 0.2 },
    equip: {
      holster: 0.1,
      draw: definition.id === 'classic'
        ? 0.2
        : 0.3,
    },
  }))
  const loadout = [
    {
      id: 'primary',
      weapon: { instanceId: 'rifle', definitionId: 'phantom' },
    },
    {
      id: 'secondary',
      weapon: { instanceId: 'pistol', definitionId: 'classic' },
    },
  ]
  if (thirdWeapon) {
    loadout.push({
      id: 'reserve',
      weapon: { instanceId: 'spare', definitionId: 'classic' },
    })
  }
  const weapons = new PlayerWeapons({
    assets,
    layer,
    aim,
    definitions,
    loadout,
    initialSlot: 'secondary',
    fixedDelta: h,
    world: {
      boxes: [
        {
          name: 'target',
          min: [-1, 0, -11],
          max: [1, 3, -10],
        },
      ],
    },
  })
  const controls = setupInput({ bindings: inputBindings })
  controls.input.setEnabled(true)
  controls.click()
  t.after(() => {
    weapons.dispose()
    controls.input.dispose()
  })
  let fixedTick = 0
  return {
    weapons,
    aim,
    assets,
    layer,
    ...controls,
    get tick() { return fixedTick },
    fixed(...commands) {
      for (const command of commands) weapons.queue(command)
      fixedTick++
      return weapons.fixed({ fixedTick, fixedElapsed: fixedTick * h, fixedDelta: h }, {
        feet: [0, 0, 0],
        verticalOffset: 1.62,
        stepDeltaY: 0,
        moving: false,
        crouched: false,
      })
    },
    motion(presentationTime = Math.max(0, (fixedTick - 1) * h)) {
      weapons.motion({
        fixedTick,
        fixedElapsed: fixedTick * h,
        fixedDelta: h,
        presentationTime,
      })
      const view = weapons.snapshot().view
      assert.ok(view.instances <= 2)
      assert.ok(view.visibleInstances <= 1)
      assert.equal(view.instances, assets.live.size)
    },
    advance(count) {
      for (let index = 0; index < count; index++) {
        this.fixed()
        this.motion()
      }
    },
    async ready() {
      this.fixed()
      await assets.resolve('classic')
      this.motion(0)
      this.fixed()
      this.motion()
      for (let count = 0; weapons.snapshot().phase !== 'Ready' && count < 10; count++) this.advance(1)
      assert.equal(weapons.snapshot().activeId, 'pistol')
      assert.equal(weapons.snapshot().phase, 'Ready')
      this.motion(fixedTick * h)
      assert.equal(weapons.snapshot().view.renderActiveId, 'pistol')
    },
  }
}

test('initial loading warms asynchronously, instantiates only in motion and equips on the next fixed step', async (t) => {
  const f = setup(t)
  f.fixed()
  assert.equal(f.assets.requests.length, 1)
  assert.equal(f.weapons.snapshot().phase, 'Empty')
  f.motion(0)
  assert.equal(f.assets.instances.length, 0)
  await f.assets.resolve('classic')
  assert.equal(f.assets.instances.length, 0, 'promise completion cannot create a visual')
  assert.equal(f.weapons.snapshot().activeId, null)
  f.motion(0)
  assert.equal(f.assets.instances.length, 1)
  assert.equal(f.weapons.snapshot().activeId, null, 'motion queues readiness rather than committing gameplay')
  f.fixed()
  assert.equal(f.weapons.snapshot().activeId, 'pistol')
  assert.equal(f.weapons.snapshot().phase, 'Drawing')
  f.motion(h)
  assert.equal(f.weapons.snapshot().view.renderActiveId, null, 'presentation waits for the equip event time')
  f.motion(2 * h)
  assert.equal(f.weapons.snapshot().view.renderActiveId, 'pistol')
  assert.equal(f.weapons.snapshot().view.action, 'draw')
  f.advance(2)
  assert.equal(f.weapons.snapshot().phase, 'Ready')
  assert.equal(f.assets.requests.length, 1, 'initial readiness does not wait for every loadout asset')
})

test('Editor handoff retains logically committed B even while the delayed visual still shows A', async (t) => {
  const f = setup(t)
  await f.ready()
  f.fixed({ type: 'select', instanceId: 'rifle' })
  await f.assets.resolve('phantom')
  f.motion()
  f.fixed()
  f.motion()
  f.fixed()
  assert.equal(f.weapons.snapshot().activeId, 'rifle')
  assert.equal(f.weapons.snapshot().view.renderActiveId, 'pistol')
  assert.equal(f.weapons.snapshot().view.stagedReserved, true)
  const retained = f.assets.instances.find(visual => visual.weaponId === 'phantom')
  f.weapons.suspend()
  const epoch = f.weapons.snapshot().epoch
  assert.equal(f.weapons.snapshot().activeId, 'rifle')
  assert.equal(f.weapons.snapshot().view.instances, 1)
  assert.equal(f.weapons.snapshot().view.visibleInstances, 0)
  assert.equal(retained.disposed, false)
  assert.equal(f.assets.instances.find(visual => visual.weaponId === 'classic').disposed, true)
  f.weapons.resume()
  f.fixed()
  await f.assets.resolve('phantom')
  f.motion()
  assert.equal(f.assets.instances.length, 2, 'resume rebinds the retained visual instead of cloning a third one')
  const resumed = f.fixed()
  assert.equal(resumed.events.filter(event => event.type === 'EquipCommitted').length, 0)
  assert.equal(resumed.events.filter(event => event.type === 'DrawStarted' && event.payload.reason === 'resume').length, 1)
  f.motion(f.tick * h)
  assert.equal(f.weapons.snapshot().view.renderActiveId, 'rifle')
  assert.equal(f.weapons.snapshot().view.visibleInstances, 1)
  assert.equal(f.weapons.snapshot().view.action, 'draw')
  assert.equal(f.weapons.snapshot().recentEvents.filter(event => event.epoch === epoch && event.type === 'EquipCommitted').length, 0)
})

test('a third target waits for the reserved visual slot and never creates more than two instances', async (t) => {
  const f = setup(t, { thirdWeapon: true })
  await f.ready()
  f.fixed({ type: 'select', instanceId: 'rifle' })
  await f.assets.resolve('phantom')
  f.motion()
  f.fixed()
  f.fixed({ type: 'select', instanceId: 'spare' })
  await f.assets.resolve('classic')
  f.motion((f.tick - 1) * h)
  assert.equal(f.weapons.snapshot().view.renderActiveId, 'pistol')
  assert.equal(f.assets.instances.length, 2, 'reserved B prevents cloning C before A is released')
  f.fixed()
  f.motion()
  assert.equal(f.weapons.snapshot().view.renderActiveId, 'rifle')
  assert.equal(f.assets.instances.length, 3)
  assert.equal(f.assets.maximum, 2)
  for (let count = 0; f.weapons.snapshot().activeId !== 'spare' && count < 10; count++) f.advance(1)
  f.advance(3)
  assert.equal(f.weapons.snapshot().activeId, 'spare')
  assert.equal(f.weapons.snapshot().view.renderActiveId, 'spare')
  assert.equal(f.weapons.snapshot().view.visibleInstances, 1)
  assert.equal(f.weapons.snapshot().view.maximumInstances, 2)
  assert.equal(f.assets.maximum, 2)
})

test('reset invalidates late loads and old presentation facts without resurrecting a discarded gun', async (t) => {
  const f = setup(t)
  await f.ready()
  f.fixed({ type: 'select', instanceId: 'rifle' })
  const epoch = f.weapons.snapshot().epoch
  f.weapons.setPaused(true)
  f.weapons.reset()
  assert.notEqual(f.weapons.snapshot().epoch, epoch)
  assert.equal(f.weapons.snapshot().activeId, null)
  assert.equal(f.assets.live.size, 0)
  await f.assets.resolve('phantom')
  f.motion()
  assert.equal(f.assets.instances.length, 1, 'old epoch completion never instantiates B')
  f.weapons.setPaused(false)
  f.fixed()
  await f.assets.resolve('classic')
  f.motion()
  const prepared = f.fixed()
  assert.equal(prepared.events.filter(event => event.type === 'EquipCommitted').length, 1)
  f.motion(f.tick * h)
  assert.equal(f.weapons.snapshot().activeId, 'pistol')
  assert.equal(f.weapons.snapshot().view.renderActiveId, 'pistol')
  assert.equal(f.assets.instances.length, 2)
  assert.ok(f.assets.instances.every(visual => visual.weaponId === 'classic'))
})

test('a visual may prepare during pause but cannot commit equipment until fixed simulation resumes', async (t) => {
  const f = setup(t)
  await f.ready()
  f.fixed({ type: 'select', instanceId: 'rifle' })
  f.weapons.setPaused(true)
  await f.assets.resolve('phantom')
  f.motion()
  assert.equal(f.weapons.snapshot().activeId, 'pistol')
  assert.equal(f.weapons.snapshot().phase, 'Ready')
  assert.equal(f.weapons.snapshot().canAct, false)
  assert.equal(f.weapons.snapshot().view.stagedId, 'rifle')
  f.mouse('mousedown', 0)
  f.weapons.collectInput(f.input, true)
  assert.equal(f.weapons.snapshot().lastShot, null)
  f.weapons.setPaused(false)
  f.fixed()
  assert.equal(f.weapons.snapshot().phase, 'Holstering')
  assert.equal(f.weapons.snapshot().lastShot, null)
})

test('ordered real input retains the latest selection and produces an authoritative shot only once', async (t) => {
  const f = setup(t)
  await f.ready()
  f.key('keydown', 'Digit1')
  f.key('keydown', 'Digit2')
  f.weapons.collectInput(f.input)
  f.fixed()
  assert.equal(f.weapons.snapshot().activeId, 'pistol')
  assert.equal(f.weapons.snapshot().pendingTarget, null)
  assert.equal(f.assets.requests.length, 1)
  f.mouse('mousedown', 0)
  f.weapons.collectInput(f.input)
  const fired = f.fixed()
  assert.equal(fired.events.filter(event => event.type === 'ShotFired').length, 1)
  const shot = f.weapons.snapshot().lastShot
  assert.deepEqual(shot.payload.eyeOrigin, [0, 1.62, 0])
  assert.deepEqual(shot.payload.aimDirection, [0, 0, -1])
  assert.equal(shot.payload.impact.hit, 'target')
  assert.equal(shot.payload.impact.distance, 10)
  f.weapons.collectInput(f.input)
  assert.equal(f.fixed().events.filter(event => event.type === 'ShotFired').length, 0)
  assert.equal(f.weapons.snapshot().inventory.weapons.find(weapon => weapon.instanceId === 'pistol').magazine, 11)
})

for (const inputTicks of [false, true]) {
  test(`paused selection preserves ordered wheel/slot/Q intent with ${inputTicks ? 'zero-scale input ticks' : 'no running input frames'}`, async (t) => {
    const f = setup(t, { thirdWeapon: true })
    await f.ready()
    f.fixed({ type: 'select', instanceId: 'rifle' })
    await f.assets.resolve('phantom')
    f.motion()
    f.advance(6)
    assert.equal(f.weapons.snapshot().activeId, 'rifle')
    assert.equal(f.weapons.snapshot().previousId, 'pistol')
    f.weapons.setPaused(true)
    f.input.clear()
    const before = f.weapons.snapshot()
    const loads = f.assets.requests.length
    f.wheel(120) // rifle -> pistol
    f.key('keydown', 'Digit1') // -> rifle
    if (inputTicks)
      f.weapons.collectInput(f.input, true)
    f.key('keydown', 'KeyQ') // previous committed gun -> pistol
    f.wheel(120) // -> spare; keeping only the final cycle command would incorrectly choose pistol
    f.key('keydown', 'KeyR')
    f.key('keydown', 'KeyT')
    f.mouse('mousedown', 0)
    f.mouse('mousedown', 2)
    if (inputTicks)
      f.weapons.collectInput(f.input, true)
    assert.deepEqual(f.weapons.snapshot(), before, 'paused input cannot mutate equipment facts or issue a preparation')
    assert.equal(f.assets.requests.length, loads)
    f.weapons.collectInput(f.input, false)
    assert.equal(f.weapons.snapshot().pendingTarget, null, 'resume queues the latest target for fixed-step validation')
    assert.equal(f.input.isDown('fire'), false)
    assert.equal(f.input.isDown('aim'), false)
    const batch = f.fixed()
    assert.equal(f.weapons.snapshot().pendingTarget, 'spare')
    assert.deepEqual(batch.effects.filter(effect => effect.type === 'PrepareWeapon').map(effect => effect.ticket.instanceId), ['spare'])
    assert.equal(batch.events.some(event => ['ShotFired', 'ReloadStarted', 'InspectStarted'].includes(event.type)), false)
    assert.equal(f.weapons.snapshot().lastShot, null)
    assert.equal(f.aim.sample(f.tick * h).aiming, false)
  })
}

test('failed loads keep the current gun usable and disposal ignores any later completion', async (t) => {
  const f = setup(t)
  await f.ready()
  f.fixed({ type: 'select', instanceId: 'rifle' })
  await f.assets.reject('phantom')
  f.fixed()
  assert.equal(f.weapons.snapshot().activeId, 'pistol')
  assert.equal(f.weapons.snapshot().canFire, true)
  assert.equal(f.weapons.snapshot().view.renderActiveId, 'pistol')
  assert.match(f.weapons.snapshot().view.error, /phantom load failed/)
  f.fixed({ type: 'select', instanceId: 'pistol' })
  assert.equal(f.weapons.snapshot().pendingTarget, null)
  assert.equal(f.weapons.snapshot().view.error, null, 'cancelling a failed target restores the current weapon readout')
  f.fixed({ type: 'select', instanceId: 'rifle' })
  await f.assets.reject('phantom')
  assert.match(f.weapons.snapshot().view.error, /phantom load failed/)
  f.weapons.reset()
  assert.equal(f.weapons.snapshot().view.error, null, 'reset clears obsolete load failures')
  f.fixed({ type: 'select', instanceId: 'rifle' })
  f.weapons.dispose()
  assert.equal(f.assets.live.size, 0)
  assert.equal(f.layer.scene.children.length, 0)
  await f.assets.resolve('phantom')
  f.motion()
  assert.equal(f.assets.instances.length, 1)
  assert.equal(f.assets.live.size, 0)
  assert.equal(f.layer.scene.children.length, 0)
})

test('changing skin during inspect swaps materials only at P without restarting animation or changing ammo', async (t) => {
  const f = setup(t)
  await f.ready()
  f.fixed({ type: 'inspect' })
  f.motion(f.tick * h)
  const visual = f.assets.instances[0]
  const playbackId = visual.player.snapshot().current.playbackId
  const before = f.weapons.snapshot()
  f.fixed({ type: 'setSkin', instanceId: 'pistol', skinId: 'sakura' })
  await f.assets.resolve('classic')
  assert.equal(visual.skinId, 'smite', 'promise completion never applies materials')
  f.motion()
  assert.equal(visual.skinId, 'smite', 'motion only queues readiness until fixed acceptance')
  const batch = f.fixed()
  const change = batch.events.find(event => event.type === 'SkinChanged')
  assert.ok(change)
  assert.equal(f.weapons.snapshot().inventory.weapons[1].skinId, 'sakura')
  f.motion(change.at - 0.01)
  assert.equal(visual.skinId, 'smite', 'appearance cannot lead its committed presentation fact')
  f.motion(change.at)
  f.motion(change.at)
  assert.equal(visual.skinId, 'sakura')
  assert.equal(visual.player.snapshot().current.playbackId, playbackId)
  assert.deepEqual(f.weapons.snapshot().action, before.action)
  assert.deepEqual({
    ...f.weapons.snapshot().inventory.weapons[1],
    skinId: 'smite',
  }, before.inventory.weapons[1])
  assert.equal(f.assets.skinSwaps.length, 1)
  assert.equal(f.assets.instances.length, 1)
  assert.equal(f.weapons.snapshot().view.skinId, 'sakura')
})

test('late skin completions, failed requests and choosing the original skin cannot overwrite the newest intent', async (t) => {
  const f = setup(t)
  await f.ready()
  f.fixed({ type: 'setSkin', instanceId: 'pistol', skinId: 'slow' })
  f.fixed({ type: 'setSkin', instanceId: 'pistol', skinId: 'sakura' })
  await f.assets.resolve('classic') // latest sakura first
  f.motion()
  f.fixed()
  f.motion(f.tick * h)
  await f.assets.resolve('classic') // abandoned slow last
  f.motion(f.tick * h)
  assert.equal(f.assets.instances[0].skinId, 'sakura')
  assert.equal(f.assets.skinSwaps.length, 1)
  f.fixed({ type: 'setSkin', instanceId: 'pistol', skinId: 'missing' })
  await f.assets.reject('classic')
  f.fixed()
  f.motion(f.tick * h)
  assert.equal(f.assets.instances[0].skinId, 'sakura')
  assert.match(f.weapons.snapshot().view.skinError, /load failed/)
  assert.equal(f.weapons.snapshot().canFire, true)
  f.fixed({ type: 'setSkin', instanceId: 'pistol', skinId: 'slow' })
  f.fixed({ type: 'setSkin', instanceId: 'pistol', skinId: 'sakura' })
  await f.assets.resolve('classic')
  f.motion(f.tick * h)
  assert.equal(f.assets.instances[0].skinId, 'sakura')
  assert.equal(f.weapons.snapshot().view.skinError, null)
})

test('accepted skin handles survive a newer request until their historical presentation commits', async (t) => {
  const f = setup(t)
  await f.ready()
  f.fixed({ type: 'setSkin', instanceId: 'pistol', skinId: 'sakura' })
  await f.assets.resolve('classic')
  f.motion()
  const first = f.fixed().events.find(event => event.type === 'SkinChanged')
  f.fixed({ type: 'setSkin', instanceId: 'pistol', skinId: 'smite' })
  await f.assets.resolve('classic')
  f.motion(first.at)
  assert.equal(f.assets.instances[0].skinId, 'sakura')
  const second = f.fixed().events.find(event => event.type === 'SkinChanged')
  f.motion(second.at)
  assert.equal(f.assets.instances[0].skinId, 'smite')
  assert.equal(f.assets.instances.length, 1)
})

test('Editor return reapplies a committed skin even if its delayed visual had not changed before suspend', async (t) => {
  const f = setup(t)
  await f.ready()
  f.fixed({ type: 'setSkin', instanceId: 'pistol', skinId: 'sakura' })
  await f.assets.resolve('classic')
  f.motion()
  f.fixed()
  assert.equal(f.assets.instances[0].skinId, 'smite')
  f.weapons.suspend()
  f.weapons.resume()
  f.fixed()
  await f.assets.resolve('classic')
  f.motion()
  f.fixed()
  f.motion(f.tick * h)
  assert.equal(f.assets.instances.length, 1)
  assert.equal(f.assets.instances[0].skinId, 'sakura')
  assert.equal(f.weapons.snapshot().view.skinId, 'sakura')
})

test('real K input cycles skins in order and discards paused skin commands', async (t) => {
  const f = setup(t)
  await f.ready()
  for (let index = 0; index < 2; index++) {
    f.key('keydown', 'KeyK')
    f.key('keyup', 'KeyK')
  }
  f.weapons.collectInput(f.input)
  f.fixed()
  assert.equal(f.assets.requests.length, 1, 'two cycles returning to the original do not load an obsolete skin')
  f.key('keydown', 'KeyK')
  f.key('keyup', 'KeyK')
  f.weapons.collectInput(f.input)
  f.fixed()
  assert.equal(f.assets.requests.at(-1).request.skinId, 'sakura')
  await f.assets.resolve('classic')
  f.motion()
  f.fixed()
  f.motion(f.tick * h)
  f.weapons.setPaused(true)
  f.key('keydown', 'KeyK')
  f.key('keyup', 'KeyK')
  f.weapons.collectInput(f.input, true)
  f.weapons.collectInput(f.input, false)
  f.fixed()
  assert.equal(f.weapons.snapshot().inventory.weapons[1].skinId, 'sakura')
  assert.equal(f.assets.requests.length, 2)
})

test('skin requests during a switch wait for readiness without replacing the reserved target visual', async (t) => {
  const f = setup(t)
  await f.ready()
  f.fixed({ type: 'select', instanceId: 'rifle' })
  await f.assets.resolve('phantom')
  f.motion()
  f.fixed()
  const target = f.assets.instances[1]
  const count = f.assets.requests.length
  f.fixed({ type: 'setSkin', instanceId: 'rifle', skinId: 'alternate' })
  f.motion()
  assert.equal(target.disposed, false)
  assert.equal(f.assets.requests.length, count)
  while (f.weapons.snapshot().phase !== 'Ready') f.advance(1)
  assert.equal(f.assets.requests.at(-1).request.skinId, 'alternate')
  await f.assets.resolve('phantom')
  f.motion()
  f.fixed()
  f.motion(f.tick * h)
  assert.equal(target.skinId, 'alternate')
  assert.equal(target.disposed, false)
  assert.equal(f.assets.instances.length, 2)
})

test('K retries the failed next skin instead of silently cycling back to the old skin', async (t) => {
  const f = setup(t)
  await f.ready()
  f.fixed({ type: 'cycleSkin', instanceId: 'pistol' })
  await f.assets.reject('classic')
  f.fixed()
  assert.equal(f.weapons.snapshot().inventory.weapons[1].skinId, 'smite')
  f.key('keydown', 'KeyK')
  f.key('keyup', 'KeyK')
  f.weapons.collectInput(f.input)
  f.fixed()
  assert.equal(f.assets.requests.at(-1).request.skinId, 'sakura')
  await f.assets.resolve('classic')
  f.motion()
  f.fixed()
  f.motion(f.tick * h)
  assert.equal(f.assets.instances[0].skinId, 'sakura')
  assert.equal(f.weapons.snapshot().view.skinError, null)
})

test('a failed resume material rebind keeps the hidden retained visual alive for an explicit retry', async (t) => {
  const f = setup(t)
  await f.ready()
  const retained = f.assets.instances[0]
  const applySkin = f.assets.applySkin
  f.assets.applySkin = () => {
    throw new Error('rebind failed')
  }
  f.weapons.suspend()
  f.weapons.resume()
  f.fixed()
  await f.assets.resolve('classic')
  f.motion()
  f.fixed()
  assert.equal(f.weapons.snapshot().phase, 'Suspended')
  assert.equal(retained.disposed, false)
  assert.equal(f.weapons.snapshot().view.instances, 1)
  f.assets.applySkin = applySkin
  f.fixed({ type: 'select', instanceId: 'pistol' })
  await f.assets.resolve('classic')
  f.motion()
  f.fixed()
  f.motion(f.tick * h)
  assert.equal(f.assets.instances.length, 1)
  assert.equal(f.weapons.snapshot().view.visibleInstances, 1)
  assert.equal(f.weapons.snapshot().view.error, null)
})

test('repeated reset during a prepared switch leaves no retired mixer bindings or attached visual trees', async (t) => {
  const f = setup(t)
  for (let index = 0; index < 20; index++) {
    await f.ready()
    f.fixed({ type: 'select', instanceId: 'rifle' })
    await f.assets.resolve('phantom')
    f.motion()
    f.fixed()
    f.weapons.reset()
    assert.equal(f.assets.live.size, 0)
    assert.equal(f.weapons.snapshot().view.instances, 0)
    assert.equal(f.layer.enabled, false)
    for (const visual of f.assets.instances) {
      assert.equal(visual.disposed, true)
      assert.equal(visual.player.snapshot().stats.actions, 0)
      assert.equal(visual.player.snapshot().stats.bindings, 0)
      assert.equal(visual.root.parent, null)
    }
  }
  f.weapons.dispose()
  assert.equal(f.layer.scene.children.length, 0)
  assert.ok(f.assets.maximum <= 2)
})

test('audio prewarming follows held loadout definitions, not every available catalog definition', () => {
  const assets = fakeAssets()
  const preloaded = []
  assets.preloadAudio = async profile => preloaded.push(profile)
  const weapons = new PlayerWeapons({
    assets,
    aim: new AimState(),
    audio: {
      invalidate() {},
      reportOnce() { assert.fail('prewarming should not fail') },
    },
    layer: {
      scene: new Scene(),
      setEnabled() {},
    },
    definitions: [classicDefinition, phantomDefinition],
    loadout: [
      {
        id: 'secondary',
        weapon: { instanceId: 'pistol', definitionId: 'classic' },
      },
    ],
    initialSlot: 'secondary',
  })
  assert.equal(preloaded.length, 1)
  assert.ok(Object.keys(preloaded[0].cues).every(id => id.startsWith('classic_')))
  weapons.dispose()
})
