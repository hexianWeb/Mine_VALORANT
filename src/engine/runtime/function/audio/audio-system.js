import { Disposer } from '../../core/disposer.js'

const terminal = new Set(['ended', 'dropped', 'cancelled'])
const epsilon = 1e-9

/** One runtime's Web Audio clock, buses and voices. No weapons, DOM input rules or asset loading. */
export class AudioSystem {
  #context
  #createContext
  #owned = new Disposer()
  #unlocked = false
  #unlocking = null
  #paused = false
  #scalePaused = false
  #closed = false
  #unavailable = false
  #needsAnchor = 'unlock'
  #anchor = null
  #lastTime = null
  #lastFrame = null
  #records = new Map()
  #voices = new Set()
  #warnings = new Map()
  #history = []
  #master
  #sfx
  #onWarning
  #contextOperation = Promise.resolve()
  #stats = {
    scheduled: 0,
    dropped: 0,
    missedDeadlines: 0,
    ended: 0,
    cancelled: 0,
    rebuilt: 0,
    flushes: 0,
  }

  constructor({ context = null, createContext = () => new globalThis.AudioContext(), element, maxVoices = 24, masterGain = 0.6, jitterMargin = 0.010, lead = 0.006, fade = 0.008, onWarning = message => console.warn(message) } = {}) {
    if (!Number.isSafeInteger(maxVoices) || maxVoices < 1 || ![masterGain, jitterMargin, lead, fade].every(value => Number.isFinite(value) && value >= 0))
      throw new RangeError('[Audio] Invalid audio configuration')
    this.maxVoices = maxVoices
    this.masterGain = masterGain
    this.jitterMargin = jitterMargin
    this.lead = lead
    this.fade = fade
    this.#context = context
    this.#createContext = createContext
    this.#onWarning = onWarning
    if (element?.addEventListener) {
      const unlock = (event) => {
        if (event.isTrusted)
          void this.unlock()
      }
      this.#owned.listen(element, 'pointerdown', unlock)
      this.#owned.listen(element, 'keydown', unlock)
    }
  }

  reportOnce(key, error) {
    if (this.#warnings.has(key) || this.#closed)
      return
    const message = `[Audio] ${String(error?.message ?? error)}`
    this.#warnings.set(key, message)
    this.#onWarning(message)
  }

  #ensureContext() {
    if (this.#closed || this.#unavailable)
      return null
    try {
      this.#context ??= this.#createContext()
      if (!this.#master) {
        this.#master = this.#context.createGain()
        this.#master.gain.value = this.masterGain
        this.#master.connect(this.#context.destination)
        this.#sfx = this.#context.createGain()
        this.#sfx.connect(this.#master)
        if (this.#context.addEventListener) {
          this.#owned.listen(this.#context, 'statechange', () => {
            if (!this.#paused && !this.#scalePaused) {
              if (this.#context.state !== 'running')
                this.#pauseBoundary()
              this.#needsAnchor = 'audio-state-change'
            }
          })
        }
      }
      return this.#context
    }
    catch (error) {
      this.#unavailable = true
      this.reportOnce('unavailable', error)
      return null
    }
  }

  async decode(bytes) {
    const context = this.#ensureContext()
    if (!context)
      throw new Error('Audio decoding is unavailable')
    // decodeAudioData may detach its input. Never consume ResourceManager's shared bytes.
    const buffer = await context.decodeAudioData(bytes.slice(0))
    if (this.#closed)
      throw new DOMException('Audio system closed during decode', 'AbortError')
    return buffer
  }

  unlock() {
    if (this.#unlocked && (this.#paused || this.#scalePaused))
      return Promise.resolve(!this.#closed)
    if (this.#closed || (this.#unlocked && this.#context?.state === 'running'))
      return Promise.resolve(this.#unlocked && !this.#closed)
    if (this.#unlocking)
      return this.#unlocking
    const context = this.#ensureContext()
    if (!context)
      return Promise.resolve(false)
    // Call resume in the trusted gesture, not in a later frame or a timer.
    let resumed
    try {
      resumed = context.resume()
    }
    catch (error) {
      this.reportOnce('unlock', error)
      return Promise.resolve(false)
    }
    this.#unlocking = Promise.resolve(resumed).then(() => {
      if (this.#closed || context.state !== 'running')
        return false
      this.#unlocked = true
      this.#needsAnchor = 'unlock'
      if (this.#paused || this.#scalePaused)
        this.#syncContext()
      return true
    }).catch((error) => {
      this.reportOnce('unlock', error)
      return false
    }).finally(() => { this.#unlocking = null })
    return this.#unlocking
  }

  #syncContext() {
    if (!this.#context || !this.#unlocked || this.#closed)
      return
    this.#contextOperation = this.#contextOperation.then(async () => {
      if (this.#closed)
        return
      const paused = this.#paused || this.#scalePaused
      await (paused
        ? this.#context.suspend()
        : this.#context.resume())
    }).catch(error => this.reportOnce('context-state', error))
  }

  setPaused(value) {
    if (this.#closed || this.#paused === value)
      return
    this.#paused = value
    this.#pauseBoundary()
    this.#syncContext()
  }

  #pauseBoundary() {
    this.#needsAnchor = 'pause-resume'
    for (const record of this.#records.values()) {
      if (record.kind === 'transient' && !terminal.has(record.state)
        && (!record.voice || record.voice.when > this.#context.currentTime)) {
        this.#finish(record, 'dropped', 'pause-boundary')
      }
    }
  }

  enqueue(cue) {
    if (this.#closed)
      return false
    if (!cue || typeof cue.id !== 'string' || typeof cue.scope !== 'string' || typeof cue.owner !== 'string'
      || !Number.isFinite(cue.at) || !['action', 'transient'].includes(cue.kind)
      || !Number.isFinite(cue.rate ?? 1) || (cue.rate ?? 1) <= 0
      || !Number.isFinite(cue.gain ?? 1) || (cue.gain ?? 1) < 0) {
      throw new TypeError('[Audio] Invalid semantic cue')
    }
    if (this.#records.has(cue.id))
      return false
    const record = {
      rate: 1,
      gain: 1,
      sequence: 0,
      keepTail: true,
      resume: true,
      ...cue,
      state: 'queued',
      voice: null,
      cancelAt: null,
    }
    this.#records.set(cue.id, record)
    if (!cue.buffer)
      this.#finish(record, 'dropped', 'buffer-unavailable')
    return true
  }

  /** Confirmed gameplay cancellation is mapped in flush; lifecycle invalidation is immediate. */
  cancelAction({ scope, owner, epoch, actionId, group, at }) {
    for (const record of this.#records.values()) {
      if (!terminal.has(record.state) && record.kind === 'action' && record.scope === scope && record.owner === owner
        && record.epoch === epoch && (actionId === undefined || record.actionId === actionId)
        && (group === undefined || record.group === group)) {
        if (record.voice && at < (record.cancelAt ?? Infinity))
          record.voice.cancellationScheduled = false
        record.cancelAt = Math.min(record.cancelAt ?? Infinity, at)
      }
    }
  }

  invalidate({ scope, owner, epoch } = {}) {
    for (const record of this.#records.values()) {
      if ((scope === undefined || record.scope === scope) && (owner === undefined || record.owner === owner)
        && (epoch === undefined || record.epoch === epoch)) {
        if (!terminal.has(record.state))
          this.#finish(record, 'cancelled', 'invalidation')
        this.#records.delete(record.id)
      }
    }
    // Also stop fading/replaced sources which no longer occupy record.voice.
    for (const voice of [...this.#voices]) {
      if ((scope === undefined || voice.record.scope === scope) && (owner === undefined || voice.record.owner === owner)
        && (epoch === undefined || voice.record.epoch === epoch)) {
        this.#stopVoice(voice, this.#context.currentTime, false)
      }
    }
  }

  #audioTime(at) {
    return this.#anchor.audio + this.#anchor.latency + (at - this.#anchor.sim) / this.#anchor.rate
  }

  #finish(record, state, reason) {
    if (terminal.has(record.state))
      return
    record.state = state
    if (record.voice)
      this.#stopVoice(record.voice, this.#context.currentTime, false)
    record.reason = reason
    record.buffer = null
    this.#stats[state]++
    if (reason === 'missed-deadline')
      this.#stats.missedDeadlines++
  }

  #releaseVoice(voice) {
    if (!this.#voices.delete(voice))
      return
    voice.source.onended = null
    voice.source.disconnect()
    voice.gain.disconnect()
    if (voice.record.voice === voice) {
      voice.record.voice = null
      if (!terminal.has(voice.record.state)) {
        const cancelled = voice.cancellationAt <= voice.endsAt + epsilon
        voice.record.state = cancelled
          ? 'cancelled'
          : 'ended'
        if (cancelled)
          voice.record.reason = 'action-cancelled'
        voice.record.buffer = null
        this.#stats[voice.record.state]++
      }
    }
  }

  #stopVoice(voice, when, fade = true) {
    const now = this.#context.currentTime
    if (fade && when > voice.when - epsilon) {
      const start = Math.max(now, when)
      voice.gain.gain.cancelScheduledValues(start)
      voice.gain.gain.setValueAtTime(voice.record.gain, start)
      voice.gain.gain.linearRampToValueAtTime(0, start + this.fade)
      voice.source.stop(start + this.fade)
      voice.endsAt = Math.min(voice.endsAt, start + this.fade)
      voice.fadeAt = start
      voice.fading = start <= now
    }
    else {
      voice.source.stop(Math.max(now, when))
      this.#releaseVoice(voice)
    }
  }

  #reanchor(time, reason, sim) {
    const now = this.#context.currentTime
    const old = this.#anchor
    const discontinuity = ['wall-clock-clipped', 'fixed-time-dropped'].includes(reason)
    for (const record of this.#records.values()) {
      if (terminal.has(record.state))
        continue
      if (record.kind === 'transient') {
        if (record.voice && record.voice.when <= now)
          continue // Already-fired tails keep their original pitch.
        if (discontinuity || (record.voice && [
          'unlock',
          'pause-resume',
          'audio-state-change',
          'clock-reset',
        ].includes(reason))) {
          const missed = old && now > this.#audioTime(record.at) - this.lead + epsilon
          this.#finish(record, 'dropped', missed ? 'missed-deadline' : 'clock-boundary')
        }
        else if (record.voice) {
          const voice = record.voice
          record.voice = null
          this.#stopVoice(voice, now, false)
          // A replaced source must not turn its semantic cue into a terminal record.
          record.state = 'queued'
        }
      }
      else if (record.voice && reason !== 'pause-resume') {
        const voice = record.voice
        record.voice = null
        this.#stopVoice(voice, now, voice.when <= now)
        record.state = 'queued'
        this.#stats.rebuilt++
      }
    }
    this.#anchor = {
      sim,
      audio: now,
      rate: time.timeScale,
      latency: time.fixedDelta / time.timeScale + this.jitterMargin,
    }
    this.#history.push({
      reason,
      ...this.#anchor,
      offset: old
        ? now - (old.audio + (sim - old.sim) / old.rate)
        : 0,
    })
    this.#history = this.#history.slice(-32)
    this.#needsAnchor = null
  }

  #schedule(record, time) {
    const context = this.#context
    const now = context.currentTime
    const target = this.#audioTime(record.at)
    if (record.cancelAt !== null && record.cancelAt <= record.at + epsilon) {
      this.#finish(record, 'cancelled', 'action-cancelled')
      return
    }
    if (record.kind === 'transient' && now > target - this.lead + epsilon) {
      this.#finish(record, 'dropped', 'missed-deadline')
      return
    }
    const rate = record.kind === 'action'
      ? time.timeScale * record.rate
      : record.rate
    const when = Math.max(target, now + this.lead)
    if (record.cancelAt !== null && this.#audioTime(record.cancelAt) <= when + epsilon) {
      this.#finish(record, 'cancelled', 'action-cancelled')
      return
    }
    const offset = record.kind === 'action'
      ? Math.max(0, (when - target) * rate)
      : 0
    if (offset > epsilon && !record.resume) {
      this.#finish(record, 'dropped', 'action-not-resumable')
      return
    }
    if (offset >= record.buffer.duration || (record.endAt !== undefined && this.#audioTime(record.endAt) <= when + epsilon)) {
      this.#finish(record, 'dropped', 'action-expired')
      return
    }
    const live = [...this.#voices].filter(voice => !voice.fading)
    if (live.length >= this.maxVoices) {
      const victim = live.find(voice => voice.record.kind === 'transient') ?? live[0]
      victim.record.voice = null
      victim.record.state = 'dropped'
      victim.record.reason = 'voice-limit'
      victim.record.buffer = null
      this.#stats.dropped++
      this.#stopVoice(victim, now, victim.when <= now)
    }
    try {
      const source = context.createBufferSource()
      const gain = context.createGain()
      source.buffer = record.buffer
      source.playbackRate.value = rate
      gain.gain.value = record.gain
      source.connect(gain)
      gain.connect(this.#sfx)
      const voice = {
        source,
        gain,
        record,
        when,
        offset,
        rate,
        endsAt: when + (record.buffer.duration - offset) / rate,
        fading: false,
      }
      record.voice = voice
      record.state = 'scheduled'
      record.audioAt = when
      record.offset = offset
      record.playbackRate = rate
      this.#voices.add(voice)
      source.onended = () => this.#releaseVoice(voice)
      source.start(when, offset)
      this.#stats.scheduled++
      if (!record.keepTail && record.endAt !== undefined)
        this.#stopVoice(voice, this.#audioTime(record.endAt))
    }
    catch (error) {
      this.reportOnce('voice', error)
      this.#finish(record, 'dropped', 'voice-failed')
    }
  }

  flush(time, listener) {
    if (this.#closed || time.frame === this.#lastFrame)
      return
    this.#lastFrame = time.frame
    this.#stats.flushes++
    if (this.#scalePaused !== (time.timeScale === 0)) {
      this.#scalePaused = time.timeScale === 0
      this.#pauseBoundary()
      this.#syncContext()
    }
    const context = this.#context
    if (!this.#unlocked || context?.state !== 'running' || this.#paused || this.#scalePaused) {
      for (const record of this.#records.values()) {
        if (record.state === 'queued' && record.kind === 'transient') {
          this.#finish(record, 'dropped', this.#paused || this.#scalePaused
            ? 'paused'
            : 'locked')
        }
        else if (record.state === 'queued' && record.endAt <= time.fixedElapsed) {
          this.#finish(record, 'dropped', 'action-expired')
        }
      }
      this.#trim()
      this.#lastTime = time
      return
    }
    const now = context.currentTime
    for (const voice of [...this.#voices]) {
      if (voice.fadeAt <= now)
        voice.fading = true
      if (voice.endsAt <= now + epsilon)
        this.#releaseVoice(voice)
      else if (voice.when <= now && voice.record.voice === voice)
        voice.record.state = 'started'
    }
    const sim = time.fixedElapsed + time.alpha * time.fixedDelta
    let reason = this.#needsAnchor
    if ((time.clippedWallTime ?? 0) > epsilon)
      reason = 'wall-clock-clipped'
    else if ((time.droppedSimulationTime ?? 0) > epsilon)
      reason = 'fixed-time-dropped'
    else if (this.#anchor && time.timeScale !== this.#anchor.rate)
      reason = 'time-scale'
    else if (this.#lastTime && (time.clockRevision !== this.#lastTime.clockRevision || sim < this.#lastTime.fixedElapsed - epsilon))
      reason = 'clock-reset'
    if (!this.#anchor || reason)
      this.#reanchor(time, reason ?? 'unlock', sim)
    this.#lastTime = time
    const records = [
      ...this.#records.values(),
    ].sort((a, b) => a.at - b.at || a.sequence - b.sequence)
    for (const record of records) {
      if (record.state === 'queued')
        this.#schedule(record, time)
      if (record.voice && record.cancelAt !== null && !record.voice.cancellationScheduled) {
        const at = Math.max(now, this.#audioTime(record.cancelAt))
        if (at <= record.voice.when + epsilon) {
          this.#finish(record, 'cancelled', 'action-cancelled')
        }
        else {
          record.voice.cancellationScheduled = true
          record.voice.cancellationAt = at
          this.#stopVoice(record.voice, at)
        }
      }
    }
    this.#listener(listener)
    this.#trim()
  }

  #trim() {
    // Retain bounded diagnostics/deduplication, never an ever-growing buffer/source history.
    for (const record of this.#records.values()) {
      if (this.#records.size <= 512)
        break
      if (terminal.has(record.state))
        this.#records.delete(record.id)
    }
  }

  #listener(pose) {
    const listener = this.#context.listener
    if (!pose || !listener?.positionX)
      return
    const [x, y, z, w] = pose.quaternion
    const values = [
      ...pose.position,
      -2 * (x * z + w * y),
      -2 * (y * z - w * x),
      -(1 - 2 * (x * x + y * y)),
      2 * (x * y - w * z),
      1 - 2 * (x * x + z * z),
      2 * (y * z + w * x),
    ]
    const keys = [
      'positionX',
      'positionY',
      'positionZ',
      'forwardX',
      'forwardY',
      'forwardZ',
      'upX',
      'upY',
      'upZ',
    ]
    keys.forEach((key, index) => listener[key].setValueAtTime(values[index], this.#context.currentTime))
  }

  snapshot() {
    return {
      state: this.#closed
        ? 'closed'
        : this.#context?.state ?? (this.#unavailable ? 'unavailable' : 'idle'),
      unlocked: this.#unlocked,
      paused: this.#paused || this.#scalePaused,
      voices: this.#voices.size,
      activeVoices: [...this.#voices].filter(voice => !voice.fading).length,
      anchor: this.#anchor
        ? { ...this.#anchor }
        : null,
      segments: this.#history.map(segment => ({ ...segment })),
      stats: { ...this.#stats },
      warnings: [
        ...this.#warnings.values(),
      ],
      cues: [
        ...this.#records.values(),
      ].map(({ id, scope, owner, epoch, group, kind, actionId, at, cancelAt, state, reason, audioAt, offset, playbackRate }) => ({
        id,
        scope,
        owner,
        epoch,
        group,
        kind,
        actionId,
        at,
        cancelAt,
        state,
        reason,
        audioAt,
        offset,
        playbackRate,
      })),
    }
  }

  dispose() {
    if (this.#closed)
      return
    this.invalidate()
    this.#closed = true
    this.#owned.dispose()
    this.#sfx?.disconnect()
    this.#master?.disconnect()
    if (this.#context && this.#context.state !== 'closed')
      void Promise.resolve(this.#context.close()).catch(error => this.#onWarning(`[Audio] ${error.message}`))
  }
}
