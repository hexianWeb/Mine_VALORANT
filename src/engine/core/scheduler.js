// @ts-check

/**
 * Update phases, executed in this order every frame:
 *
 * 1. input     read devices -> write intent (e.g. `input.moveX`)
 * 2. gameplay  game rules, AI, spawn/despawn; reads input
 * 3. physics   simulation; usually `fixedUpdate` only
 * 4. animation mixers, tweens driven by game time, follow cameras
 * 5. render    draw the frame; must not change simulation state
 *
 * @typedef {'input' | 'gameplay' | 'physics' | 'animation' | 'render'} Phase
 */

/** @type {readonly Phase[]} */
export const PHASES = Object.freeze([
  'input',
  'gameplay',
  'physics',
  'animation',
  'render',
])

/**
 * A system is a plain object. All hooks are optional.
 *
 * Per frame, inside its phase: `fixedUpdate` runs `time.fixedSteps` times (step = `time.fixedDelta`),
 * then `update` runs once (step = `time.delta`).
 *
 * Ownership: once added, the scheduler owns the system and calls `dispose()` on removal or engine destroy.
 *
 * @typedef {object} System
 * @property {string} name unique, used for lookup and error messages
 * @property {(engine: import('./engine.js').Engine) => void} [fixedUpdate]
 * @property {(engine: import('./engine.js').Engine) => void} [update]
 * @property {() => void} [dispose]
 */

/** Holds systems per phase and runs them in PHASES order. */
export class Scheduler {
  /** @type {Record<Phase, System[]>} */
  #phases = {
    input: [],
    gameplay: [],
    physics: [],
    animation: [],
    render: [],
  }

  /**
   * @template {System} T
   * @param {Phase} phase
   * @param {T} system
   * @returns {() => void} remove (and dispose) this system
   */
  add(phase, system) {
    if (!PHASES.includes(phase))
      throw new Error(`[Scheduler] unknown phase "${phase}", expected one of ${PHASES.join(', ')}`)
    if (this.get(system.name))
      throw new Error(`[Scheduler] system "${system.name}" already added`)
    this.#phases[phase].push(system)
    return () => this.remove(system.name)
  }

  /**
   * @param {string} name
   * @returns {System | undefined}
   */
  get(name) {
    for (const phase of PHASES) {
      const system = this.#phases[phase].find(s => s.name === name)
      if (system)
        return system
    }
    return undefined
  }

  /**
   * Remove and dispose a system. No-op if not found.
   * @param {string} name
   */
  remove(name) {
    for (const phase of PHASES) {
      const list = this.#phases[phase]
      const index = list.findIndex(s => s.name === name)
      if (index !== -1) {
        const [system] = list.splice(index, 1)
        system.dispose?.()
        return
      }
    }
  }

  /**
   * Run one frame. Systems added/removed during the frame take effect next frame.
   * @param {import('./engine.js').Engine} engine
   */
  run(engine) {
    const steps = engine.time.fixedSteps
    for (const phase of PHASES) {
      const list = [...this.#phases[phase]]
      for (let i = 0; i < steps; i++) {
        for (const system of list) system.fixedUpdate?.(engine)
      }
      for (const system of list) system.update?.(engine)
    }
  }

  /** Dispose all systems in reverse order (render first, input last). */
  dispose() {
    for (const phase of [...PHASES].reverse()) {
      const list = this.#phases[phase].splice(0).reverse()
      for (const system of list) {
        try {
          system.dispose?.()
        }
        catch (error) {
          console.error(`[Scheduler] dispose "${system.name}" failed`, error)
        }
      }
    }
  }
}
