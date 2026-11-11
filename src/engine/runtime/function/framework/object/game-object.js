import { MathUtils } from 'three/webgpu'
import { validateComponentPhases } from '../component/tick-phases.js'

/** 静态与动态内容共用同一对象模型；mobility 不会关掉行为。 */
export class GameObject {
  #components = new Map()
  disposed = false
  active = true
  level = null

  constructor({ name = '', mobility = 'dynamic' } = {}) {
    if (!['static', 'dynamic'].includes(mobility))
      throw new Error(`[GameObject] Invalid mobility: ${mobility}`)
    this.id = MathUtils.generateUUID()
    this.name = name
    this.mobility = mobility
  }

  get components() {
    return [
      ...this.#components.values(),
    ]
  }

  addComponent(component) {
    if (this.disposed || component.disposed || component.owner || this.#components.has(component.constructor))
      throw new Error('[GameObject] Disposed object, owned component or duplicate component type')
    validateComponentPhases(component)
    // 依赖必须已经存在。插入顺序也是挂载顺序。
    for (const type of component.constructor.requires)
      this.requireComponent(type)
    component.owner = this
    this.#components.set(component.constructor, component)
    try {
      if (this.level)
        component.onAttach()
    }
    catch (error) {
      this.removeComponent(component.constructor)
      throw error
    }
    return component
  }

  getComponent(type) {
    return this.#components.get(type)
  }

  requireComponent(type) {
    const component = this.getComponent(type)
    if (!component)
      throw new Error(`[GameObject] Missing required component: ${type.name}`)
    return component
  }

  removeComponent(type) {
    const component = this.#components.get(type)
    if (!component)
      return
    if (!this.disposed && this.components.some(other => other.constructor.requires.includes(type)))
      throw new Error(`[GameObject] Cannot remove required component: ${type.name}`)
    this.#components.delete(type)
    try {
      component.dispose()
    }
    finally {
      component.disposed = true
      component.owner = null
    }
  }

  dispose() {
    if (this.disposed)
      return
    if (this.level) {
      this.level.removeObject(this.id)
      return
    }
    this.disposed = true
    for (const component of this.components.reverse()) {
      try {
        this.removeComponent(component.constructor)
      }
      catch (error) {
        console.error('[GameObject] component cleanup failed', error)
      }
    }
  }
}
