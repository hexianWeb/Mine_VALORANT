const samples = {
  body: '/audio/bot/Body_Hit.ogg',
  head: '/audio/bot/Head_Hit.ogg',
}

let nextScope = 0

/** Shared per level; only committed hits enqueue transients on the gameplay clock. */
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

  play({ owner, region, sequence, at }) {
    const kind = region === 'head'
      ? 'head'
      : 'body'
    const buffer = this.#buffers.get(kind)
    // Missing/late-loaded sounds are skipped, never replayed on a later hit.
    if (this.#disposed || !buffer || !Number.isFinite(at))
      return false
    return this.#audio.enqueue({
      id: `${this.#scope}/${owner}/${sequence}/${kind}`,
      scope: this.#scope,
      owner,
      sequence,
      group: `bot-hit:${kind}`,
      at,
      kind: 'transient',
      lateWindow: 0.1,
      // Soften the hit feedback without rewriting the source samples.
      rate: 0.85,
      gain: 0.28,
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
