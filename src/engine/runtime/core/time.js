// @ts-check

/**
 * @typedef {object} TimeOptions
 * @property {number} [fixedDelta] 固定步长（秒），默认 1/60
 * @property {number} [maxDelta] 未缩放帧间隔上限（秒），默认 0.1
 * @property {number} [maxFixedSteps] 每帧最多固定步数，默认 5
 */

/** 游戏时钟。Engine 唯一推进；组件和观察者读取 snapshot() 的标量快照。 */
export class Time {
  delta = 0
  rawDelta = 0
  unclippedDelta = 0
  clippedWallTime = 0
  clockRevision = 0
  elapsed = 0
  frame = 0
  fixedSteps = 0
  completedFixedSteps = 0
  fixedTick = 0
  droppedSimulationTime = 0
  alpha = 0

  #timeScale = 1
  #frameTimeScale = 1
  #fixedDelta
  #maxDelta
  #maxFixedSteps
  #accumulator = 0
  /** @type {number | null} */
  #last = null

  /** @param {TimeOptions} [options] 固定步与追帧上限。 */
  constructor({ fixedDelta = 1 / 60, maxDelta = 0.1, maxFixedSteps = 5 } = {}) {
    if (!Number.isFinite(fixedDelta) || fixedDelta <= 0 || !Number.isFinite(maxDelta) || maxDelta <= 0
      || !Number.isSafeInteger(maxFixedSteps) || maxFixedSteps < 1) {
      throw new Error('[Time] Expected positive finite steps and a positive integer maxFixedSteps')
    }
    this.#fixedDelta = fixedDelta
    this.#maxDelta = maxDelta
    this.#maxFixedSteps = maxFixedSteps
  }

  get fixedDelta() { return this.#fixedDelta }
  get fixedElapsed() { return this.fixedTick * this.fixedDelta }
  get timeScale() { return this.#timeScale }
  set timeScale(value) {
    if (!Number.isFinite(value) || value < 0)
      throw new Error('[Time] timeScale must be finite and nonnegative')
    this.#timeScale = value
  }

  /** @param {number} nowMs RAF / performance.now() 时间戳，单位毫秒。 */
  tick(nowMs) {
    if (!Number.isFinite(nowMs))
      throw new TypeError('[Time] Expected a finite timestamp')
    const raw = this.#last === null
      ? 0
      : (nowMs - this.#last) / 1000
    this.#last = nowMs
    this.#frameTimeScale = this.timeScale
    this.unclippedDelta = Math.max(raw, 0)
    this.rawDelta = Math.min(Math.max(raw, 0), this.#maxDelta)
    this.clippedWallTime = this.unclippedDelta - this.rawDelta
    this.delta = this.rawDelta * this.#frameTimeScale
    this.elapsed += this.delta
    this.frame++

    const total = this.#accumulator + this.delta
    // 容忍以毫秒累计的 60 Hz 时间戳带来的浮点边界误差。
    const wholeSteps = Math.floor(total / this.fixedDelta + 1e-10)
    this.fixedSteps = Math.min(wholeSteps, this.#maxFixedSteps)
    this.completedFixedSteps = 0
    this.droppedSimulationTime = (wholeSteps - this.fixedSteps) * this.fixedDelta
    this.#accumulator = Math.max(0, total - wholeSteps * this.fixedDelta)
    this.alpha = this.#accumulator / this.fixedDelta
  }

  /** @param {number} stepIndex 已正常完成 fixed 和 postPhysics 的本帧子步索引。 */
  completeFixedStep(stepIndex) {
    this.#assertNextStep(stepIndex)
    this.completedFixedSteps++
    this.fixedTick++
  }

  /**
   * 固定阶段使用将执行的步编号；其他阶段读取已完成的模拟时钟。
   * @param {number | null} [stepIndex] 本帧子步索引，非固定阶段为 null。
   * @returns 不持有可变 Time 实例的只读标量快照。
   */
  snapshot(stepIndex = null) {
    if (stepIndex !== null)
      this.#assertNextStep(stepIndex)
    const fixedTick = this.fixedTick + Number(stepIndex !== null)
    return Object.freeze({
      frame: this.frame,
      delta: this.delta,
      rawDelta: this.rawDelta,
      unclippedDelta: this.unclippedDelta,
      clippedWallTime: this.clippedWallTime,
      clockRevision: this.clockRevision,
      elapsed: this.elapsed,
      timeScale: this.#frameTimeScale,
      fixedDelta: this.fixedDelta,
      fixedSteps: this.fixedSteps,
      completedFixedSteps: this.completedFixedSteps,
      fixedTick,
      fixedElapsed: fixedTick * this.fixedDelta,
      presentationTime: Math.max(0, this.fixedElapsed - this.fixedDelta + this.alpha * this.fixedDelta),
      fixedStepIndex: stepIndex,
      droppedSimulationTime: this.droppedSimulationTime,
      alpha: this.alpha,
    })
  }

  /** 忘掉上一帧时间戳，恢复后的第一帧 delta 为 0，保留插值余量。 */
  resetDelta() {
    this.#last = null
    this.clockRevision++
  }

  /** @param {number} stepIndex 本帧尚未提交的下一子步索引。 */
  #assertNextStep(stepIndex) {
    if (stepIndex !== this.completedFixedSteps || stepIndex >= this.fixedSteps)
      throw new Error(`[Time] Invalid fixed step ${stepIndex}`)
  }
}
