import { Vector3 } from 'three/webgpu'
import { Component } from '../component.js'
import { TransformComponent } from '../transform/transform-component.js'

/** 共享的运动时钟与状态。普通函数返回目标姿态或位移。 */
export class MotorComponent extends Component {
  static requires = [TransformComponent]
  #clock
  #phases
  elapsed = 0
  velocity = new Vector3()
  grounded = false
  crouched = false
  command = {}

  constructor({ clock = 'fixed', motion, state = {}, physics = null, world = null }) {
    super()
    if (!['fixed', 'frame'].includes(clock) || typeof motion !== 'function')
      throw new Error('[MotorComponent] Expected fixed/frame clock and a motion function')
    this.#clock = clock
    this.#phases = Object.freeze([
      clock === 'fixed'
        ? 'fixed'
        : 'motion',
    ])
    this.motion = motion
    this.state = state
    this.physics = physics
    this.world = world
  }

  get clock() { return this.#clock }
  get phases() { return this.#phases }

  onAttach() {
    this.transform = this.owner.requireComponent(TransformComponent)
    this.transform.interpolate = this.clock === 'fixed'
    this.transform.capturePosition()
  }

  tick({ delta }) {
    if (delta <= 0)
      return
    if (this.clock === 'fixed')
      this.transform.capturePosition()
    this.elapsed += delta
    const motion = this.motion(this, delta)
    if (!motion)
      return
    if (motion.box) {
      const result = this.physics.move(this.world, motion.box, motion.displacement, motion.options)
      this.transform.position.x += result.displacement[0]
      this.transform.position.y += result.displacement[1]
      this.transform.position.z += result.displacement[2]
      if (result.hitX)
        this.velocity.x = 0
      if (result.hitZ)
        this.velocity.z = 0
      if (result.hitY || (result.grounded && this.velocity.y < 0))
        this.velocity.y = 0
      this.grounded = result.grounded
    }
    else if (motion.displacement) {
      this.transform.position.x += motion.displacement[0]
      this.transform.position.y += motion.displacement[1]
      this.transform.position.z += motion.displacement[2]
    }
    else if (motion.position) {
      this.transform.position.copy(motion.position)
    }
    if (motion.quaternion)
      this.transform.quaternion.copy(motion.quaternion)
  }

  resetMotion() {
    this.velocity.set(0, 0, 0)
    this.grounded = false
    this.crouched = false
    this.command = {}
    this.transform?.capturePosition()
  }

  teleport(position) {
    this.transform.teleport(position)
    this.resetMotion()
  }

  dispose() {
    if (this.disposed)
      return
    super.dispose()
    this.enabled = false
    if (this.transform) {
      this.transform.capturePosition()
      this.transform.interpolate = false
    }
  }
}
