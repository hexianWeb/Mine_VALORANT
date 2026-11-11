/** 可组合的能力。服务由外部注入；requires 是同一 GameObject 上的类型。 */
export class Component {
  static requires = []
  static phases = []
  owner = null
  enabled = true
  disposed = false

  get phases() { return this.constructor.phases }

  onAttach() {}
  tick() {}
  dispose() { this.disposed = true }
}
