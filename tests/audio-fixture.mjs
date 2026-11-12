export class FakeParam {
  value = 1
  events = []
  setValueAtTime(value, at) {
    this.value = value
    this.events.push({ type: 'set', value, at })
  }

  linearRampToValueAtTime(value, at) { this.events.push({ type: 'ramp', value, at }) }
  cancelScheduledValues(at) { this.events.push({ type: 'cancel', at }) }
}

export class FakeAudioContext extends EventTarget {
  currentTime = 0
  state = 'suspended'
  destination = {}
  sources = []
  gains = []
  decoded = []
  listener = Object.fromEntries([
    'positionX',
    'positionY',
    'positionZ',
    'forwardX',
    'forwardY',
    'forwardZ',
    'upX',
    'upY',
    'upZ',
  ].map(key => [
    key,
    new FakeParam(),
  ]))

  resumeFailure = null

  async resume() {
    if (this.resumeFailure)
      throw this.resumeFailure
    this.state = 'running'
    this.dispatchEvent(new Event('statechange'))
  }

  async suspend() {
    this.state = 'suspended'
    this.dispatchEvent(new Event('statechange'))
  }

  async close() {
    this.state = 'closed'
    this.dispatchEvent(new Event('statechange'))
  }

  async decodeAudioData(bytes) {
    this.decoded.push(bytes)
    structuredClone(bytes, {
      transfer: [bytes],
    })
    return { duration: 1, length: 48000, numberOfChannels: 2 }
  }

  createGain() {
    const node = {
      gain: new FakeParam(),
      connect() {},
      disconnect() { this.disconnected = true },
    }
    this.gains.push(node)
    return node
  }

  createBufferSource() {
    const node = {
      playbackRate: new FakeParam(),
      starts: [],
      stops: [],
      buffer: null,
      onended: null,
      connect() {},
      disconnect() { this.disconnected = true },
      start(when, offset) { this.starts.push({ when, offset, rate: this.playbackRate.value }) },
      stop(when) { this.stops.push(when) },
    }
    this.sources.push(node)
    return node
  }

  advance(at) {
    this.currentTime = at
    for (const source of this.sources) {
      const start = source.starts[0]
      const end = source.stops.at(-1) ?? (start && start.when + (source.buffer.duration - start.offset) / start.rate)
      if (end <= at)
        source.onended?.()
    }
  }
}

export const h = 1 / 60
export function audioTime(frame, fixedElapsed, overrides = {}) {
  return {
    frame,
    fixedElapsed,
    fixedTick: Math.round(fixedElapsed / h),
    fixedDelta: h,
    alpha: 0,
    timeScale: 1,
    clockRevision: 0,
    clippedWallTime: 0,
    droppedSimulationTime: 0,
    ...overrides,
  }
}

export function cue(id, at, overrides = {}) {
  return {
    id,
    at,
    scope: 'level',
    owner: 'player',
    epoch: 1,
    group: 'gun',
    kind: 'transient',
    buffer: { duration: 2, length: 96000, numberOfChannels: 2 },
    gain: 0.25,
    ...overrides,
  }
}
