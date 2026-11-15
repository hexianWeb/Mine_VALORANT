const samples = [
  'footstep_concrete_000.ogg',
  'footstep_concrete_001.ogg',
  'footstep_concrete_002.ogg',
  'footstep_concrete_003.ogg',
  'footstep_concrete_004.ogg',
]

let nextScope = 0

/** Plays one transient per completed step using the same audio clock as weapon cues. */
export class PlayerFootsteps {
  #audio
  #resources
  #scope = `player-footsteps:${++nextScope}`
  #entries
  #buffers = []
  #epoch = 0
  #disposed = false

  constructor({ audio, resources, signal }) {
    this.#audio = audio
    this.#resources = resources
    this.#entries = samples.map(file => ({
      name: `${this.#scope}:${file}`,
      type: 'binary',
      url: `/audio/footsteps/${file}`,
    }))
    void this.#preload(signal)
  }

  get sampleCount() { return this.#buffers.length }

  async #preload(signal) {
    const buffers = await Promise.all(this.#entries.map(async (entry) => {
      try {
        await this.#resources.load([entry], { signal })
        if (this.#disposed || signal?.aborted)
          return null
        return await this.#audio.decode(this.#resources.get(entry.name, entry.type))
      }
      catch (error) {
        if (!this.#disposed && !signal?.aborted)
          this.#audio.reportOnce(entry.url, error)
        return null
      }
    }))
    if (!this.#disposed && !signal?.aborted)
      this.#buffers = buffers.filter(Boolean)
  }

  advance(from, to, { fixedElapsed, fixedDelta }, quiet) {
    if (!this.#buffers.length)
      return
    for (let step = Math.floor(from) + 1; step <= to; step++) {
      const at = fixedElapsed - fixedDelta + (step - from) / (to - from) * fixedDelta
      this.#audio.enqueue({
        id: `${this.#scope}/${this.#epoch}/${step}`,
        scope: this.#scope,
        owner: 'player-footsteps',
        epoch: this.#epoch,
        sequence: step,
        at,
        kind: 'transient',
        lateWindow: 0.1,
        gain: quiet ? 0.08 : 0.18,
        buffer: this.#buffers[(step - 1) % this.#buffers.length],
      })
    }
  }

  reset() {
    this.#epoch++
    this.#audio.invalidate({ scope: this.#scope })
  }

  dispose() {
    if (this.#disposed)
      return
    this.#disposed = true
    this.reset()
    for (const { name } of this.#entries)
      this.#resources.unload(name)
    this.#buffers = []
  }
}
