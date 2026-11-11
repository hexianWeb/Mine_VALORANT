import assert from 'node:assert/strict'
import test from 'node:test'
import { Euler, PerspectiveCamera, Quaternion, Scene, Vector3 } from 'three/webgpu'
import { CameraComponent, GameObject, Level, TransformComponent } from '../src/engine/runtime/function/framework/index.js'

const near = (actual, expected, message = '') => assert.ok(Math.abs(actual - expected) < 1e-10, `${message}: ${actual} vs ${expected}`)

function setup(t, options = {}) {
  const camera = new PerspectiveCamera(66, 1.8, 0.2, 500)
  const level = new Level({
    scene: new Scene(),
  })
  const object = new GameObject()
  const transform = object.addComponent(new TransformComponent())
  const view = object.addComponent(new CameraComponent({ camera, ...options }))
  level.addObject(object)
  t.after(() => level.dispose())
  return {
    camera,
    level,
    object,
    transform,
    view,
    present: (alpha = 1, rawDelta = 0) => level.tickComponents('presentation', {
      time: { alpha, rawDelta, delta: 0 },
    }),
  }
}

test('standalone Camera samples Transform in presentation without changing simulation or projection', (t) => {
  const { camera, level, object, transform, view, present } = setup(t, { verticalOffset: 1.6 })
  const projection = camera.projectionMatrix.clone()
  transform.interpolate = true
  transform.teleport(new Vector3(1, 2, 3))
  transform.position.set(5, 6, 7)
  view.setAngles(0.7, 0.35)
  const heading = transform.quaternion.clone()
  level.tickComponents('input', { time: {} })
  assert.deepEqual(camera.position.toArray(), [0, 0, 0], 'commands publish only at presentation')
  present(0.25)
  assert.deepEqual(camera.position.toArray(), [2, 4.6, 4])
  const expected = new Quaternion().setFromEuler(new Euler(0.35, 0.7, 0, 'YXZ'))
  assert.ok(camera.quaternion.angleTo(expected) < 1e-7)
  assert.deepEqual(transform.position.toArray(), [5, 6, 7])
  assert.deepEqual(transform.previousPosition.toArray(), [1, 2, 3])
  assert.ok(transform.quaternion.equals(heading))
  assert.ok(camera.projectionMatrix.equals(projection))
  assert.equal(level.scene.children.length, 0, 'camera output is borrowed, not attached as a mesh')
  assert.deepEqual(object.components.map(component => component.constructor), [TransformComponent, CameraComponent])
})

test('offset smoothing uses raw presentation time, is frame-rate independent and resets without a trail', (t) => {
  const single = setup(t, { verticalOffset: 1.8, offsetSmoothing: 12 })
  const split = setup(t, { verticalOffset: 1.8, offsetSmoothing: 12 })
  single.view.verticalOffset = split.view.verticalOffset = 1.2
  single.present(1, 0.1)
  split.present(1, 0.05)
  split.present(1, 0.05)
  near(single.camera.position.y, 1.2 + 0.6 * Math.exp(-1.2))
  near(single.view.currentVerticalOffset, split.view.currentVerticalOffset)
  const before = single.camera.position.clone()
  single.transform.teleport(new Vector3(20, 5, -30))
  single.view.reset({ yaw: -1, pitch: 0.2, verticalOffset: 1.8 })
  assert.ok(single.camera.position.equals(before), 'reset updates history, not render output')
  single.present(0, 0)
  assert.deepEqual(single.camera.position.toArray(), [20, 6.8, -30])
  near(single.view.currentVerticalOffset, 1.8)
})

test('radian look commands keep body yaw authoritative and clamp both pitch directions', (t) => {
  const { view, transform, camera, present } = setup(t, { maxPitch: 0.8 })
  view.setAngles(0.5, 0.2)
  view.look(-0.25, 10)
  near(view.yaw, 0.25)
  near(view.pitch, 0.8)
  near(transform.quaternion.x, 0)
  near(transform.quaternion.z, 0)
  view.look(0, -20)
  near(view.pitch, -0.8)
  transform.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), -1.1)
  near(view.yaw, -1.1, 'external heading changes remain visible')
  view.verticalOffset = 2
  present(1, 0)
  near(camera.position.y, 2, 'zero smoothing snaps even on a zero-delta frame')
  assert.ok(camera.quaternion.angleTo(new Quaternion().setFromEuler(new Euler(-0.8, -1.1, 0, 'YXZ'))) < 1e-7)
})

test('disabled, inactive and removed cameras relinquish the shared output without destroying it', (t) => {
  const { camera, level, object, transform, view, present } = setup(t)
  const second = new GameObject()
  second.addComponent(new TransformComponent({
    position: new Vector3(8, 9, 10),
  }))
  const other = second.addComponent(new CameraComponent({ camera }))
  other.enabled = false
  level.addObject(second)
  assert.deepEqual(camera.position.toArray(), [0, 0, 0], 'attachment does not claim the output')
  transform.position.set(1, 2, 3)
  present()
  assert.deepEqual(camera.position.toArray(), [1, 2, 3])
  view.enabled = false
  camera.position.set(30, 40, 50)
  present()
  assert.deepEqual(camera.position.toArray(), [30, 40, 50])
  view.enabled = true
  object.active = false
  present()
  assert.deepEqual(camera.position.toArray(), [30, 40, 50])
  other.enabled = true
  present()
  assert.deepEqual(camera.position.toArray(), [8, 9, 10])
  object.active = true
  object.removeComponent(CameraComponent)
  assert.equal(view.disposed, true)
  assert.equal(view.enabled, false)
  assert.throws(() => second.removeComponent(TransformComponent), /required component/)
  level.dispose()
  camera.position.set(60, 70, 80)
  present()
  assert.deepEqual(camera.position.toArray(), [60, 70, 80])
  camera.updateProjectionMatrix()
  assert.ok(camera.projectionMatrix.elements.every(Number.isFinite))
})

test('camera handoff reads a candidate body pose without moving it or overwriting the output', (t) => {
  const { camera, transform, view, present } = setup(t, { verticalOffset: 1.5, offsetSmoothing: 12 })
  camera.position.set(10, 5, -4)
  camera.quaternion.setFromEuler(new Euler(0.3, -0.7, 0, 'YXZ'))
  const position = camera.position.clone()
  const quaternion = camera.quaternion.clone()
  const pose = view.readCameraPose(2)
  assert.deepEqual(pose.position.toArray(), [10, 3, -4])
  near(pose.yaw, -0.7)
  near(pose.pitch, 0.3)
  assert.deepEqual(transform.position.toArray(), [0, 0, 0])
  assert.ok(camera.position.equals(position) && camera.quaternion.equals(quaternion))
  transform.teleport(pose.position)
  view.reset({ ...pose, verticalOffset: 2 })
  present(0, 0)
  assert.ok(camera.position.equals(position))
  assert.ok(camera.quaternion.angleTo(quaternion) < 1e-7)
})

test('an injected view history owns camera pose and FOV without presentation-time smoothing', (t) => {
  const calls = []
  const rotation = new Quaternion().setFromEuler(new Euler(0.1, 0.2, 0, 'YXZ')).toArray()
  const f = setup(t, {
    offsetSmoothing: 12,
    stepSmoothingTime: 0.1,
    sampleStepDeltaY() { throw new Error('legacy step sampler must not run') },
    sampleViewPose(at) {
      calls.push(at)
      return {
        position: [1, 2, 3],
        quaternion: rotation,
        pitch: 0.1,
        verticalOffset: 1.5,
        worldFov: 45,
      }
    },
  })
  const present = () => f.level.tickComponents('presentation', {
    time: { presentationTime: 0.25, rawDelta: 20, alpha: 0.9 },
  })
  f.transform.position.set(20, 30, 40)
  const bodyRotation = f.transform.quaternion.clone()
  present()
  present()
  assert.deepEqual(calls, [0.25, 0.25])
  assert.deepEqual(f.camera.position.toArray(), [1, 2, 3])
  assert.ok(f.camera.quaternion.angleTo(new Quaternion().fromArray(rotation)) < 1e-7)
  assert.equal(f.camera.fov, 45)
  assert.equal(f.view.currentVerticalOffset, 1.5)
  assert.deepEqual(f.transform.position.toArray(), [20, 30, 40])
  assert.ok(f.transform.quaternion.equals(bodyRotation))
})
