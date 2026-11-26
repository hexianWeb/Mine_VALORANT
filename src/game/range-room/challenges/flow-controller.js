import { Component } from '../../../engine/runtime/function/framework/index.js'
import { FlowAudio } from './flow-audio.js'
import { FlowStateMachine } from './flow-state.js'

/**
 * Coordinates Flow visual & audio presentation in the motion phase so
 * CameraComponent (presentation), ParticleSystem (flush), RenderPipeline (render),
 * and TrainingBots all consume the same frame-coherent Flow state.
 */
export class FlowEffectComponent extends Component {
  static phases = ['motion']
  #challenge
  #player
  #render
  #particles
  #botAssets
  #machine = new FlowStateMachine()
  #flowAudio
  #worldTimeScale = 1

  constructor({ challenge, player = null, render = null, particles = null, botAssets = null, audio = null, resources = null, signal } = {}) {
    super()
    this.#challenge = challenge
    this.#player = player
    this.#render = render
    this.#particles = particles
    this.#botAssets = botAssets
    this.#flowAudio = audio && resources
      ? new FlowAudio({ audio, resources, signal })
      : null
  }

  get worldTimeScale() { return this.#worldTimeScale }

  onFlowEvent(type, reason) {
    if (this.disposed)
      return
    if (type === 'flow_enter') {
      this.#machine.enter()
    }
    else if (type === 'flow_exit') {
      if (reason === 'elapsed' || reason === 'completed')
        this.#machine.leave()
      else
        this.reset()
    }
  }

  tick({ time }) {
    if (this.disposed)
      return
    const realDt = (time.timeScale ?? 1) > 0
      ? (time.rawDelta ?? 0)
      : 0
    const trial = this.#challenge?.trial ?? null
    const inFlow = !!trial?.inFlow
    const remaining = trial?.remaining ?? 0
    const { state, events } = this.#machine.step(realDt, { inFlow, remaining })
    this.#worldTimeScale = state.timeScale
    this.#particles?.setTimeScale?.(state.timeScale)
    this.#player?.cameraComponent?.setFovOffset?.(state.fovOffset)
    this.#botAssets?.setFlowGlow?.(state.enemyGlow)
    this.#render?.setFlowEffect?.(state.screen)
    this.#flowAudio?.update(state, events, {
      worldDt: realDt * state.timeScale,
      trialActive: !!trial && this.#challenge.running,
    })
  }

  reset() {
    this.#machine.reset()
    this.#worldTimeScale = 1
    this.#particles?.setTimeScale?.(1)
    this.#player?.cameraComponent?.setFovOffset?.(0)
    this.#botAssets?.setFlowGlow?.(0)
    this.#render?.resetFlowEffect?.()
    this.#flowAudio?.reset()
  }

  snapshot() {
    const state = this.#machine.state
    return {
      phase: state.phase,
      timeScale: state.timeScale,
      exitIntensity: state.exitIntensity,
      blurPx: state.blurPx,
      fovOffset: state.fovOffset,
      enemyGlow: state.enemyGlow,
      vignette: state.vignette,
      breathPeriod: state.breathPeriod,
      tickInterval: state.tickInterval,
      samplesLoaded: this.#flowAudio?.sampleCount ?? 0,
    }
  }

  dispose() {
    if (this.disposed)
      return
    this.reset()
    this.#flowAudio?.dispose()
    super.dispose()
  }
}
