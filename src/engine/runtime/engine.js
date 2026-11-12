import { EventEmitter } from './core/events.js'
import { Time } from './core/time.js'

/** 显式的帧编排。注入的服务由 RuntimeContext 持有。 */
export class Engine {
  state = 'idle'
  events = new EventEmitter()
  #frameId = null
  #autoPaused = false
  #offVisibility
  #stepping = false
  #logicalTicking = false
  #rendering = false
  #logicalFrame = 0
  #completedFrame = 0

  constructor({ world, render, audio = null, listener = null, frameDriver = null, time = new Time(), autoPauseOnHidden = true } = {}) {
    this.world = world
    this.render = render
    this.audio = audio
    this.listener = listener
    this.frameDriver = frameDriver
    this.time = time
    this.frame = Object.freeze({
      time: time.snapshot(),
    })
    if (autoPauseOnHidden) {
      this.#offVisibility = frameDriver?.onVisibility?.((hidden) => {
        if (hidden && this.state === 'running') {
          this.pause()
          this.#autoPaused = true
        }
        else if (!hidden && this.#autoPaused && this.state === 'paused') {
          this.resume()
        }
      })
    }
  }

  start() {
    this.#assertState('start', 'idle')
    this.#run()
    this.events.emit('start')
  }

  pause() {
    this.#assertState('pause', 'running')
    this.state = 'paused'
    this.#autoPaused = false
    this.#cancelFrame()
    this.audio?.setPaused(true)
    this.events.emit('pause')
  }

  resume() {
    this.#assertState('resume', 'paused')
    this.#run()
    this.audio?.setPaused(false)
    this.events.emit('resume')
  }

  step(nowMs = performance.now()) {
    if (this.state === 'destroyed')
      return
    if (this.#stepping || this.#logicalTicking || this.#rendering)
      throw new Error('[Engine] Cannot reenter step()')
    this.#stepping = true
    try {
      this.time.tick(nowMs)
      this.logicalTick()
      if (this.state !== 'destroyed')
        this.render?.swapLogicRenderData?.()
      this.rendererTick()
      if (this.state !== 'destroyed')
        this.events.emit('frame', this.frame)
    }
    finally {
      this.#stepping = false
    }
  }

  logicalTick() {
    if (this.state === 'destroyed')
      return
    if (this.#logicalTicking || this.#rendering)
      throw new Error('[Engine] Cannot reenter logicalTick()')
    if (this.time.frame <= this.#logicalFrame)
      throw new Error(`[Engine] Frame ${this.time.frame} has no unconsumed logical tick`)
    this.#logicalFrame = this.time.frame
    this.#logicalTicking = true
    try {
      this.frame = Object.freeze({
        time: this.time.snapshot(),
      })
      // 应用自有的工具可以消费输入，运行时不必导入 editor。
      this.events.emit('input', this.frame)
      if (this.state === 'destroyed')
        return
      this.world?.tickComponents('input', this.frame)
      const fixedSteps = this.frame.time.fixedSteps
      for (let step = 0; step < fixedSteps && this.state !== 'destroyed'; step++) {
        const fixedFrame = Object.freeze({
          time: this.time.snapshot(step),
        })
        this.world?.tickComponents('fixed', fixedFrame)
        if (this.state !== 'destroyed')
          this.world?.tickComponents('postPhysics', fixedFrame)
        if (this.state !== 'destroyed')
          this.time.completeFixedStep(step)
      }
      this.frame = Object.freeze({
        time: this.time.snapshot(),
      })
      if (this.state !== 'destroyed')
        this.world?.tickComponents('motion', this.frame)
      if (this.state !== 'destroyed')
        this.world?.tickComponents('presentation', this.frame)
      if (this.state !== 'destroyed')
        this.audio?.flush(this.frame.time, this.listener?.())
      if (this.state !== 'destroyed')
        this.#completedFrame = this.#logicalFrame
    }
    finally {
      this.#logicalTicking = false
    }
  }

  rendererTick() {
    if (this.state === 'destroyed')
      return
    if (this.#logicalTicking || this.#rendering || this.time.frame !== this.#completedFrame)
      throw new Error('[Engine] Rendering requires a completed logical frame and cannot reenter')
    this.#rendering = true
    try {
      this.render?.update(this.frame)
    }
    finally {
      this.#rendering = false
    }
  }

  destroy() {
    if (this.state === 'destroyed')
      return
    this.state = 'destroyed'
    this.#cancelFrame()
    this.audio?.invalidate()
    this.#offVisibility?.()
    try {
      this.events.emit('destroy')
    }
    finally {
      this.events.clear()
    }
  }

  dispose() {
    this.destroy()
  }

  #run() {
    if (!this.frameDriver)
      throw new Error('[Engine] start/resume requires a frame driver; use step() for manual frames')
    this.state = 'running'
    this.#autoPaused = false
    this.time.resetDelta()
    this.#requestFrame()
  }

  #onFrame = (now) => {
    this.#frameId = null
    try {
      this.step(now)
    }
    catch (error) {
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
      this.#frameId = this.frameDriver.request(this.#onFrame)
  }

  #cancelFrame() {
    if (this.#frameId !== null) {
      this.frameDriver.cancel(this.#frameId)
      this.#frameId = null
    }
  }

  #assertState(action, expected) {
    if (this.state !== expected)
      throw new Error(`[Engine] cannot ${action}() in state "${this.state}", expected "${expected}"`)
  }
}
