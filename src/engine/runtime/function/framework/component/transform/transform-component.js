import { Quaternion, Vector3 } from 'three/webgpu'
import { Component } from '../component.js'

/** 权威的世界姿态。表现采样从不修改模拟状态。 */
export class TransformComponent extends Component {
  constructor({ position = new Vector3(), quaternion = new Quaternion(), scale = new Vector3(1, 1, 1) } = {}) {
    super()
    this.position = position.clone()
    this.quaternion = quaternion.clone()
    this.scale = scale.clone()
    this.previousPosition = position.clone()
    this.interpolate = false
  }

  capturePosition() {
    this.previousPosition.copy(this.position)
  }

  teleport(position) {
    this.position.copy(position)
    this.capturePosition()
  }

  samplePosition(alpha, target = new Vector3()) {
    return this.interpolate
      ? target.lerpVectors(this.previousPosition, this.position, alpha)
      : target.copy(this.position)
  }
}
