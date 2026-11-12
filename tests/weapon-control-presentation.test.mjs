import assert from 'node:assert/strict'
import test from 'node:test'
import { AnimationClip, NumberKeyframeTrack, Scene, VectorKeyframeTrack } from 'three/webgpu'
import { AnimationPlayer } from '../src/engine/runtime/function/animation/animation-player.js'
import { EquipmentController } from '../src/game/weapons/equipment-controller.js'
import { WeaponViewModel } from '../src/game/weapons/weapon-viewmodel.js'
import { controlFixture, controlRig, visibleIndicators } from './weapon-control-fixture.mjs'

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

async function fixture(t, id) {
  const data = await controlFixture(id)
  const count = data.runtimeControls.ammoDisplay.tracks.length
  // Deliberately synthetic gameplay: this tests transport/ownership, not missing source-pack metadata.
  const definition = {
    id,
    capacity: count + 2,
    initialReserve: 30,
    fire: { mode: 'semi', interval: h },
    equip: { draw: 0, holster: 0 },
    reload: {
      tactical: { feed: 0.2, duration: 0.5 },
      empty: { feed: 0.2, duration: 0.5 },
    },
    inspectDuration: 0.3,
    capabilities: { ads: false },
    assets: { modelId: id, assetVersion: 'fixture', defaultSkinId: 'existing' },
  }
  const controller = new EquipmentController({
    definitions: [definition],
    loadout: [
      {
        id: 'slot',
        weapon: {
          instanceId: 'gun',
          definitionId: id,
          magazine: 3,
          reserve: 30,
        },
      },
    ],
    fixedDelta: h,
  })
  const rig = controlRig(data)
  const mainClips = roles.map(role => new AnimationClip(role, 1, [
    new NumberKeyframeTrack('.position[x]', [0, 1], [0, 1]),
    ...data.runtimeControls.ammoDisplay.tracks.map(name => new VectorKeyframeTrack(name, [0, 1], [1, 1, 1, 1, 1, 1])),
    new VectorKeyframeTrack('righthand.scale', [0, 1], [2, 3, 4, 2, 3, 4]),
  ]))
  const actions = Object.fromEntries(roles.map(role => [
    role,
    { clip: role, loop: role === 'idle' },
  ]))
  const player = new AnimationPlayer({
    root: rig.root,
    clips: [
      ...rig.clips,
      ...mainClips,
    ],
    actions,
    controls: data.runtimeControls,
  })
  const handle = {
    manifest: {
      view: {
        mountOffset: [0, 0, 0],
      },
      actions: Object.fromEntries(roles.map(role => [role, role])),
      clips: mainClips.map(clip => ({ name: clip.name, duration: clip.duration })),
      runtimeControls: data.runtimeControls,
      ammoDisplay: data.ammoDisplay,
    },
  }
  const view = new WeaponViewModel({
    assets: {
      async load() { return handle },
      instantiate: () => ({
        root: rig.root,
        player,
        dispose: () => player.dispose(),
      }),
    },
    layer: {
      scene: new Scene(),
      setEnabled() {},
      setFov() {},
    },
    queue: command => controller.queue(command),
    definitions: [definition],
  })
  t.after(() => {
    view.dispose()
    controller.dispose()
  })
  let tick = 0
  const receive = (batch) => {
    const snapshot = controller.snapshot()
    // Same committed-weapon enrichment used by PlayerWeapons.fixed.
    const events = batch.events.map(event => ({
      ...event,
      payload: {
        ...event.payload,
        weapon: snapshot.inventory.weapons.find(weapon => weapon.instanceId === event.instanceId),
      },
    }))
    view.receive({ ...batch, events }, snapshot)
    return events
  }
  const step = (...commands) => {
    for (const command of commands) controller.queue(command)
    return receive(controller.step({ fixedTick: ++tick, fixedElapsed: tick * h, fixedDelta: h }))
  }
  const motion = at => view.motion({ presentationTime: at, fixedDelta: h }, controller.snapshot())
  step()
  await Promise.resolve()
  await Promise.resolve()
  motion(h)
  step()
  motion(2 * h)
  assert.equal(view.snapshot().renderActiveId, 'gun')
  assert.equal(visibleIndicators(rig.root, data), 3)
  return {
    ...rig,
    data,
    player,
    view,
    controller,
    step,
    motion,
    suspend: () => receive(controller.suspend()),
    resume() {
      controller.resume()
      view.resume()
    },
    visible: () => visibleIndicators(rig.root, data),
  }
}

for (const id of ['judge', 'odin']) {
  test(`${id} presented ammo changes at ShotFired/AmmoCommitted facts, never from the newer inventory or reload playback`, async (t) => {
    const f = await fixture(t, id)
    const shot = f.step({ type: 'fire' }).find(event => event.type === 'ShotFired')
    assert.equal(f.controller.snapshot().inventory.weapons[0].magazine, 2)
    f.motion(shot.at - 0.0001)
    assert.equal(f.visible(), 3)
    assert.equal(f.view.snapshot().weapon.magazine, 3)
    f.motion(shot.at)
    assert.equal(f.visible(), 2)
    const reload = f.step({ type: 'reload' }).find(event => event.type === 'ReloadStarted')
    f.motion(reload.at)
    assert.equal(f.visible(), 2)
    f.step()
    const commit = f.step().find(event => event.type === 'AmmoCommitted')
    assert.ok(commit)
    assert.ok(f.controller.snapshot().inventory.weapons[0].magazine > f.data.runtimeControls.ammoDisplay.tracks.length)
    f.motion(commit.at - 0.0001)
    assert.equal(f.visible(), 2)
    assert.equal(f.view.snapshot().weapon.magazine, 2)
    f.motion(commit.at)
    assert.equal(f.visible(), f.data.runtimeControls.ammoDisplay.tracks.length)
    assert.equal(f.view.snapshot().action, 'reloadTactical', 'the feed fact, not ReloadFinished, changes indicators')
    assert.deepEqual(f.bones.get('righthand').scale.toArray(), [2, 3, 4])
    f.motion(commit.at)
    assert.equal(f.visible(), f.data.runtimeControls.ammoDisplay.tracks.length)
    f.view.reset(f.controller.snapshot(), true)
    assert.deepEqual(f.player.snapshot().controls, { samples: {}, bindings: 0 })
    assert.equal(f.view.snapshot().visibleInstances, 0)
  })

  test(`${id} interrupting reload before its commit cannot refill displayed ammunition`, async (t) => {
    const f = await fixture(t, id)
    f.step({ type: 'fire' })
    f.step({ type: 'reload' })
    const cancelled = f.suspend()
    assert.ok(cancelled.some(event => event.type === 'ReloadCancelled'))
    assert.equal(f.player.snapshot().controls.bindings, 0)
    f.resume()
    f.step()
    await Promise.resolve()
    await Promise.resolve()
    f.motion(0.5)
    f.step()
    f.motion(0.6)
    assert.equal(f.visible(), 2)
    for (let i = 0; i < 5; i++) assert.equal(f.step().some(event => event.type === 'AmmoCommitted'), false)
    f.motion(1.1)
    assert.equal(f.visible(), 2)
    assert.equal(f.view.snapshot().weapon.magazine, 2)
  })

  test(`${id} delayed ammo presentation matches at 30/60/144 FPS and one-batch catch-up`, async (t) => {
    const checkpoints = [
      0.29,
      0.3,
      0.399,
      0.4,
      0.59,
      0.6,
      0.7,
      0.9,
      1,
      1.1,
    ]
    let expected
    for (const fps of [30, 60, 144, null]) {
      const f = await fixture(t, id)
      f.step({ type: 'fire' })
      f.step({ type: 'reload' })
      for (let i = 0; i < 5; i++) f.step()
      f.step({ type: 'fire' })
      const frames = new Set(checkpoints)
      if (fps) {
        for (let frame = 1; frame / fps < 1.1; frame++) {
          if (frame / fps > 0.2)
            frames.add(frame / fps)
        }
      }
      const states = []
      for (const at of [...frames].sort((a, b) => a - b)) {
        f.motion(at)
        if (checkpoints.includes(at)) {
          states.push({
            at,
            visible: f.visible(),
            magazine: f.view.snapshot().weapon.magazine,
            action: f.view.snapshot().action,
            controls: f.player.snapshot().controls,
          })
        }
      }
      assert.equal(states[0].visible, 3)
      assert.equal(states[1].visible, 2)
      assert.equal(states[4].visible, 2)
      assert.equal(states[5].visible, f.data.runtimeControls.ammoDisplay.tracks.length)
      if (expected)
        assert.deepEqual(states, expected, `FPS=${fps ?? 'catch-up'}`)
      expected ??= states
    }
  })
}
