// @ts-check
import { Disposer } from '../core/disposer.js'
import { EventEmitter } from '../core/events.js'

/**
 * @typedef {object} SizeState
 * @property {number} width CSS 像素
 * @property {number} height CSS 像素
 * @property {number} pixelRatio 钳制后的 devicePixelRatio
 * @property {number} aspect 宽 / 高
 */

/**
 * 容器元素的视口尺寸（默认 window）。
 * 以 SizeState 发出 `resize`。渲染与相机系统订阅它。
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
   * @param {HTMLElement | null} [options.container] 要测量的元素；null 表示 window
   * @param {number} [options.maxPixelRatio] 默认 2
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
