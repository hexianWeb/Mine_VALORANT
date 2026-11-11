import { Euler, MathUtils, Vector3 } from 'three/webgpu'
import { Component } from '../component.js'
import { TransformComponent } from '../transform/transform-component.js'

const up = new Vector3(0, 1, 0)
const STEP_OFFSET_EPSILON = 1e-6

/** First-person view: Transform owns heading; this component owns pitch and follow offset. */
export class CameraComponent extends Component {
  static requires = [TransformComponent]
  static phases = ['presentation']
  #pitch = 0
  #currentVerticalOffset
  #sampleStepDeltaY
  #limitStepOffset
  #stepSmoothingRate
  #smoothedStepDeltaY = 0
  #euler = new Euler(0, 0, 0, 'YXZ')

  constructor({
    camera,
    verticalOffset = 0,
    offsetSmoothing = 0,
    sampleStepDeltaY = null,
    limitStepOffset = null,
    stepSmoothingTime = 0,
    maxPitch = MathUtils.degToRad(89),
  }) {
    super()
    if (!camera?.isCamera)
      throw new TypeError('[CameraComponent] Expected a render camera')
    if (!Number.isFinite(verticalOffset) || !Number.isFinite(offsetSmoothing) || offsetSmoothing < 0
      || !Number.isFinite(maxPitch) || maxPitch < 0 || maxPitch > Math.PI / 2) {
      throw new Error('[CameraComponent] Expected a finite offset, nonnegative smoothing and pitch limit in [0, PI/2]')
    }
    if (!Number.isFinite(stepSmoothingTime) || stepSmoothingTime < 0
      || (sampleStepDeltaY !== null && typeof sampleStepDeltaY !== 'function')
      || (limitStepOffset !== null && typeof limitStepOffset !== 'function')) {
      throw new Error('[CameraComponent] Expected a nonnegative step smoothing time and optional step callbacks')
    }
    // Borrowed output, owned by the runtime. Projection and viewport setup belong to that owner.
    this.camera = camera
    this.verticalOffset = verticalOffset
    this.offsetSmoothing = offsetSmoothing
    this.maxPitch = maxPitch
    this.#currentVerticalOffset = verticalOffset
    this.#sampleStepDeltaY = sampleStepDeltaY
    this.#limitStepOffset = limitStepOffset
    this.#stepSmoothingRate = stepSmoothingTime > 0
      ? Math.LN10 / stepSmoothingTime
      : 0
  }

  onAttach() {
    this.transform = this.owner.requireComponent(TransformComponent)
    this.resetStepSmoothing()
  }

  get yaw() { return 2 * Math.atan2(this.transform.quaternion.y, this.transform.quaternion.w) }
  get pitch() { return this.#pitch }
  get currentVerticalOffset() { return this.#currentVerticalOffset }

  /** Radian commands are applied before fixed motion; pitch never tilts the character body. */
  setAngles(yaw, pitch) {
    this.transform.quaternion.setFromAxisAngle(up, yaw)
    this.#pitch = MathUtils.clamp(pitch, -this.maxPitch, this.maxPitch)
  }

  look(deltaYaw, deltaPitch) {
    this.setAngles(this.yaw + deltaYaw, this.pitch + deltaPitch)
  }

  /** Reset view history on teleport/respawn without publishing outside presentation. */
  reset({ yaw = this.yaw, pitch = 0, verticalOffset = this.verticalOffset } = {}) {
    this.setAngles(yaw, pitch)
    this.verticalOffset = verticalOffset
    this.#currentVerticalOffset = verticalOffset
    this.resetStepSmoothing()
  }

  resetStepSmoothing() {
    this.#smoothedStepDeltaY = this.#sampleStepDeltaY?.(1) ?? 0
  }

  /** Read a candidate body pose from the shared camera; placement rules belong to the caller. */
  readCameraPose(verticalOffset = this.verticalOffset) {
    this.#euler.setFromQuaternion(this.camera.quaternion, 'YXZ')
    return {
      position: this.camera.position.clone().addScaledVector(up, -verticalOffset),
      yaw: this.#euler.y,
      pitch: MathUtils.clamp(this.#euler.x, -this.maxPitch, this.maxPitch),
    }
  }

  tick({ time }) {
    const blend = this.offsetSmoothing > 0
      ? 1 - Math.exp(-this.offsetSmoothing * time.rawDelta)
      : 1
    this.#currentVerticalOffset += (this.verticalOffset - this.#currentVerticalOffset) * blend
    this.transform.samplePosition(time.alpha, this.camera.position)
    this.camera.position.y += this.#currentVerticalOffset
    this.#euler.set(this.pitch, this.yaw, 0, 'YXZ')
    this.camera.quaternion.setFromEuler(this.#euler)
    if (this.#sampleStepDeltaY && this.#stepSmoothingRate > 0) {
      const stepDeltaY = this.#sampleStepDeltaY(time.alpha)
      const targetStepDeltaY = this.#sampleStepDeltaY(1)
      const previous = this.#smoothedStepDeltaY
      const smoothed = MathUtils.damp(previous, stepDeltaY, this.#stepSmoothingRate, time.rawDelta)
      // When a step reverses, the interpolated sample can still point toward the previous tread.
      let offset = MathUtils.clamp(
        smoothed,
        Math.min(previous, targetStepDeltaY),
        Math.max(previous, targetStepDeltaY),
      ) - stepDeltaY
      if (Math.abs(offset) < STEP_OFFSET_EPSILON)
        offset = 0
      else if (offset > 0 && this.#limitStepOffset)
        offset = this.#limitStepOffset(this.camera, offset)
      // Keep the applied offset in the smoothing history so it cannot rebound after a ceiling.
      this.#smoothedStepDeltaY = stepDeltaY + offset
      this.camera.position.y += offset
    }
  }

  dispose() {
    super.dispose()
    this.enabled = false
  }
}
