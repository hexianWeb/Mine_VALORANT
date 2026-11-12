import { PropertyBinding } from 'three/webgpu'
import { overlaps, seconds } from './clip-library.js'

/** Sparse absolute samples only: no Mixer actions, clock, blending or event cursor. */
export class ControlSampler {
  #root
  #library
  #cache = new Map()
  #samples = []
  #applied = []

  constructor(root, library) {
    this.#root = root
    this.#library = library
  }

  set(samples) {
    if (!samples || typeof samples !== 'object' || Array.isArray(samples))
      throw new TypeError('[Animation] Control samples must be a record of local seconds')
    const targets = []
    // Resolve the entire request before touching either the scene or the previous sample set.
    const requested = Object.entries(samples).sort(([a], [b]) => a.localeCompare(b)).map(([role, time]) => {
      const profile = this.#library.getControl(role)
      seconds(time, `control time: ${role}`)
      if (time > profile.clip.duration)
        throw new RangeError(`[Animation] Control time outside clip: ${role}`)
      for (const target of profile.tracks) {
        if (targets.some(other => overlaps(target, other))) {
          throw new Error(`[Animation] Overlapping control property: ${target.track.name}`)
        }
        targets.push(target)
      }
      return { role, time, profile }
    })
    const next = requested.map(({ role, time, profile }) => {
      const entries = this.#cache.get(role) ?? profile.tracks.map(target => ({
        ...target,
        binding: new PropertyBinding(this.#root, target.track.name),
        interpolant: target.track.createInterpolant(new Float64Array(target.size)),
        underlying: new Float64Array(target.size),
      }))
      const tracks = entries.map((entry) => {
        const value = entry.interpolant.evaluate(time).slice()
        if (!value.every(Number.isFinite))
          throw new Error(`[Animation] Non-finite control sample: ${entry.track.name}`)
        return { entry, value }
      })
      return { role, time, entries, tracks }
    })
    for (const sample of next) this.#cache.set(sample.role, sample.entries)
    this.#samples = next
  }

  restore() {
    for (const { binding, underlying } of this.#applied) binding.setValue(underlying, 0)
    this.#applied = []
  }

  apply() {
    // Capture every underlying property before any override is written.
    this.#applied = this.#samples.flatMap(sample => sample.tracks.map(({ entry, value }) => {
      entry.binding.getValue(entry.underlying, 0)
      return { binding: entry.binding, underlying: entry.underlying, value }
    }))
    for (const { binding, value } of this.#applied) binding.setValue(value, 0)
  }

  snapshot() {
    return {
      samples: Object.fromEntries(this.#samples.map(({ role, time }) => [role, time])),
      bindings: this.#applied.length,
    }
  }

  clear() {
    this.restore()
    this.#samples = []
    for (const entries of this.#cache.values()) {
      for (const { binding } of entries) binding.unbind()
    }
    this.#cache.clear()
  }
}
