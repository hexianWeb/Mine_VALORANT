const samples = {
  body: '/audio/bot/Body_Hit.ogg',
  head: '/audio/bot/Head_Hit.ogg',
  in: '/audio/bot/botIn.ogg',
  out: '/audio/bot/botOut.ogg',
}

let nextScope = 0

/** Shared per level. Bot presentation cues run on the gameplay clock. */
export class TrainingBotAudio {
  #audio
  #resources
  #scope = `training-bot-audio:${++nextScope}`
  #entries
  #buffers = new Map()
  #disposed = false

  constructor({ audio, resources, signal }) {
    this.#audio = audio
    this.#resources = resources
    this.#entries = Object.entries(samples).map(([kind, url]) => ({
      kind,
      name: `${this.#scope}:${kind}`,
      type: 'binary',
      url,
    }))
    this.ready = this.#preload(signal)
  }

  get sampleCount() { return this.#buffers.size }
  get canPlayInitial() { return this.#audio.unlocked && this.#buffers.has('in') }

  async #preload(signal) {
    await Promise.all(this.#entries.map(async ({ kind, ...entry }) => {
      try {
        await this.#resources.load([entry], { signal })
        if (this.#disposed || signal?.aborted)
          return
        const buffer = await this.#audio.decode(this.#resources.get(entry.name, entry.type))
        if (!this.#disposed && !signal?.aborted)
          this.#buffers.set(kind, buffer)
      }
      catch (error) {
        if (!this.#disposed && !signal?.aborted)
          this.#audio.reportOnce(entry.url, error)
      }
    }))
  }

  play({ owner, region, sequence, at, timeScale = 1 }) {
    const kind = region === 'head'
      ? 'head'
      : 'body'
    const pitchScale = 0.52 + 0.48 * Math.max(0.25, Math.min(1, timeScale))
    return this.#play({
      owner,
      sequence,
      at,
      sample: kind,
      group: `bot-hit:${kind}`,
      rate: 0.85 * pitchScale,
      gain: 0.28,
    })
  }

  playLifecycle({ owner, entered, sequence, at, timeScale = 1 }) {
    const sample = entered ? 'in' : 'out'
    const pitchScale = 0.52 + 0.48 * Math.max(0.25, Math.min(1, timeScale))
    return this.#play({
      owner,
      sequence,
      at,
      sample,
      group: `bot:${sample}`,
      rate: pitchScale,
      gain: 0.65,
    })
  }

  #play({ owner, sequence, at, sample, group, rate, gain }) {
    const buffer = this.#buffers.get(sample)
    // Missing/late-loaded sounds are skipped, never replayed on a later hit.
    if (this.#disposed || !buffer || !Number.isFinite(at))
      return false
    return this.#audio.enqueue({
      id: `${this.#scope}/${owner}/${sequence}/${sample}`,
      scope: this.#scope,
      owner,
      sequence,
      group,
      at,
      kind: 'transient',
      lateWindow: 0.1,
      rate,
      gain,
      buffer,
    })
  }

  stop(owner) {
    this.#audio.invalidate({ scope: this.#scope, owner })
  }

  dispose() {
    if (this.#disposed)
      return
    this.#disposed = true
    this.#audio.invalidate({ scope: this.#scope })
    for (const { name } of this.#entries) this.#resources.unload(name)
    this.#buffers.clear()
  }
}
