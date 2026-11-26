import { flowConfig } from './flow-state.js'

const zoomSamples = Object.freeze({
  in: '/audio/zoom/in.wav',
  out: '/audio/zoom/out.wav',
  tick: '/audio/zoom/tick.wav',
  tick2: '/audio/zoom/tick2.wav',
  breath: '/audio/zoom/breath.wav',
  bg: '/audio/zoom/bg.wav',
})

// A minor / Dorian moody arpeggio (Hz) driven by worldDt = realDt * timeScale during Haoqi Trial.
const bgmArpNotes = Object.freeze([
  110.0,
  130.81,
  164.81,
  196.0,
  220.0,
  196.0,
  164.81,
  146.83,
])
const bgmStepWorldSec = 0.24

let nextScope = 0

function smoothParam(param, value, now, timeConstant = 0.06) {
  if (!param)
    return
  if (typeof param.setTargetAtTime === 'function')
    param.setTargetAtTime(value, now, timeConstant)
  else
    param.setValueAtTime(value, now)
}

function rampParam(param, value, at) {
  if (!param)
    return
  if (typeof param.linearRampToValueAtTime === 'function')
    param.linearRampToValueAtTime(value, at)
  else
    param.setValueAtTime(value, at)
}

/**
 * WebAudio presentation for the Flow state using `/audio/zoom/*.wav` assets
 * plus a subtle Haoqi-trial BGM arpeggio driven by worldDt = realDt * timeScale.
 */
export class FlowAudio {
  #audio
  #resources
  #scope = `flow-audio:${++nextScope}`
  #buffers = new Map()
  #loadedResourceNames = new Set()
  #channel = null
  #drone = null
  #shimmer = null
  #bgmBus = null
  #bgmStepAccum = 0
  #bgmNoteIndex = 0
  #activeBreath = null
  #activeOneShots = new Set()
  #disposed = false

  constructor({ audio = null, resources = null, signal } = {}) {
    this.#audio = audio
    this.#resources = resources
    this.ready = audio && resources
      ? this.#preload(signal)
      : Promise.resolve()
  }

  get sampleCount() { return this.#buffers.size }

  async #preload(signal) {
    // Load crisp short cues first; decode the 46MB drone bed right after and release raw bytes immediately.
    const fast = ['in', 'out', 'tick', 'tick2', 'breath']
    await Promise.all(fast.map(key => this.#loadSample(key, signal, false)))
    if (!this.#disposed && !signal?.aborted)
      await this.#loadSample('bg', signal, true)
  }

  async #loadSample(key, signal, releaseRawAfterDecode) {
    const name = `${this.#scope}:${key}`
    const url = zoomSamples[key]
    try {
      await this.#resources.load([
        { name, type: 'binary', url },
      ], { signal })
      this.#loadedResourceNames.add(name)
      if (this.#disposed || signal?.aborted)
        return
      const buffer = await this.#audio.decode(this.#resources.get(name, 'binary'))
      if (!this.#disposed && !signal?.aborted)
        this.#buffers.set(key, buffer)
    }
    catch (error) {
      if (!this.#disposed && !signal?.aborted)
        this.#audio.reportOnce(url, error)
    }
    finally {
      if (releaseRawAfterDecode && this.#loadedResourceNames.delete(name))
        this.#resources.unload(name)
    }
  }

  #ensureChannel() {
    if (this.#disposed || !this.#audio?.unlocked)
      return null
    if (!this.#channel || !this.#channel.active)
      this.#channel = this.#audio.createChannel?.() ?? null
    return this.#channel
  }

  #trackSource(source, gain, extras = []) {
    const entry = { source, gain, extras }
    this.#activeOneShots.add(entry)
    source.onended = () => {
      if (!this.#activeOneShots.delete(entry))
        return
      source.onended = null
      try {
        source.disconnect()
        gain.disconnect()
        for (const node of extras) node.disconnect()
      }
      catch {}
    }
    return entry
  }

  #stopEntry(entry, now, immediate = false) {
    if (!entry)
      return
    this.#activeOneShots.delete(entry)
    const cleanup = () => {
      entry.source.onended = null
      try {
        entry.source.disconnect()
        entry.gain.disconnect()
        for (const node of entry.extras ?? []) node.disconnect()
      }
      catch {}
    }
    if (immediate) {
      try {
        entry.source.stop(now)
      }
      catch {}
      cleanup()
      return
    }
    entry.source.onended = cleanup
    try {
      entry.gain.gain.cancelScheduledValues(now)
      entry.gain.gain.setValueAtTime(entry.gain.gain.value ?? 0, now)
      rampParam(entry.gain.gain, 0.0001, now + 0.03)
      entry.source.stop(now + 0.035)
    }
    catch {
      cleanup()
    }
  }

  #playEnter() {
    const channel = this.#ensureChannel()
    const buffer = this.#buffers.get('in')
    if (!channel || !buffer)
      return
    const { context, input } = channel
    const now = context.currentTime
    const source = context.createBufferSource()
    const gain = context.createGain()
    source.buffer = buffer
    // in.wav has ~0.45s leading silence before the whoosh rise + deep sub impact at 0.80s.
    const offset = Math.min(0.45, Math.max(0, buffer.duration - 0.8))
    const playDuration = Math.min(1.25, Math.max(0.4, buffer.duration - offset))
    gain.gain.setValueAtTime(0.0001, now)
    rampParam(gain.gain, 0.56, now + 0.035)
    gain.gain.setValueAtTime(0.56, now + Math.min(0.58, playDuration * 0.5))
    rampParam(gain.gain, 0.0001, now + playDuration)
    source.connect(gain)
    gain.connect(input)
    this.#trackSource(source, gain)
    source.start(now, offset, playDuration + 0.02)
  }

  #playLeave() {
    const channel = this.#ensureChannel()
    const buffer = this.#buffers.get('out')
    if (!channel || !buffer)
      return
    const { context, input } = channel
    const now = context.currentTime
    const source = context.createBufferSource()
    const gain = context.createGain()
    source.buffer = buffer
    const playDuration = Math.min(1.1, buffer.duration)
    gain.gain.setValueAtTime(0.0001, now)
    rampParam(gain.gain, 0.52, now + 0.02)
    gain.gain.setValueAtTime(0.46, now + Math.min(0.45, playDuration * 0.45))
    rampParam(gain.gain, 0.0001, now + playDuration)
    source.connect(gain)
    gain.connect(input)
    this.#trackSource(source, gain)
    source.start(now, 0, playDuration + 0.02)
  }

  #playTick(kind) {
    const channel = this.#ensureChannel()
    const isHigh = kind === 'high'
    const buffer = this.#buffers.get(isHigh ? 'tick' : 'tick2')
    if (!channel || !buffer)
      return
    const { context, input } = channel
    const now = context.currentTime
    const source = context.createBufferSource()
    const gain = context.createGain()
    const extras = []
    source.buffer = buffer
    // tick.wav has ~0.105s leading silence and peaks at ~0.056; tick2.wav starts at 0 and peaks at ~0.079.
    const offset = isHigh
      ? Math.min(0.105, Math.max(0, buffer.duration - 0.1))
      : 0
    const duration = Math.min(0.14, Math.max(0.06, buffer.duration - offset))
    source.playbackRate.value = isHigh ? 1.04 : 0.92
    gain.gain.setValueAtTime(isHigh ? 2.5 : 2.1, now)

    if (typeof context.createBiquadFilter === 'function') {
      const filter = context.createBiquadFilter()
      filter.type = 'highpass'
      filter.frequency.value = 750
      source.connect(filter)
      filter.connect(gain)
      extras.push(filter)
    }
    else {
      source.connect(gain)
    }
    gain.connect(input)
    this.#trackSource(source, gain, extras)
    source.start(now, offset, duration)
  }

  #playBreath(kind, breathPeriod) {
    const channel = this.#ensureChannel()
    const buffer = this.#buffers.get('breath')
    if (!channel || !buffer)
      return
    const { context, input } = channel
    const now = context.currentTime
    if (this.#activeBreath) {
      this.#stopEntry(this.#activeBreath, now)
      this.#activeBreath = null
    }
    const isExhale = kind === 'exhale'
    const speedScale = Math.min(1.7, Math.max(1, flowConfig.flowBreathPeriod / Math.max(1.2, breathPeriod)))
    // breath.wav has lighter breath at [4.35..6.8s] and heavier lower breath at [0.85..3.4s].
    const rawOffset = isExhale ? 0.85 : 4.35
    const offset = buffer.duration > rawOffset + 0.5
      ? rawOffset
      : 0
    const baseSlice = isExhale ? 2.25 : 1.55
    const maxPlay = Math.max(0.35, Math.min(baseSlice / speedScale, breathPeriod * (isExhale ? 0.54 : 0.39)))
    const source = context.createBufferSource()
    const gain = context.createGain()
    const extras = []
    source.buffer = buffer
    source.playbackRate.value = (isExhale ? 0.84 : 1.08) * speedScale

    const peakGain = isExhale ? 0.44 : 0.24
    const attack = Math.min(0.16, maxPlay * 0.25)
    const release = Math.min(0.28, maxPlay * 0.35)
    gain.gain.setValueAtTime(0.0001, now)
    rampParam(gain.gain, peakGain, now + attack)
    gain.gain.setValueAtTime(peakGain, now + Math.max(attack, maxPlay - release))
    rampParam(gain.gain, 0.0001, now + maxPlay)

    if (typeof context.createBiquadFilter === 'function') {
      const filter = context.createBiquadFilter()
      filter.type = 'lowpass'
      // Exhale is lower and heavier; inhale stays breathier.
      filter.frequency.value = isExhale ? 780 : 1900
      source.connect(filter)
      filter.connect(gain)
      extras.push(filter)
    }
    else {
      source.connect(gain)
    }
    gain.connect(input)
    this.#activeBreath = this.#trackSource(source, gain, extras)
    source.start(now, offset, maxPlay * source.playbackRate.value + 0.05)
  }

  #updateDrone(state) {
    const channel = this.#ensureChannel()
    if (!channel)
      return
    const { context, input } = channel
    const now = context.currentTime
    const active = state.phase !== 'idle' && state.droneGain > 0.001

    if (!active) {
      this.#stopDrone(now)
      return
    }

    const buffer = this.#buffers.get('bg')
    if (buffer && !this.#drone) {
      const source = context.createBufferSource()
      const gain = context.createGain()
      source.buffer = buffer
      source.loop = true
      source.playbackRate.value = state.dronePitch
      gain.gain.setValueAtTime(0.0001, now)

      let filter = null
      if (typeof context.createBiquadFilter === 'function') {
        filter = context.createBiquadFilter()
        filter.type = 'lowpass'
        filter.frequency.value = state.droneCutoff
        filter.Q.value = 1.1
        source.connect(filter)
        filter.connect(gain)
      }
      else {
        source.connect(gain)
      }
      gain.connect(input)
      source.start(now)
      this.#drone = { source, filter, gain }
    }

    if (this.#drone) {
      smoothParam(this.#drone.gain.gain, state.droneGain, now, 0.08)
      smoothParam(this.#drone.source.playbackRate, state.dronePitch, now, 0.08)
      if (this.#drone.filter)
        smoothParam(this.#drone.filter.frequency, state.droneCutoff, now, 0.08)
    }

    // Subtle rising harmonic overtone during exit so rising pitch/brightness reads even on small speakers.
    if (state.exitIntensity > 0.01 && typeof context.createOscillator === 'function' && typeof context.createBiquadFilter === 'function') {
      if (!this.#shimmer) {
        const osc = context.createOscillator()
        const filter = context.createBiquadFilter()
        const gain = context.createGain()
        osc.type = 'sawtooth'
        osc.frequency.value = 165
        filter.type = 'bandpass'
        filter.frequency.value = 420
        filter.Q.value = 2.2
        gain.gain.setValueAtTime(0.0001, now)
        osc.connect(filter)
        filter.connect(gain)
        gain.connect(input)
        osc.start(now)
        this.#shimmer = { osc, filter, gain }
      }
      const e = state.exitIntensity
      smoothParam(this.#shimmer.osc.frequency, 165 * (1 + 0.95 * e), now, 0.07)
      smoothParam(this.#shimmer.filter.frequency, 380 * (6.5 ** e), now, 0.07)
      smoothParam(this.#shimmer.gain.gain, 0.038 * (e ** 1.2), now, 0.07)
    }
    else if (this.#shimmer) {
      smoothParam(this.#shimmer.gain.gain, 0.0001, now, 0.06)
    }
  }

  #stopDrone(now, immediate = false) {
    if (this.#drone) {
      const { source, filter, gain } = this.#drone
      this.#drone = null
      const cleanup = () => {
        source.onended = null
        try {
          source.disconnect()
          filter?.disconnect()
          gain.disconnect()
        }
        catch {}
      }
      if (immediate) {
        try {
          source.stop(now)
        }
        catch {}
        cleanup()
      }
      else {
        source.onended = cleanup
        try {
          gain.gain.cancelScheduledValues(now)
          gain.gain.setValueAtTime(gain.gain.value ?? 0, now)
          rampParam(gain.gain, 0.0001, now + 0.05)
          source.stop(now + 0.06)
        }
        catch {
          cleanup()
        }
      }
    }
    if (this.#shimmer) {
      const { osc, filter, gain } = this.#shimmer
      this.#shimmer = null
      const cleanup = () => {
        osc.onended = null
        try {
          osc.disconnect()
          filter.disconnect()
          gain.disconnect()
        }
        catch {}
      }
      if (immediate) {
        try {
          osc.stop(now)
        }
        catch {}
        cleanup()
      }
      else {
        osc.onended = cleanup
        try {
          gain.gain.cancelScheduledValues(now)
          gain.gain.setValueAtTime(gain.gain.value ?? 0, now)
          rampParam(gain.gain, 0.0001, now + 0.04)
          osc.stop(now + 0.05)
        }
        catch {
          cleanup()
        }
      }
    }
  }

  #ensureBgmBus(channel) {
    if (this.#bgmBus)
      return this.#bgmBus
    const { context, input } = channel
    if (typeof context.createOscillator !== 'function')
      return null
    const gain = context.createGain()
    gain.gain.value = 0.045
    let filter = null
    if (typeof context.createBiquadFilter === 'function') {
      filter = context.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = flowConfig.bgmNormalCutoff
      filter.Q.value = 1.4
      filter.connect(gain)
    }
    gain.connect(input)
    this.#bgmBus = { context, filter, gain }
    return this.#bgmBus
  }

  #updateBgm(state, { worldDt, trialActive }) {
    if (!trialActive) {
      this.#bgmStepAccum = 0
      this.#bgmNoteIndex = 0
      return
    }
    const channel = this.#ensureChannel()
    if (!channel)
      return
    const bus = this.#ensureBgmBus(channel)
    if (!bus)
      return
    const now = bus.context.currentTime
    if (bus.filter)
      smoothParam(bus.filter.frequency, state.bgmCutoff, now, 0.08)

    if (!(worldDt > 0))
      return
    this.#bgmStepAccum += worldDt
    if (this.#bgmStepAccum < bgmStepWorldSec)
      return
    this.#bgmStepAccum %= bgmStepWorldSec

    const freq = bgmArpNotes[this.#bgmNoteIndex++ % bgmArpNotes.length]
    const scale = Math.max(0.25, state.timeScale)
    const decay = Math.min(1.4, 0.22 / scale)
    const osc = bus.context.createOscillator()
    const env = bus.context.createGain()
    osc.type = 'triangle'
    // Slight pitch warmth when deeply slowed in Flow.
    osc.frequency.value = freq * (0.94 + 0.06 * scale)
    env.gain.setValueAtTime(0.0001, now)
    rampParam(env.gain, 1, now + 0.012)
    rampParam(env.gain, 0.0001, now + decay)
    osc.connect(env)
    env.connect(bus.filter ?? bus.gain)
    this.#trackSource(osc, env)
    osc.start(now)
    osc.stop(now + decay + 0.02)
  }

  update(state, events, { worldDt = 0, trialActive = false } = {}) {
    if (this.#disposed)
      return
    this.#audio?.setWorldLowpass?.(state.worldLowpass, 0.07)
    if (events.entered)
      this.#playEnter()
    if (events.left)
      this.#playLeave()
    if (events.tick)
      this.#playTick(events.tick)
    if (events.breath)
      this.#playBreath(events.breath, state.breathPeriod)
    this.#updateDrone(state)
    this.#updateBgm(state, { worldDt, trialActive })
  }

  reset(immediate = false) {
    this.#bgmStepAccum = 0
    this.#bgmNoteIndex = 0
    this.#audio?.setWorldLowpass?.(flowConfig.worldNormalLowpass, 0.03)
    const now = this.#channel?.context?.currentTime ?? 0
    this.#stopDrone(now, immediate)
    if (this.#activeBreath) {
      this.#stopEntry(this.#activeBreath, now, immediate)
      this.#activeBreath = null
    }
    for (const entry of [...this.#activeOneShots])
      this.#stopEntry(entry, now, immediate)
    this.#activeOneShots.clear()
  }

  dispose() {
    if (this.#disposed)
      return
    this.reset(true)
    this.#disposed = true
    if (this.#bgmBus) {
      try {
        this.#bgmBus.filter?.disconnect()
        this.#bgmBus.gain.disconnect()
      }
      catch {}
      this.#bgmBus = null
    }
    this.#channel?.dispose()
    this.#channel = null
    for (const name of this.#loadedResourceNames)
      this.#resources?.unload(name)
    this.#loadedResourceNames.clear()
    this.#buffers.clear()
  }
}
