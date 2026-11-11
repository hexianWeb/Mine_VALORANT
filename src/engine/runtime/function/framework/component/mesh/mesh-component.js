import { Component } from '../component.js'
import { TransformComponent } from '../transform/transform-component.js'

/** 持有实例树及其释放回调；共享模板留在外部。 */
export class MeshComponent extends Component {
  static requires = [TransformComponent]
  static phases = ['presentation']

  constructor({ root, scene, release = () => {} }) {
    super()
    this.root = root
    this.scene = scene
    this.release = release
  }

  onAttach() {
    this.transform = this.owner.requireComponent(TransformComponent)
    this.sync(1)
    this.scene.add(this.root)
  }

  sync(alpha) {
    this.transform.samplePosition(alpha, this.root.position)
    this.root.quaternion.copy(this.transform.quaternion)
    this.root.scale.copy(this.transform.scale)
  }

  tick({ time }) {
    this.sync(time.alpha)
  }

  dispose() {
    if (this.disposed)
      return
    super.dispose()
    this.root.removeFromParent()
    this.release()
  }
}
