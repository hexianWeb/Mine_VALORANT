// @ts-check
import { Disposer } from './disposer.js'
import { EventEmitter } from './events.js'

/**
 * @typedef {object} SizeState
 * @property {number} width CSS pixels
 * @property {number} height CSS pixels
 * @property {number} pixelRatio clamped devicePixelRatio
 * @property {number} aspect width / height
 */

/**
 * Viewport size of a container element (default: window).
 * Emits `resize` with SizeState. Render/camera systems subscribe to it.
 *
 * @extends {EventEmitter<{ resize: SizeState }>}
 */
export class Size extends EventEmitter {
  width = 0
  height = 0
  pixelRatio = 1
  aspect = 1

  #container
  #maxPixelRatio
  #disposer = new Disposer()

  /**
   * @param {object} [options]
   * @param {HTMLElement | null} [options.container] element to measure; null = window
   * @param {number} [options.maxPixelRatio] default 2
   */
  constructor({ container = null, maxPixelRatio = 2 } = {}) {
    super()
    this.#container = container
    this.#maxPixelRatio = maxPixelRatio
    this.#measure()

    if (container) {
      const observer = new ResizeObserver(() => this.#update())
      observer.observe(container)
      this.#disposer.add(() => observer.disconnect())
    }
    else {
      this.#disposer.listen(window, 'resize', () => this.#update())
    }
  }

  /** @returns {SizeState} */
  get state() {
    return {
      width: this.width,
      height: this.height,
      pixelRatio: this.pixelRatio,
      aspect: this.aspect,
    }
  }

  #measure() {
    const el = this.#container
    this.width = Math.max(1, el ? el.clientWidth : window.innerWidth)
    this.height = Math.max(1, el ? el.clientHeight : window.innerHeight)
    this.pixelRatio = Math.min(window.devicePixelRatio, this.#maxPixelRatio)
    this.aspect = this.width / this.height
  }

  #update() {
    this.#measure()
    this.emit('resize', this.state)
  }

  dispose() {
    this.#disposer.dispose()
    this.clear()
  }
}
