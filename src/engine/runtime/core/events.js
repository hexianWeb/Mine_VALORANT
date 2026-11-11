// @ts-check

/**
 * 最小的带类型事件发射器。
 *
 * @template {Record<string, any>} Events  事件名到载荷类型的映射
 * @example
 * // @type {EventEmitter<{ resize: { width: number, height: number } }>}
 * const events = new EventEmitter()
 * const off = events.on('resize', ({ width }) => {})
 * off() // 取消订阅
 */
export class EventEmitter {
  /** @type {Map<keyof Events, Set<(payload: any) => void>>} */
  #handlers = new Map()

  /**
   * @template {keyof Events} K
   * @param {K} type
   * @param {(payload: Events[K]) => void} handler
   * @returns {() => void} 取消订阅函数
   */
  on(type, handler) {
    let set = this.#handlers.get(type)
    if (!set) {
      set = new Set()
      this.#handlers.set(type, set)
    }
    set.add(handler)
    return () => this.off(type, handler)
  }

  /**
   * @template {keyof Events} K
   * @param {K} type
   * @param {(payload: Events[K]) => void} handler
   * @returns {() => void} 取消订阅函数
   */
  once(type, handler) {
    const off = this.on(type, (payload) => {
      off()
      handler(payload)
    })
    return off
  }

  /**
   * @template {keyof Events} K
   * @param {K} type
   * @param {(payload: Events[K]) => void} handler
   */
  off(type, handler) {
    this.#handlers.get(type)?.delete(handler)
  }

  /**
   * @template {keyof Events} K
   * @param {K} type
   * @param {Events[K]} payload
   */
  emit(type, payload) {
    const set = this.#handlers.get(type)
    if (!set)
      return
    for (const handler of [...set]) handler(payload)
  }

  /** 移除全部处理函数。 */
  clear() {
    this.#handlers.clear()
  }
}
