import { Disposer } from '../../../core/disposer.js'
import { createTickContext, validateComponentPhases } from '../component/tick-phases.js'

/** 持有对象和关卡本地资源。具体关卡实现异步 load()。 */
export class Level {
  #ticking = false
  objects = new Map()
  disposer = new Disposer()
  disposed = false

  constructor({ scene }) {
    this.scene = scene
  }

  addObject(object) {
    if (this.disposed || object.disposed || object.level || this.objects.has(object.id))
      throw new Error('[Level] Cannot attach a disposed or already-owned object')
    const components = object.components
    for (const component of components) validateComponentPhases(component)
    object.level = this
    this.objects.set(object.id, object)
    try {
      for (const component of components) component.onAttach()
    }
    catch (error) {
      this.removeObject(object.id)
      throw error
    }
    return object
  }

  removeObject(id) {
    const object = this.objects.get(id)
    if (!object)
      return
    this.objects.delete(id)
    object.level = null
    object.dispose()
  }

  tickComponents(phase, frame) {
    if (this.disposed)
      return
    if (this.#ticking)
      throw new Error('[Level] Cannot reenter component dispatch')
    const context = createTickContext(phase, frame)
    this.#ticking = true
    try {
      // 先扫描全部 GO，收集整个阶段的成员，再执行任何组件回调。
      // 使用实例 phases，让 fixed/frame Motor 各自进入正确的阶段。
      const batch = []
      for (const object of this.objects.values()) {
        for (const component of object.components) {
          if (component.phases.includes(phase))
            batch.push(component)
        }
      }
      for (const component of batch) {
        const owner = component.owner
        if (!this.disposed && !component.disposed && component.enabled && owner?.active && owner.level === this)
          component.tick(context)
      }
    }
    finally {
      this.#ticking = false
    }
  }

  dispose() {
    if (this.disposed)
      return
    this.disposed = true
    // 活动集合拥有 GO，移除的对象不在长寿命 Disposer 中留下清理闭包。
    // 实例先于其引用的关卡共享资源释放。
    const ids = [
      ...this.objects.keys(),
    ]
    for (const id of ids.reverse()) this.removeObject(id)
    this.disposer.dispose()
  }
}
