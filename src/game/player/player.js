import * as THREE from 'three/webgpu'
import { characterBox, characterMotion } from '../../engine/runtime/function/character/character-motion.js'
import { CameraComponent, Component, GameObject, MotorComponent, TransformComponent } from '../../engine/runtime/function/framework/index.js'
import { PlayerWeapons } from '../weapons/player-weapons.js'
import { AimState } from './aim-state.js'
import { playerConfig } from './config.js'

/** Player input, posture targets and spawn rules. Motion and view live in dependencies. */
export class PlayerComponent extends Component {
  static requires = [TransformComponent, MotorComponent, CameraComponent]
  static phases = ['input', 'postPhysics', 'motion']
  respawns = 0
  enabled = false
  #respawnQueued = false
  #at = 0
  #presentationAt = 0
  #paused = false
  #rebaseViewOnNextStep = false

  constructor({ collision, input, aim, weapons = null, config = playerConfig }) {
    super()
    this.collision = collision
    this.input = input
    this.settings = config
    this.aim = aim
    this.weapons = weapons
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
  get yaw() { return this.aim.yaw }
  get pitch() { return this.aim.pitch }

  setEnabled(value) {
    const enabled = !!value && !this.disposed
    if (enabled === this.enabled)
      return
    this.enabled = enabled
    this.motor.enabled = this.enabled
    this.cameraComponent.enabled = this.enabled
    if (!this.enabled) {
      this.weapons?.suspend()
      this.aim.clearInput()
      this.#respawnQueued = false
      this.motor.resetMotion()
      this.cameraComponent.verticalOffset = this.settings.standEye
      this.cameraComponent.resetStepSmoothing()
      this.input.consumeLook()
      this.input.consumePressed('jump')
      this.input.consumePressed('respawn')
    }
    else {
      this.#rebaseViewOnNextStep = true
      this.weapons?.resume()
    }
  }

  teleport(feet, yaw, pitch = 0) {
    this.#respawnQueued = false
    this.motor.teleport(new THREE.Vector3().fromArray(feet))
    this.transform.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
    this.aim.reset({
      feet,
      yaw,
      pitch,
      verticalOffset: this.settings.standEye,
      at: this.#at,
    })
  }

  respawn() {
    this.teleport(this.collision.spawn.position, this.collision.spawn.yaw)
    this.weapons?.reset()
    this.respawns++
  }

  /** UI and tools enqueue the same command as the gameplay action; the next fixed step applies it. */
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
    this.aim.queueLook(-dx * radiansPerCount, -dy * radiansPerCount)
  }

  setPaused(value) {
    if (value === this.#paused)
      return
    if (!value) {
      const respawn = this.input.consumePressed('respawn')
      this.#respawnQueued ||= this.enabled && respawn
      this.weapons?.collectInput(this.input, true)
    }
    this.#paused = value
    this.input.clear?.()
    this.aim.clearInput()
    this.motor.command.jump = false
    this.weapons?.setPaused(value)
  }

  readInput(time) {
    this.setPaused(time.timeScale === 0)
    const respawn = this.input.consumePressed('respawn')
    this.#respawnQueued ||= respawn
    const look = this.input.consumeLook()
    if (!this.#paused)
      this.look(...look)
    const jump = this.input.consumePressed('jump')
    Object.assign(this.motor.command, {
      moveX: Number(this.input.isDown('right')) - Number(this.input.isDown('left')),
      moveZ: Number(this.input.isDown('forward')) - Number(this.input.isDown('back')),
      walk: this.input.isDown('walk'),
      crouch: this.input.isDown('crouch'),
      jump: this.motor.command.jump || jump,
      headingYaw: this.aim.headingYaw,
    })
    this.weapons?.collectInput(this.input, this.#paused)
  }

  tick(context) {
    const { phase, time } = context
    if (phase === 'input') {
      this.readInput(time)
    }
    else if (phase === 'postPhysics') {
      if (this.#rebaseViewOnNextStep) {
        this.aim.rebase((time.fixedTick - 1) * time.fixedDelta)
        this.#rebaseViewOnNextStep = false
      }
      this.#at = time.fixedElapsed
      if (this.#respawnQueued || this.collision.isOutOfBounds(characterBox(this.position, this.settings, this.crouched)))
        this.respawn()
      const pose = {
        feet: this.position,
        verticalOffset: this.crouched ? this.settings.crouchEye : this.settings.standEye,
        stepDeltaY: this.motor.sampleStepDeltaY(1),
        moving: Math.hypot(this.velocity.x, this.velocity.z) > 0.1,
        crouched: this.crouched,
      }
      if (this.weapons) {
        this.weapons.fixed(context, pose)
      }
      else {
        this.aim.beginStep({ ...pose, at: time.fixedElapsed, delta: time.fixedDelta })
        this.aim.endStep()
      }
      this.transform.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.aim.yaw)
    }
    else if (phase === 'motion') {
      this.#presentationAt = time.presentationTime
      this.weapons?.motion(time)
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
      view: this.aim.sample(this.#presentationAt),
      weapons: this.weapons?.snapshot() ?? null,
    }
  }

  dispose() {
    if (this.disposed)
      return
    super.dispose()
    if (this.motor)
      this.setEnabled(false)
    this.weapons?.dispose()
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
export function createPlayer({ camera, collision, input, physics, weapons = null, config = {} }) {
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
  const limiter = createStepOffsetLimiter(collision.world)
  const poseCamera = new THREE.PerspectiveCamera()
  const aim = new AimState({
    verticalOffset: settings.standEye,
    offsetSmoothing: settings.eyeSmoothing,
    stepSmoothingTime: settings.stepSmoothingTime,
    maxPitch: THREE.MathUtils.degToRad(settings.maxPitchDeg),
    worldFov: camera.fov,
    limitStepOffset: (pose, offset) => {
      poseCamera.fov = pose.worldFov
      poseCamera.aspect = camera.aspect
      poseCamera.near = camera.near
      poseCamera.far = camera.far
      poseCamera.coordinateSystem = camera.coordinateSystem
      poseCamera.updateProjectionMatrix()
      poseCamera.position.fromArray(pose.position)
      poseCamera.quaternion.fromArray(pose.quaternion)
      return limiter(poseCamera, offset)
    },
  })
  const view = object.addComponent(new CameraComponent({
    camera,
    verticalOffset: settings.standEye,
    offsetSmoothing: settings.eyeSmoothing,
    sampleStepDeltaY: alpha => motor.sampleStepDeltaY(alpha),
    limitStepOffset: createStepOffsetLimiter(collision.world),
    stepSmoothingTime: settings.stepSmoothingTime,
    maxPitch: THREE.MathUtils.degToRad(settings.maxPitchDeg),
    sampleViewPose: at => aim.sample(at),
  }))
  view.enabled = false
  object.addComponent(new PlayerComponent({
    collision,
    input,
    aim,
    weapons: weapons
      ? new PlayerWeapons({ ...weapons, aim, world: collision.world })
      : null,
    config: settings,
  }))
  return object
}
