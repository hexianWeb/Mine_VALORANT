function tolerance(value) {
  return 1e-10 + 8 * Number.EPSILON * Math.abs(value)
}

function clipProgress(progress, duration, loop) {
  const boundary = loop && duration > 0
    ? Math.round(progress / duration) * duration
    : duration
  return Math.abs(progress - boundary) <= tolerance(progress)
    ? boundary
    : progress
}

/** Playback time, marker cursors and interrupted transition weights, independent of Mixer. */
export class AnimationStateMachine {
  time = 0
  current = null
  layers = []
  #nextId = 0
  #transition = null
  #compensation = 0

  play(profile, { restart, fade, rate }) {
    if (!restart && this.current?.role === profile.role)
      return this.current.playbackId
    const previous = this.layers.filter(layer => layer.weight > 0)
    const layer = {
      ...profile,
      rate,
      playbackId: ++this.#nextId,
      startedAt: this.time,
      weight: previous.length && fade > 0
        ? 0
        : 1,
      localTime: 0,
      cursor: -Infinity,
      finished: false,
    }
    this.current = layer
    this.layers = layer.weight === 1
      ? [layer]
      : [...previous, layer]
    this.#transition = layer.weight === 1
      ? null
      : {
          startedAt: this.time,
          duration: fade,
          sources: previous.map(entry => ({ entry, weight: entry.weight })),
        }
    return layer.playbackId
  }

  advance(delta) {
    // Compensated accumulation keeps equal elapsed time stable across frame subdivisions.
    const increment = delta - this.#compensation
    const next = this.time + increment
    this.#compensation = (next - this.time) - increment
    this.time = next
    const events = []
    const current = this.current
    if (current) {
      const duration = current.clip.duration
      const progress = clipProgress((this.time - current.startedAt) * current.rate, duration, current.loop)
      const cycleEnd = current.loop && duration > 0
        ? Math.floor(progress / duration)
        : 0
      const cycleStart = current.loop && duration > 0 && current.cursor >= 0
        ? Math.max(0, Math.floor(current.cursor / duration))
        : 0
      let cursor = Math.max(current.cursor, progress)
      for (let cycle = cycleStart; cycle <= cycleEnd; cycle++) {
        for (const marker of current.markers) {
          const position = cycle * duration + marker.time
          if (position > current.cursor && position <= progress + tolerance(progress)) {
            cursor = Math.max(cursor, position)
            events.push({
              type: 'marker',
              role: current.role,
              playbackId: current.playbackId,
              at: current.startedAt + position / current.rate,
              marker: { ...marker, cycle },
            })
          }
        }
      }
      current.cursor = cursor
      if (!current.loop && !current.finished && progress >= duration) {
        current.finished = true
        events.push({
          type: 'finished',
          role: current.role,
          playbackId: current.playbackId,
          at: current.startedAt + duration / current.rate,
        })
      }
    }
    if (this.#transition) {
      const elapsed = this.time - this.#transition.startedAt
      const ratio = elapsed + tolerance(this.time) >= this.#transition.duration
        ? 1
        : elapsed / this.#transition.duration
      for (const source of this.#transition.sources) source.entry.weight = source.weight * (1 - ratio)
      this.current.weight = ratio
      if (ratio === 1) {
        this.layers = [this.current]
        this.#transition = null
      }
    }
    // Frequent restarts must retire negligible sources while firing, not only after it stops.
    // Discarded weight is below 1e-5 per layer; normalize survivors to retain a complete pose.
    const retained = this.layers.filter(layer => layer === current || layer.weight >= 1e-5)
    if (retained.length !== this.layers.length) {
      this.layers = retained
      if (this.#transition)
        this.#transition.sources = this.#transition.sources.filter(source => retained.includes(source.entry))
    }
    const total = retained.reduce((sum, layer) => sum + layer.weight, 0)
    if (total > 0 && total !== 1) {
      for (const layer of retained) layer.weight /= total
    }
    for (const layer of this.layers) {
      const duration = layer.clip.duration
      const progress = clipProgress((this.time - layer.startedAt) * layer.rate, duration, layer.loop)
      layer.localTime = layer.loop && duration > 0
        ? progress % duration
        : Math.min(progress, duration)
    }
    return events
  }

  stop() {
    this.current = null
    this.layers = []
    this.#transition = null
  }
}
