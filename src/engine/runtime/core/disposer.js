// @ts-check

/**
 * 可以被清理的对象：
 * - 函数
 * - 带 `dispose()` 的对象（three.js 的 geometry/material/texture/renderer、Tweakpane 等）
 * - 带 `kill()` 的对象（GSAP tween/timeline）
 *
 * @typedef {(() => void) | { dispose: () => void } | { kill: () => void }} Disposable
 */

/**
 * 清理登记表。规则：谁创建资源，谁把它登记到自己的 Disposer。
 * `dispose()` 按登记的逆序（LIFO）执行全部清理，且只执行一次。
 *
 * @example
 * const disposer = new Disposer()
 * disposer.listen(window, 'keydown', onKey)
 * disposer.timeout(() => {}, 1000)
 * const geometry = disposer.add(new THREE.BoxGeometry())
 * const tween = disposer.add(gsap.to(mesh.position, { x: 1 }))
 * disposer.dispose()
 */
export class Disposer {
  /** @type {Disposable[]} */
  #items = []
  #disposed = false

  get disposed() {
    return this.#disposed
  }

  /**
   * 登记一个可清理项。返回原对象，方便内联使用。
   * 若已经 dispose，则立即清理该项。
   * @template {Disposable} T
   * @param {T} item
   * @returns {T} 原对象
   */
  add(item) {
    if (this.#disposed)
      runDisposable(item)
    else
      this.#items.push(item)
    return item
  }

  /**
   * addEventListener，并在 dispose 时自动 removeEventListener。
   * @param {EventTarget} target
   * @param {string} type
   * @param {EventListenerOrEventListenerObject} handler
   * @param {AddEventListenerOptions | boolean} [options]
   * @returns {() => void} 提前移除监听
   */
  listen(target, type, handler, options) {
    target.addEventListener(type, handler, options)
    return this.add(() => target.removeEventListener(type, handler, options))
  }

  /**
   * 真实时间的 timeout（不受游戏暂停影响）。玩法逻辑优先放在系统的游戏时间里。
   * @param {() => void} fn
   * @param {number} ms
   * @returns {() => void} 提前取消
   */
  timeout(fn, ms) {
    const id = setTimeout(fn, ms)
    return this.add(() => clearTimeout(id))
  }

  /**
   * @param {() => void} fn
   * @param {number} ms
   * @returns {() => void} 提前取消
   */
  interval(fn, ms) {
    const id = setInterval(fn, ms)
    return this.add(() => clearInterval(id))
  }

  /** 按逆序执行全部清理。可安全多次调用。 */
  dispose() {
    if (this.#disposed)
      return
    this.#disposed = true
    const items = this.#items.splice(0).reverse()
    for (const item of items) {
      try {
        runDisposable(item)
      }
      catch (error) {
        console.error('[Disposer] cleanup failed', error)
      }
    }
  }
}

/** @param {Disposable} item */
function runDisposable(item) {
  if (typeof item === 'function')
    item()
  else if ('dispose' in item)
    item.dispose()
  else if ('kill' in item)
    item.kill()
}
