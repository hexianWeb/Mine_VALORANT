// @ts-check

/**
 * Anything that can be cleaned up:
 * - a function
 * - an object with `dispose()` (three.js geometry/material/texture/renderer, Tweakpane, ...)
 * - an object with `kill()` (GSAP tween/timeline)
 *
 * @typedef {(() => void) | { dispose: () => void } | { kill: () => void }} Disposable
 */

/**
 * Cleanup registry. Rule: whoever creates a resource registers it on its own Disposer.
 * `dispose()` runs everything in reverse registration order (LIFO), once.
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
   * Register a disposable. Returns the same item for inline use.
   * If already disposed, the item is disposed immediately.
   * @template {Disposable} T
   * @param {T} item
   * @returns {T} item
   */
  add(item) {
    if (this.#disposed)
      runDisposable(item)
    else
      this.#items.push(item)
    return item
  }

  /**
   * addEventListener + automatic removeEventListener on dispose.
   * @param {EventTarget} target
   * @param {string} type
   * @param {EventListenerOrEventListenerObject} handler
   * @param {AddEventListenerOptions | boolean} [options]
   * @returns {() => void} remove the listener early
   */
  listen(target, type, handler, options) {
    target.addEventListener(type, handler, options)
    return this.add(() => target.removeEventListener(type, handler, options))
  }

  /**
   * Real-time timeout (not affected by game pause). Prefer game-time logic in systems for gameplay.
   * @param {() => void} fn
   * @param {number} ms
   * @returns {() => void} cancel early
   */
  timeout(fn, ms) {
    const id = setTimeout(fn, ms)
    return this.add(() => clearTimeout(id))
  }

  /**
   * @param {() => void} fn
   * @param {number} ms
   * @returns {() => void} cancel early
   */
  interval(fn, ms) {
    const id = setInterval(fn, ms)
    return this.add(() => clearInterval(id))
  }

  /** Run all cleanups in reverse order. Safe to call multiple times. */
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

/**
 * Release GPU resources of an Object3D tree (geometries, materials, textures on materials).
 * Does not remove the object from its parent.
 * Only for trees whose geometry/material you fully own (created in code, or a ResourceManager template).
 * Never call on `resources.instantiate()` results: they share data with the template.
 *
 * @param {import('three/webgpu').Object3D} root
 */
export function disposeObject3D(root) {
  root.traverse((/** @type {any} */ object) => {
    object.geometry?.dispose()
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material]
    for (const material of materials) {
      if (!material)
        continue
      for (const value of Object.values(material)) {
        if (value?.isTexture)
          value.dispose()
      }
      material.dispose()
    }
  })
}
