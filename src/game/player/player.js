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
      this.motor.resetMotion()
      this.cameraComponent.verticalOffset = this.settings.standEye
      this.input.consumeLook()
      this.input.consumeJump()
    }
  }

  teleport(feet, yaw, pitch = 0) {
    this.motor.teleport(new THREE.Vector3().fromArray(feet))
    this.cameraComponent.reset({ yaw, pitch, verticalOffset: this.settings.standEye })
  }

  respawn() {
    this.teleport(this.collision.spawn.position, this.collision.spawn.yaw)
    this.respawns++
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
    this.look(...this.input.consumeLook())
    const jump = this.input.consumeJump()
    Object.assign(this.motor.command, this.input.intent, { jump: this.motor.command.jump || jump })
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
