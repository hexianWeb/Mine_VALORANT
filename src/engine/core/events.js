// @ts-check

/**
 * Minimal typed event emitter.
 *
 * @template {Record<string, any>} Events  map of event name -> payload type
 * @example
 * // @type {EventEmitter<{ resize: { width: number, height: number } }>}
 * const events = new EventEmitter()
 * const off = events.on('resize', ({ width }) => {})
 * off() // unsubscribe
 */
export class EventEmitter {
  /** @type {Map<keyof Events, Set<(payload: any) => void>>} */
  #handlers = new Map()

  /**
   * @template {keyof Events} K
   * @param {K} type
   * @param {(payload: Events[K]) => void} handler
   * @returns {() => void} unsubscribe function
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
   * @returns {() => void} unsubscribe function
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

  /** Remove all handlers. */
  clear() {
    this.#handlers.clear()
  }
}
