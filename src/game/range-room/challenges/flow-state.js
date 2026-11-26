const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const lerp = (a, b, t) => a + (b - a) * t
const expLerp = (a, b, t) => a * (b / a) ** clamp(t, 0, 1)
function smoothstep(t) {
  const x = clamp(t, 0, 1)
  return x * x * (3 - 2 * x)
}

export const flowConfig = Object.freeze({
  enterDuration: 0.8,
  exitWindow: 2.5,
  leaveDuration: 0.5,
  flowTimeScale: 0.25,
  maxBlurPx: 3.4,
  fovDelta: -7.5,
  baseVignette: 0.54,
  breathVignetteSwing: 0.095,
  flowBreathPeriod: 4.4,
  exitMinBreathPeriod: 1.85,
  inhaleFraction: 0.42,
  flowTickInterval: 1.0,
  exitMinTickInterval: 0.2,
  exitRiseRate: 10,
  exitRetreatRate: 4.2,
  droneFlowGain: 0.24,
  droneExitGain: 0.34,
  droneFlowPitch: 1.0,
  droneExitPitch: 1.85,
  droneFlowCutoff: 260,
  droneExitCutoff: 3200,
  worldNormalLowpass: 20000,
  worldFlowLowpass: 2200,
  bgmNormalCutoff: 2400,
  bgmFlowCutoff: 380,
})

function breathingWave(phase) {
  const split = flowConfig.inhaleFraction
  if (phase < split) {
    const t = phase / split
    return -Math.cos(t * Math.PI)
  }
  const t = (phase - split) / (1 - split)
  return Math.cos(t * Math.PI)
}

function neutralSnapshot() {
  return {
    phase: 'idle',
    timeScale: 1,
    exitIntensity: 0,
    blurPx: 0,
    fovOffset: 0,
    enemyGlow: 0,
    vignette: 0,
    breathPhase: 0,
    breathPeriod: flowConfig.flowBreathPeriod,
    tickInterval: flowConfig.flowTickInterval,
    droneGain: 0,
    dronePitch: flowConfig.droneFlowPitch,
    droneCutoff: flowConfig.droneFlowCutoff,
    worldLowpass: flowConfig.worldNormalLowpass,
    bgmCutoff: flowConfig.bgmNormalCutoff,
    screen: {
      active: 0,
      sweepStart: 0,
      sweepEnd: 0,
      edgeX: -1,
      edgeIntensity: 0,
      tintStrength: 0,
      vignette: 0,
      blurPx: 0,
    },
  }
}

/**
 * Pure presentation state machine for the 4-stage Flow state:
 * enter (0.8s) -> flow (0.25x) -> exit (last 2.5s, smooth kill-extend reversal) -> leave (0.5s).
 */
export class FlowStateMachine {
  #phase = 'idle'
  #enterElapsed = 0
  #leaveElapsed = 0
  #exitIntensity = 0
  #breathPhase = 0
  #breathStarted = false
  #tickPhase = 0
  #tickPolarity = 0
  #pendingEnter = false
  #pendingLeave = false
  #leaveStart = null
  #current = neutralSnapshot()

  get phase() { return this.#phase }
  get state() { return this.#current }

  enter() {
    this.#phase = 'enter'
    this.#enterElapsed = 0
    this.#leaveElapsed = 0
    this.#exitIntensity = 0
    this.#breathPhase = 0
    this.#breathStarted = false
    this.#tickPhase = 0.2
    this.#tickPolarity = 0
    this.#pendingEnter = true
    this.#pendingLeave = false
    this.#leaveStart = null
  }

  leave() {
    if (this.#phase === 'idle' || this.#phase === 'leave')
      return
    this.#leaveStart = {
      timeScale: this.#current.timeScale,
      blurPx: this.#current.blurPx,
      vignette: this.#current.vignette,
      fovOffset: this.#current.fovOffset,
      enemyGlow: this.#current.enemyGlow,
      droneGain: this.#current.droneGain,
      dronePitch: this.#current.dronePitch,
      droneCutoff: this.#current.droneCutoff,
      worldLowpass: this.#current.worldLowpass,
      bgmCutoff: this.#current.bgmCutoff,
      sweepEnd: Math.max(this.#current.screen.sweepEnd, 1.06),
    }
    this.#phase = 'leave'
    this.#leaveElapsed = 0
    this.#pendingLeave = true
  }

  reset() {
    this.#phase = 'idle'
    this.#enterElapsed = 0
    this.#leaveElapsed = 0
    this.#exitIntensity = 0
    this.#breathPhase = 0
    this.#breathStarted = false
    this.#tickPhase = 0
    this.#tickPolarity = 0
    this.#pendingEnter = false
    this.#pendingLeave = false
    this.#leaveStart = null
    this.#current = neutralSnapshot()
  }

  step(realDt, { inFlow = false, remaining = 0 } = {}) {
    const dt = Number.isFinite(realDt) && realDt > 0
      ? Math.min(realDt, 0.1)
      : 0
    const events = {
      entered: this.#pendingEnter,
      left: this.#pendingLeave,
      tick: null,
      breath: null,
    }
    this.#pendingEnter = false
    this.#pendingLeave = false

    if (this.#phase === 'idle') {
      this.#current = neutralSnapshot()
      return { state: this.#current, events }
    }

    if (this.#phase === 'enter') {
      if (!inFlow && this.#enterElapsed > 0) {
        this.leave()
        events.left = true
        this.#pendingLeave = false
      }
      else {
        this.#enterElapsed += dt
        const progress = clamp(this.#enterElapsed / flowConfig.enterDuration, 0, 1)
        const eased = smoothstep(progress)
        const sweepEnd = lerp(-0.04, 1.06, eased)
        const edgeIntensity = Math.sin(progress * Math.PI) ** 0.7
        const timeScale = lerp(1, flowConfig.flowTimeScale, eased)
        const fovOffset = flowConfig.fovDelta * eased
        const enemyGlow = eased
        const vignette = flowConfig.baseVignette * eased
        const droneGain = flowConfig.droneFlowGain * eased
        const worldLowpass = expLerp(flowConfig.worldNormalLowpass, flowConfig.worldFlowLowpass, eased)
        const bgmCutoff = expLerp(flowConfig.bgmNormalCutoff, flowConfig.bgmFlowCutoff, eased)
        this.#tickPhase += dt / flowConfig.flowTickInterval
        if (this.#tickPhase >= 1)
          this.#tickPhase -= Math.floor(this.#tickPhase)

        this.#current = {
          phase: 'enter',
          timeScale,
          exitIntensity: 0,
          blurPx: 0,
          fovOffset,
          enemyGlow,
          vignette,
          breathPhase: 0,
          breathPeriod: flowConfig.flowBreathPeriod,
          tickInterval: flowConfig.flowTickInterval,
          droneGain,
          dronePitch: flowConfig.droneFlowPitch,
          droneCutoff: flowConfig.droneFlowCutoff,
          worldLowpass,
          bgmCutoff,
          screen: {
            active: 1,
            sweepStart: -0.1,
            sweepEnd,
            edgeX: sweepEnd,
            edgeIntensity,
            tintStrength: 1,
            vignette,
            blurPx: 0,
          },
        }
        if (progress >= 1) {
          this.#phase = remaining <= flowConfig.exitWindow
            ? 'exit'
            : 'flow'
          this.#tickPhase = 0.85
        }
        return { state: this.#current, events }
      }
    }

    if (this.#phase === 'flow' || this.#phase === 'exit') {
      if (!inFlow) {
        this.leave()
        events.left = true
        this.#pendingLeave = false
      }
      else {
        const safeRemaining = Number.isFinite(remaining)
          ? Math.max(0, remaining)
          : 0
        const targetExit = clamp((flowConfig.exitWindow - safeRemaining) / flowConfig.exitWindow, 0, 1)
        const rate = targetExit >= this.#exitIntensity
          ? flowConfig.exitRiseRate
          : flowConfig.exitRetreatRate
        if (dt > 0) {
          const blend = 1 - Math.exp(-rate * dt)
          this.#exitIntensity += (targetExit - this.#exitIntensity) * blend
          if (targetExit === 0 && this.#exitIntensity < 1e-4)
            this.#exitIntensity = 0
        }
        this.#phase = targetExit > 0 || this.#exitIntensity > 0.005
          ? 'exit'
          : 'flow'

        const e = this.#exitIntensity
        const timeScale = lerp(flowConfig.flowTimeScale, 1, smoothstep(e))
        const blurPx = flowConfig.maxBlurPx * (e ** 1.35)
        const tickInterval = lerp(flowConfig.flowTickInterval, flowConfig.exitMinTickInterval, e)
        const breathPeriod = lerp(flowConfig.flowBreathPeriod, flowConfig.exitMinBreathPeriod, e)

        if (!this.#breathStarted) {
          this.#breathStarted = true
          this.#breathPhase = 0
          events.breath = 'inhale'
        }
        else if (dt > 0) {
          const prev = this.#breathPhase
          const next = prev + dt / breathPeriod
          if (next >= 1) {
            this.#breathPhase = next % 1
            events.breath = 'inhale'
          }
          else {
            this.#breathPhase = next
            if (prev < flowConfig.inhaleFraction && next >= flowConfig.inhaleFraction)
              events.breath = 'exhale'
          }
        }

        if (dt > 0) {
          this.#tickPhase += dt / tickInterval
          if (this.#tickPhase >= 1) {
            this.#tickPhase -= Math.floor(this.#tickPhase)
            events.tick = this.#tickPolarity === 0
              ? 'high'
              : 'low'
            this.#tickPolarity ^= 1
          }
        }

        const wave = breathingWave(this.#breathPhase)
        const vignette = flowConfig.baseVignette + flowConfig.breathVignetteSwing * wave + 0.08 * e
        const fovOffset = flowConfig.fovDelta * (1 - 0.25 * e)
        const enemyGlow = (1 + 0.08 * wave) * (1 - 0.15 * e)
        const droneGain = lerp(flowConfig.droneFlowGain, flowConfig.droneExitGain, e)
        const dronePitch = lerp(flowConfig.droneFlowPitch, flowConfig.droneExitPitch, e)
        const droneCutoff = expLerp(flowConfig.droneFlowCutoff, flowConfig.droneExitCutoff, e)
        const worldLowpass = expLerp(flowConfig.worldFlowLowpass, 12000, e)
        const bgmCutoff = expLerp(flowConfig.bgmFlowCutoff, 2000, e)

        this.#current = {
          phase: this.#phase,
          timeScale,
          exitIntensity: e,
          blurPx,
          fovOffset,
          enemyGlow,
          vignette,
          breathPhase: this.#breathPhase,
          breathPeriod,
          tickInterval,
          droneGain,
          dronePitch,
          droneCutoff,
          worldLowpass,
          bgmCutoff,
          screen: {
            active: 1,
            sweepStart: -0.1,
            sweepEnd: 1.1,
            edgeX: -1,
            edgeIntensity: 0,
            tintStrength: 1,
            vignette,
            blurPx,
          },
        }
        return { state: this.#current, events }
      }
    }

    // Leave phase (0.5s): the grade sweeps out to the right as everything returns to normal.
    this.#leaveElapsed += dt
    const progress = clamp(this.#leaveElapsed / flowConfig.leaveDuration, 0, 1)
    const eased = smoothstep(progress)
    const start = this.#leaveStart ?? neutralSnapshot()
    if (progress >= 1) {
      this.reset()
      return { state: this.#current, events }
    }
    const sweepStart = lerp(-0.04, 1.06, eased)
    const edgeIntensity = Math.sin(progress * Math.PI) * 0.55
    const timeScale = lerp(start.timeScale, 1, eased)
    const blurPx = lerp(start.blurPx, 0, eased)
    const vignette = lerp(start.vignette, 0, eased)
    const fovOffset = lerp(start.fovOffset, 0, eased)
    const enemyGlow = lerp(start.enemyGlow, 0, eased)
    const droneGain = lerp(start.droneGain, 0, eased)
    const worldLowpass = expLerp(start.worldLowpass, flowConfig.worldNormalLowpass, eased)
    const bgmCutoff = expLerp(start.bgmCutoff, flowConfig.bgmNormalCutoff, eased)

    this.#current = {
      phase: 'leave',
      timeScale,
      exitIntensity: 0,
      blurPx,
      fovOffset,
      enemyGlow,
      vignette,
      breathPhase: this.#breathPhase,
      breathPeriod: flowConfig.flowBreathPeriod,
      tickInterval: flowConfig.flowTickInterval,
      droneGain,
      dronePitch: start.dronePitch,
      droneCutoff: start.droneCutoff,
      worldLowpass,
      bgmCutoff,
      screen: {
        active: 1,
        sweepStart,
        sweepEnd: start.sweepEnd,
        edgeX: sweepStart,
        edgeIntensity,
        tintStrength: 1 - eased * 0.12,
        vignette,
        blurPx,
      },
    }
    return { state: this.#current, events }
  }
}
