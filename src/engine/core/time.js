// @ts-check

/**
 * @typedef {object} TimeOptions
 * @property {number} [fixedDelta] fixed step in seconds, default 1/60
 * @property {number} [maxDelta] clamp for a single frame delta in seconds, default 0.1 (avoids huge jumps after lag)
 * @property {number} [maxFixedSteps] max fixed steps per frame, default 5 (avoids spiral of death)
 */

/**
 * Game clock. All values are in SECONDS.
 *
 * - `delta`        scaled frame delta, use in `update()`
 * - `fixedDelta`   constant step, use in `fixedUpdate()`
 * - `elapsed`      scaled game time, does not advance while paused
 * - `alpha`        0..1 leftover of the fixed accumulator, for render interpolation
 * - `timeScale`    0 = frozen gameplay, 1 = normal, 2 = double speed
 *
 * Owned and driven by Engine. Systems only read it.
 */
export class Time {
  /** scaled frame delta (s) */
  delta = 0
  /** unscaled frame delta (s), e.g. for UI animation during slow-motion */
  rawDelta = 0
  /** scaled game time since start (s), excludes paused time */
  elapsed = 0
  /** frames ticked since start */
  frame = 0
  timeScale = 1
  /** fixed step (s) */
  fixedDelta
  /** fixed steps to run this frame, set by tick() */
  fixedSteps = 0
  /** fixed accumulator leftover ratio 0..1 */
  alpha = 0

  #maxDelta
  #maxFixedSteps
  #accumulator = 0
  /** @type {number | null} */
  #last = null

  /** @param {TimeOptions} [options] */
  constructor({ fixedDelta = 1 / 60, maxDelta = 0.1, maxFixedSteps = 5 } = {}) {
    this.fixedDelta = fixedDelta
    this.#maxDelta = maxDelta
    this.#maxFixedSteps = maxFixedSteps
  }

  /**
   * Advance the clock. Called once per frame by Engine.
   * @param {number} nowMs timestamp from requestAnimationFrame / performance.now()
   */
  tick(nowMs) {
    const raw = this.#last === null
      ? 0
      : (nowMs - this.#last) / 1000
    this.#last = nowMs

    this.rawDelta = Math.min(Math.max(raw, 0), this.#maxDelta)
    this.delta = this.rawDelta * this.timeScale
    this.elapsed += this.delta
    this.frame++

    this.#accumulator += this.delta
    let steps = Math.floor(this.#accumulator / this.fixedDelta)
    if (steps > this.#maxFixedSteps) {
      steps = this.#maxFixedSteps
      this.#accumulator = 0
    }
    else {
      this.#accumulator -= steps * this.fixedDelta
    }
    this.fixedSteps = steps
    this.alpha = this.#accumulator / this.fixedDelta
  }

  /** Forget the last timestamp so the next frame has delta 0 (call on resume). */
  resetDelta() {
    this.#last = null
  }
}
