import assert from 'node:assert/strict'
import test from 'node:test'
import { PerspectiveCamera, Quaternion, Scene, Vector3, WebGLCoordinateSystem, WebGPUCoordinateSystem } from 'three/webgpu'
import { createBulletHoleTexture } from '../src/game/weapons/bullet-hole.js'
import { createMuzzleFlash } from '../src/game/weapons/muzzle-flash.js'
import { projectMuzzleToWorld, ShotEffects } from '../src/game/weapons/shot-effects.js'
import { shotRandom } from '../src/game/weapons/shot-random.js'

function shot(overrides = {}) {
  return {
    type: 'ShotFired',
    at: 2.5,
    payload: {
      shotSequence: 17,
      eyeOrigin: [0, 0, 0],
      shotDirection: [0, 0, -1],
      impact: {
        hit: 'Wall',
        surface: 'stone',
        distance: 20,
        position: [0, 0, -20],
        normal: [0, 0, 1],
      },
      ...overrides,
    },
  }
}

function fixture(t) {
  const bursts = []
  const marks = []
  const cleared = { particles: 0, decals: 0 }
  const camera = new PerspectiveCamera(75, 16 / 9, 0.05, 400)
  const viewCamera = new PerspectiveCamera(70, camera.aspect, 0.005, 10)
  const pose = {
    position: [0, 0, 0],
    quaternion: [0, 0, 0, 1],
    worldFov: 35,
    viewmodelFov: 70,
  }
  const samples = []
  const effects = new ShotEffects({
    particles: {
      emit: particles => bursts.push(particles),
      clear: () => cleared.particles++,
    },
    decals: {
      emit: decals => marks.push(decals),
      clear: () => cleared.decals++,
      flush() {},
    },
    camera,
    viewCamera,
    samplePose(at) {
      samples.push(at)
      return pose
    },
  })
  t.after(() => effects.dispose())
  const receive = event => effects.receive({
    events: [event],
  })
  const present = (event, muzzle, presentationTime) => effects.motion({ presentationTime }, [
    { event, muzzle },
  ])
  return {
    effects,
    bursts,
    marks,
    cleared,
    camera,
    viewCamera,
    pose,
    samples,
    receive,
    present,
  }
}

test('muzzle reprojection preserves screen coordinates across ADS, camera motion and depth conventions', () => {
  const muzzle = [0.2, -0.12, -0.8]
  const viewCamera = new PerspectiveCamera(70, 16 / 9, 0.005, 10)
  for (const convention of [WebGLCoordinateSystem, WebGPUCoordinateSystem]) {
    for (const reversed of [false, true]) {
      for (const fov of [75, 35]) {
        const camera = new PerspectiveCamera(fov, viewCamera.aspect, 0.05, 400)
        camera.coordinateSystem = convention
        camera._reversedDepth = reversed
        camera.updateProjectionMatrix()
        camera.position.set(3, 5, 7)
        camera.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), 0.7)
        const start = projectMuzzleToWorld(muzzle, viewCamera, camera)
        const actual = new Vector3(...start).project(camera)
        const expected = new Vector3(...muzzle).applyMatrix4(viewCamera.projectionMatrix)
        assert.ok(Math.abs(actual.x - expected.x) < 1e-12)
        assert.ok(Math.abs(actual.y - expected.y) < 1e-12)
        assert.ok(Math.abs(new Vector3(...start).applyMatrix4(camera.matrixWorldInverse).z + 0.4) < 1e-12)
        const incorrect = new Vector3(...muzzle).applyMatrix4(camera.matrixWorld).project(camera)
        assert.ok(Math.abs(incorrect.x - expected.x) > 0.001, 'raw socket coordinates do not align at a different world FOV')
      }
    }
  }
})

test('tracers start at the projected muzzle, use shot birth time and end exactly at the impact', (t) => {
  const f = fixture(t)
  const event = shot()
  const muzzle = [0.15, -0.1, -0.8]
  f.receive(event)
  f.present(event, muzzle, 2.53)
  const [tracer] = f.bursts.at(-1)
  assert.equal(tracer.shape, 'tracer')
  assert.equal(tracer.born, event.at)
  assert.equal(tracer.gravity, 0)
  assert.deepEqual(f.samples, [event.at])
  const camera = f.camera.clone()
  camera.fov = f.pose.worldFov
  camera.updateProjectionMatrix()
  assert.deepEqual(tracer.origin, projectMuzzleToWorld(muzzle, f.viewCamera, camera))
  const end = new Vector3(...tracer.origin).addScaledVector(new Vector3(...tracer.velocity), tracer.life)
  assert.ok(end.distanceTo(new Vector3(...event.payload.impact.position)) < 1e-12)
  assert.ok(Math.abs(new Vector3(...tracer.velocity).length() - 160) < 1e-12)
  assert.notEqual(tracer.life, event.payload.impact.distance / 160, 'lifetime uses muzzle-to-hit distance, not eye distance')
  const before = structuredClone(tracer)
  f.camera.position.set(10, 12, -8)
  f.camera.quaternion.copy(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 1))
  f.camera.fov = 90
  f.present(event, muzzle, 3)
  assert.deepEqual(f.bursts.at(-1), [before], 'a late render uses the historical shot pose, not the current world camera')
})

test('misses still trace to range, and very close impacts never launch behind the hit', (t) => {
  const f = fixture(t)
  const event = shot()
  event.payload.impact.hit = null
  f.receive(event)
  assert.equal(f.bursts.length, 0)
  assert.equal(f.marks.length, 0)
  f.present(event, [0.1, -0.1, -0.7], event.at)
  assert.equal(f.bursts.at(-1)[0].shape, 'tracer')
  const close = shot()
  close.payload.impact.distance = 0.15
  close.payload.impact.position = [0, 0, -0.15]
  f.present(close, [0.1, -0.1, -0.7], close.at)
  assert.ok(f.bursts.at(-1)[0].origin[2] > -0.15)
  const count = f.bursts.length
  close.payload.impact.distance = 0.01
  f.present(close, [0.1, -0.1, -0.7], close.at)
  assert.equal(f.bursts.length, count)
})

test('bullet holes are 1.5 times their original size without changing shot-seeded rotation', (t) => {
  const f = fixture(t)
  for (const shotSequence of [1, 17, 99]) {
    f.receive(shot({ shotSequence }))
    const random = shotRandom(shotSequence)
    const mark = f.marks.at(-1)[0]
    assert.equal(mark.size, (0.075 + random() * 0.025) * 1.5)
    assert.equal(mark.rotation, random() * Math.PI * 2)
  }
})

test('Judge marks every static pellet hit, skips targets and misses, and draws at most three tracers', (t) => {
  const f = fixture(t)
  const event = shot()
  event.payload.pellets = Array.from({ length: 12 }, (_, index) => ({
    index,
    impact: {
      ...event.payload.impact,
      position: [index * 0.1, 0, -20],
      ...(index === 0
        ? { targetId: 'training-bot' }
        : {}),
      ...(index === 1
        ? { hit: null }
        : {}),
    },
  }))
  f.receive(event)
  assert.equal(f.bursts.length, 1, 'only the existing nearest-impact particle burst is emitted')
  assert.equal(f.marks[0].length, 10)
  assert.ok(f.marks[0].every(mark => mark.born === event.at))
  f.receive(event)
  assert.deepEqual(f.marks[0], f.marks[1], 'mark rotation and size are shot-seeded')
  f.present(event, [0.1, -0.1, -0.7], 2.52)
  assert.equal(f.bursts.at(-1).length, 3)
  assert.ok(f.bursts.at(-1).every(particle => particle.shape === 'tracer' && particle.born === event.at))
  const botShot = shot()
  botShot.payload.impact.targetId = 'training-bot'
  f.receive(botShot)
  assert.equal(f.marks.length, 2)
  f.receive({ type: 'PresentationReset' })
  assert.deepEqual(f.cleared, { particles: 1, decals: 1 })
})

test('shot effects own their world decal resources and clear them on reset and disposal', () => {
  const scene = new Scene()
  const effects = new ShotEffects({ scene })
  const mesh = scene.children[0]
  const released = []
  const resources = [
    mesh,
    mesh.geometry,
    mesh.material,
    mesh.material.map,
  ]
  for (const resource of resources)
    resource.addEventListener('dispose', () => released.push(resource))
  effects.receive({
    events: [
      shot(),
    ],
  })
  effects.motion({ presentationTime: 2.4 })
  assert.equal(effects.snapshot().decals.visible, 0)
  effects.motion({ presentationTime: 1000 })
  assert.equal(effects.snapshot().decals.visible, 1)
  effects.receive({
    events: [
      { type: 'PresentationReset' },
    ],
  })
  assert.equal(mesh.count, 0)
  effects.dispose()
  effects.dispose()
  effects.receive({
    events: [
      shot(),
    ],
  })
  assert.equal(released.length, resources.length)
  assert.deepEqual(scene.children, [])
})

test('muzzle flash uses deterministic transparent cards and disposes their shared resources once', () => {
  const flash = createMuzzleFlash()
  assert.equal(flash.root.children.length, 3)
  assert.ok(flash.root.children.every(card => card.geometry.type === 'PlaneGeometry' && !card.material.depthWrite))
  const transforms = () => flash.root.children.map(card => ({
    rotation: card.rotation.toArray(),
    scale: card.scale.toArray(),
  }))
  flash.setShot(17)
  const first = transforms()
  flash.setShot(18)
  assert.notDeepEqual(transforms(), first)
  flash.setShot(17)
  assert.deepEqual(transforms(), first)
  flash.setStrength(0.5)
  assert.equal(flash.root.visible, true)
  flash.setStrength(0)
  assert.equal(flash.root.visible, false)
  const card = flash.root.children[0]
  let disposed = 0
  for (const resource of [card.geometry, card.material])
    resource.addEventListener('dispose', () => disposed++)
  const scene = new Scene()
  scene.add(flash.root)
  flash.dispose()
  flash.dispose()
  assert.equal(disposed, 2)
  assert.deepEqual(scene.children, [])
})

test('the bullet-hole texture has transparent borders and an opaque dark core', () => {
  const texture = createBulletHoleTexture()
  const { width, height, data } = texture.image
  const center = ((height / 2) * width + width / 2) * 4
  assert.equal(data[3], 0)
  assert.equal(data[center + 3], 255)
  assert.ok(data[center] < 40)
  texture.dispose()
})
