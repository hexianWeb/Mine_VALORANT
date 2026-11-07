// @ts-check
import { Disposer } from './disposer.js'
import { EventEmitter } from './events.js'
import { Scheduler } from './scheduler.js'
import { Size } from './size.js'
import { Time } from './time.js'

/** @typedef {'idle' | 'running' | 'paused' | 'destroyed'} EngineState */

/**
 * @typedef {object} EngineEvents
 * @property {void} start idle -> running
 * @property {void} pause running -> paused; frame loop stops
 * @property {void} resume paused -> running; next frame delta is 0
 * @property {void} destroy any -> destroyed; cannot restart
 * @property {{ error: unknown }} error a system threw; engine is paused
 */

/**
 * @typedef {object} EngineOptions
 * @property {HTMLElement | null} [container] element measured by `size`; null = window
 * @property {number} [maxPixelRatio] default 2
 * @property {import('./time.js').TimeOptions} [time]
 * @property {boolean} [autoPauseOnHidden] pause when tab is hidden, resume when visible. default true
 */

/**
 * Engine kernel: lifecycle + frame loop. Knows nothing about three.js or gameplay.
 *
 * Lifecycle:  idle --start()--> running <--pause()/resume()--> paused --destroy()--> destroyed
 * - `pause()` stops the frame loop entirely (nothing updates or renders).
 *   For a pause menu that still renders, set `time.timeScale = 0` instead.
 *
 * Frame:  time.tick() -> scheduler.run() in PHASES order (input, gameplay, physics, animation, render)
 *
 * Cleanup on destroy(), in order:
 * 1. systems (reverse order, each `system.dispose()`) - systems free what they created (GPU, tweens, listeners)
 * 2. size listeners
 * 3. `engine.disposer` (LIFO) - register app-level things here: renderer, ResourceManager, UI
 *
 * @example
 * const engine = new Engine()
 * engine.addSystem('gameplay', { name: 'spin', update: e => { mesh.rotation.y += e.time.delta } })
 * engine.addSystem('render', { name: 'render', update: () => renderer.render(scene, camera) })
 * engine.disposer.add(renderer)
 * engine.start()
 */
export class Engine {
  /** @type {EngineState} */
  state = 'idle'
  time
  size
  scheduler = new Scheduler()
  /** @type {EventEmitter<EngineEvents>} */
  events = new EventEmitter()
  /** app-level cleanup, disposed last */
  disposer = new Disposer()

  /** @type {number | null} */
  #frameId = null
  #autoPaused = false
  #internal = new Disposer()

  /** @param {EngineOptions} [options] */
  constructor({ container = null, maxPixelRatio = 2, time, autoPauseOnHidden = true } = {}) {
    this.time = new Time(time)
    this.size = new Size({ container, maxPixelRatio })

    if (autoPauseOnHidden) {
      this.#internal.listen(document, 'visibilitychange', () => {
        if (document.hidden && this.state === 'running') {
          this.#autoPaused = true
          this.pause()
        }
        else if (!document.hidden && this.#autoPaused) {
          this.#autoPaused = false
          this.resume()
        }
      })
    }
  }

  /**
   * Register a system into a phase. See `System` in scheduler.js.
   * @template {import('./scheduler.js').System} T
   * @param {import('./scheduler.js').Phase} phase
   * @param {T} system
   * @returns {() => void} remove (and dispose) the system
   */
  addSystem(phase, system) {
    return this.scheduler.add(phase, system)
  }

  /** idle -> running */
  start() {
    this.#assertState('start', 'idle')
    this.state = 'running'
    this.time.resetDelta()
    this.#requestFrame()
    this.events.emit('start', undefined)
  }

  /** running -> paused. Stops the loop. */
  pause() {
    this.#assertState('pause', 'running')
    this.state = 'paused'
    this.#cancelFrame()
    this.events.emit('pause', undefined)
  }

  /** paused -> running. First frame after resume has delta 0. */
  resume() {
    this.#assertState('resume', 'paused')
    this.#autoPaused = false
    this.state = 'running'
    this.time.resetDelta()
    this.#requestFrame()
    this.events.emit('resume', undefined)
  }

  /** any -> destroyed. Idempotent. Engine cannot be restarted afterwards. */
  destroy() {
    if (this.state === 'destroyed')
      return
    this.#cancelFrame()
    this.state = 'destroyed'
    this.events.emit('destroy', undefined)
    this.scheduler.dispose()
    this.#internal.dispose()
    this.size.dispose()
    this.disposer.dispose()
    this.events.clear()
  }

  /**
   * Advance exactly one frame manually (tests, debugging, or offline stepping while paused).
   * @param {number} [nowMs] defaults to performance.now()
   */
  step(nowMs = performance.now()) {
    if (this.state === 'destroyed')
      return
    this.time.tick(nowMs)
    this.scheduler.run(this)
  }

  /** @param {number} now */
  #frame = (now) => {
    this.#frameId = null
    try {
      this.step(now)
    }
    catch (error) {
      console.error('[Engine] frame failed, engine paused', error)
      if (this.state === 'running')
        this.pause()
      this.events.emit('error', { error })
      return
    }
    if (this.state === 'running')
      this.#requestFrame()
  }

  #requestFrame() {
    if (this.#frameId === null)
      this.#frameId = requestAnimationFrame(this.#frame)
  }

  #cancelFrame() {
    if (this.#frameId !== null) {
      cancelAnimationFrame(this.#frameId)
      this.#frameId = null
    }
  }

  /**
   * @param {string} action
   * @param {EngineState} expected
   */
  #assertState(action, expected) {
    if (this.state !== expected)
      throw new Error(`[Engine] cannot ${action}() in state "${this.state}", expected "${expected}"`)
  }
}
