import { EventEmitter } from '../../../core/events.js'

/** 持有一个活动关卡，并串行化它的异步加载生命周期。 */
export class WorldManager {
  events = new EventEmitter()
  #active = null
  #pending = null
  state = 'idle'

  get activeLevel() {
    return this.#active?.level ?? null
  }

  async loadLevel(factory, { signal, onProgress } = {}) {
    if (this.state === 'disposed' || this.#pending || this.#active)
      throw new Error('[WorldManager] Unload the current level and await loading before another load')
    signal?.throwIfAborted()
    const controller = new AbortController()
    const token = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal
    const level = factory()
    if (!level || typeof level.load !== 'function' || typeof level.dispose !== 'function')
      throw new Error('[WorldManager] Factory must synchronously return a loadable, disposable level')
    const record = {
      level,
      controller,
      released: false,
      done: Promise.withResolvers(),
    }
    this.#pending = record
    this.state = 'loading'
    try {
      await level.load({ signal: token, onProgress })
      token.throwIfAborted()
      this.#active = record
      this.state = 'ready'
      this.events.emit('load', level)
      token.throwIfAborted()
      return level
    }
    catch (error) {
      if (this.#active === record)
        this.#active = null
      this.#release(record)
      throw error
    }
    finally {
      this.#pending = null
      if (this.state !== 'disposed' && !this.#active)
        this.state = 'idle'
      record.done.resolve()
    }
  }

  async unloadLevel() {
    const pending = this.#pending
    this.#clear()
    // 等到上一次加载的迟到结果落定后，才允许新的加载。
    await pending?.done.promise
  }

  tickComponents(phase, frame) {
    this.activeLevel?.tickComponents(phase, frame)
  }

  dispose() {
    if (this.state === 'disposed')
      return
    this.state = 'disposed'
    try {
      this.#clear()
    }
    finally {
      this.events.clear()
    }
  }

  #clear() {
    const active = this.#active
    this.#active = null
    if (this.#pending) {
      this.#pending.controller.abort()
      this.#release(this.#pending)
    }
    if (active)
      this.#release(active)
    if (this.state !== 'disposed' && !this.#pending)
      this.state = 'idle'
  }

  #release(record) {
    if (record.released)
      return
    record.released = true
    try {
      this.events.emit('unload', record.level)
    }
    finally {
      record.level.dispose()
    }
  }
}
