import { Component } from '../../../engine/runtime/function/framework/component/component.js'

const comboWindow = 5
const panelDuration = 2.4
const feedDuration = 5.5
const feedLimit = 3
const defeatPoints = [10, 20, 32, 44, 56]
const emptyFeed = Object.freeze([])
const minRepeatGap = 0.2
const killSound = {
  file: 'audio_KillSounds_DeltaForce_k_deltaforce_normal.wav',
  group: 'kill',
  gain: 0.16,
}
const headshotSound = {
  file: 'audio_KillSounds_DeltaForce_k_deltaforce_headshot.wav',
  group: 'headshot',
  gain: 0.18,
}
const sounds = [killSound, headshotSound]
let nextScope = 0

/** The HUD rewards confirmed kills on the same presentation clock as the target effects. */
export class KillFeedback extends Component {
  static phases = ['motion']
  #pending = []
  #latest = null
  #feed = emptyFeed
  #at = 0
  #audio
  #resources
  #scope = `kill-feedback:${++nextScope}`
  #sequence = 0
  #buffers = new Map()
  #lastCueTimes = new Map()

  constructor({ audio = null, resources, signal } = {}) {
    super()
    this.#audio = audio
    this.#resources = resources
    if (audio) {
      for (const { file } of sounds)
        void this.#loadSound(file, signal)
    }
  }

  async #loadSound(file, signal) {
    const name = `${this.#scope}:${file}`
    const url = `/audio/kill-feedback/${file}`
    try {
      await this.#resources.load([
        { name, type: 'binary', url },
      ], { signal })
      if (this.disposed || signal?.aborted)
        return
      const buffer = await this.#audio.decode(this.#resources.get(name, 'binary'))
      if (!this.disposed && !signal?.aborted)
        this.#buffers.set(file, buffer)
    }
    catch (error) {
      if (!this.disposed && !signal?.aborted)
        this.#audio.reportOnce(url, error)
    }
  }

  receive(result) {
    if (this.disposed || !result.deaths.length)
      return
    this.#pending.push({
      at: result.at,
      kills: result.deaths.map(({ definitionId, region }) => ({
        definitionId,
        headshot: region === 'head',
      })),
    })
  }

  #record(kill, at) {
    const previous = this.#latest
    const continues = previous && at <= previous.at + comboWindow
    const count = continues
      ? previous.count + 1
      : 1
    const tier = Math.min(count, defeatPoints.length) - 1
    const markers = continues
      ? [...previous.markers]
      : []
    markers.push(kill.headshot)

    const kind = count === 1
      ? 'defeat'
      : 'combo'
    const bonuses = [
      { kind, points: defeatPoints[tier] },
    ]
    if (kill.headshot)
      bonuses.push({ kind: 'headshot', points: 20 })
    if (count >= 3)
      bonuses.push({ kind: 'ruthless', points: 10 })

    this.#latest = Object.freeze({
      at,
      expiresAt: at + panelDuration,
      count,
      markers: Object.freeze(markers.slice(-defeatPoints.length)),
      points: bonuses.reduce((sum, bonus) => sum + bonus.points, 0),
      bonuses: Object.freeze(bonuses.map(Object.freeze)),
    })

    const entry = Object.freeze({ ...kill, expiresAt: at + feedDuration })
    this.#feed = Object.freeze([entry, ...this.#feed].slice(0, feedLimit))
  }

  #play({ file, group, gain }, at) {
    const buffer = this.#buffers.get(file)
    const lastAt = this.#lastCueTimes.get(file) ?? -Infinity
    if (!buffer || at < lastAt + minRepeatGap)
      return
    const sequence = ++this.#sequence
    const accepted = this.#audio.enqueue({
      id: `${this.#scope}/${sequence}/${file}`,
      scope: this.#scope,
      owner: this.#scope,
      group: `kill-feedback:${group}`,
      sequence,
      at,
      kind: 'transient',
      lateWindow: 0.1,
      gain,
      buffer,
    })
    if (accepted)
      this.#lastCueTimes.set(file, at)
  }

  tick({ time }) {
    this.#at = time.presentationTime
    while (this.#pending[0]?.at <= this.#at) {
      const { at, kills } = this.#pending.shift()
      for (const kill of kills)
        this.#record(kill, at)
      // A headshot replaces the regular cue, even when one shot kills several targets.
      const sound = this.#buffers.has(headshotSound.file) && kills.some(kill => kill.headshot)
        ? headshotSound
        : killSound
      this.#play(sound, at)
    }

    if (this.#feed.at(-1)?.expiresAt <= this.#at)
      this.#feed = Object.freeze(this.#feed.filter(entry => entry.expiresAt > this.#at))
  }

  read() {
    return {
      at: this.#at,
      panel: this.#latest?.expiresAt > this.#at
        ? this.#latest
        : null,
      feed: this.#feed,
    }
  }

  clear() {
    this.#pending = []
    this.#latest = null
    this.#feed = emptyFeed
    this.#lastCueTimes.clear()
    this.#audio?.invalidate({ scope: this.#scope })
  }

  dispose() {
    if (this.disposed)
      return
    this.clear()
    if (this.#audio) {
      for (const { file } of sounds)
        this.#resources.unload(`${this.#scope}:${file}`)
    }
    this.#buffers.clear()
    super.dispose()
  }
}
