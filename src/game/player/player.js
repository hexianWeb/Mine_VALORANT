import * as THREE from 'three/webgpu'
import { characterBox, characterMotion } from '../../engine/runtime/function/character/character-motion.js'
import { CameraComponent, Component, GameObject, MotorComponent, TransformComponent } from '../../engine/runtime/function/framework/index.js'
import { playerConfig } from './config.js'

/** Player input, posture targets and spawn rules. Motion and view live in dependencies. */
export class PlayerComponent extends Component {
  static requires = [TransformComponent, MotorComponent, CameraComponent]
  static phases = ['input', 'postPhysics']
  respawns = 0
  enabled = false
  #respawnQueued = false

  constructor({ collision, input, config = playerConfig }) {
    super()
    this.collision = collision
    this.input = input
    this.settings = config
  }

  onAttach() {
    this.transform = this.owner.requireComponent(TransformComponent)
    this.motor = this.owner.requireComponent(MotorComponent)
    this.cameraComponent = this.owner.requireComponent(CameraComponent)
    this.teleport(this.collision.spawn.position, this.collision.spawn.yaw)
    this.motor.enabled = this.enabled
    this.cameraComponent.enabled = this.enabled
  }

  get position() { return this.transform.position }
  get velocity() { return this.motor.velocity }
  get grounded() { return this.motor.grounded }
  get crouched() { return this.motor.crouched }
  get yaw() { return this.cameraComponent.yaw }
  get pitch() { return this.cameraComponent.pitch }

  setEnabled(value) {
    this.enabled = !!value && !this.disposed
    this.motor.enabled = this.enabled
    this.cameraComponent.enabled = this.enabled
    if (!this.enabled) {
      this.#respawnQueued = false
      this.motor.resetMotion()
      this.cameraComponent.verticalOffset = this.settings.standEye
      this.cameraComponent.resetStepSmoothing()
      this.input.consumeLook()
      this.input.consumePressed('jump')
      this.input.consumePressed('respawn')
    }
  }

  teleport(feet, yaw, pitch = 0) {
    this.#respawnQueued = false
    this.motor.teleport(new THREE.Vector3().fromArray(feet))
    this.cameraComponent.reset({ yaw, pitch, verticalOffset: this.settings.standEye })
  }

  respawn() {
    this.teleport(this.collision.spawn.position, this.collision.spawn.yaw)
    this.respawns++
  }

  /** UI and tools enqueue the same command as the gameplay action; input tick applies it. */
  requestRespawn() {
    if (this.enabled && !this.disposed)
      this.#respawnQueued = true
  }

  /** Feet go standEye below the camera; blocked placement falls back to spawn. */
  placeAtCamera() {
    const { position, yaw, pitch } = this.cameraComponent.readCameraPose(this.settings.standEye)
    if (this.motor.physics.overlaps(this.collision.world, characterBox(position, this.settings)))
      this.respawn()
    else
      this.teleport(position.toArray(), yaw, pitch)
  }

  look(dx, dy) {
    const radiansPerCount = THREE.MathUtils.degToRad(this.settings.degreesPerCount) * this.settings.sensitivity
    this.cameraComponent.look(-dx * radiansPerCount, -dy * radiansPerCount)
  }

  readInput() {
    const respawn = this.input.consumePressed('respawn')
    if (respawn || this.#respawnQueued)
      this.respawn()
    this.look(...this.input.consumeLook())
    const jump = this.input.consumePressed('jump')
    Object.assign(this.motor.command, {
      moveX: Number(this.input.isDown('right')) - Number(this.input.isDown('left')),
      moveZ: Number(this.input.isDown('forward')) - Number(this.input.isDown('back')),
      walk: this.input.isDown('walk'),
      crouch: this.input.isDown('crouch'),
      jump: this.motor.command.jump || jump,
    })
  }

  tick({ phase }) {
    if (phase === 'input') {
      this.readInput()
    }
    else if (phase === 'postPhysics') {
      if (this.collision.isOutOfBounds(characterBox(this.position, this.settings, this.crouched)))
        this.respawn()
      this.cameraComponent.verticalOffset = this.crouched ? this.settings.crouchEye : this.settings.standEye
    }
  }

  snapshot() {
    return {
      position: this.position.toArray(),
      velocity: this.velocity.toArray(),
      grounded: this.grounded,
      crouched: this.crouched,
      yawDeg: THREE.MathUtils.radToDeg(this.yaw),
      pitchDeg: THREE.MathUtils.radToDeg(this.pitch),
      respawns: this.respawns,
    }
  }

  dispose() {
    if (this.disposed)
      return
    super.dispose()
    if (this.motor)
      this.setEnabled(false)
    this.input.setEnabled(false)
  }
}

function createStepOffsetLimiter(world) {
  const bounds = new THREE.Box3()
  const corner = new THREE.Vector3()
  const sweep = { min: [], max: [] }
  const hits = []

  return (camera, offset) => {
    const clipMinZ = camera.coordinateSystem === THREE.WebGPUCoordinateSystem
      ? 0
      : -1
    const nearZ = camera.reversedDepth ? 1 : clipMinZ
    // Bound the eye and the near plane at the sampled camera pose.
    bounds.set(camera.position, camera.position)
    for (const x of [-1, 1]) {
      for (const y of [-1, 1]) {
        corner.set(x, y, nearZ)
          .applyMatrix4(camera.projectionMatrixInverse)
          .applyQuaternion(camera.quaternion)
          .add(camera.position)
        bounds.expandByPoint(corner)
      }
    }
    bounds.expandByScalar(1e-5)
    const top = bounds.max.y
    bounds.max.y += offset
    bounds.min.toArray(sweep.min)
    bounds.max.toArray(sweep.max)

    let clearance = offset
    for (const hit of world.queryAABB(sweep, hits))
      clearance = Math.min(clearance, Math.max(0, hit.min[1] - top))
    return clearance
  }
}

/** Object assembly only; the Level schedules these same types across all objects. */
export function createPlayer({ camera, collision, input, physics, config = {} }) {
  const settings = {
    ...playerConfig,
    ...config,
  }
  const object = new GameObject({ name: 'Player' })
  object.addComponent(new TransformComponent())
  const motor = object.addComponent(new MotorComponent({
    clock: 'fixed',
    motion: characterMotion,
    state: settings,
    physics,
    world: collision.world,
  }))
  motor.enabled = false
  const view = object.addComponent(new CameraComponent({
    camera,
    verticalOffset: settings.standEye,
    offsetSmoothing: settings.eyeSmoothing,
    sampleStepDeltaY: alpha => motor.sampleStepDeltaY(alpha),
    limitStepOffset: createStepOffsetLimiter(collision.world),
    stepSmoothingTime: settings.stepSmoothingTime,
    maxPitch: THREE.MathUtils.degToRad(settings.maxPitchDeg),
  }))
  view.enabled = false
  object.addComponent(new PlayerComponent({
    collision,
    input,
    config: settings,
  }))
  return object
}
