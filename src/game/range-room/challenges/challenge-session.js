import { deathOrder, fixedTime, identifier, immutableFact } from '../../combat/facts.js'
import { lockChallengeConfig } from './config.js'

/** Pure fixed-step rules. Placement/randomness, targets, rendering and resources live outside. */
export class ChallengeSession {
  #status = 'idle'
  #sessionId = null
  #generation = 0
  #config = null
  #active = new Map()
  #spawnSequence = 0
  #kills = 0
  #settled = 0
  #startedAt = null
  #result = null
  #lastTick = 0
  #lastCellId = null

  #time(context) {
    const time = fixedTime(context)
    if (time.fixedTick < this.#lastTick || (this.#config && time.fixedDelta !== this.#config.fixedDelta))
      throw new RangeError('[Challenge] Fixed time must not go backwards or change rate')
    this.#lastTick = time.fixedTick
    return time
  }

  get running() { return this.#status === 'running' }
  get deficit() {
    return this.running
      ? this.#config.concurrency - this.#active.size
      : 0
  }

  nextSpawnIds() {
    return Array.from({ length: this.deficit }, (_, index) => `${this.#sessionId}:spawn:${this.#spawnSequence + index + 1}`)
  }

  start(selection, context, ownerId) {
    if (this.running)
      return this.#transition()
    const time = fixedTime(context)
    const config = lockChallengeConfig(selection, time.fixedDelta)
    identifier(ownerId, 'challenge owner')
    this.#config = config
    this.#lastTick = time.fixedTick
    this.#sessionId = `${ownerId}:session:${++this.#generation}`
    this.#status = 'running'
    this.#active.clear()
    this.#spawnSequence = 0
    this.#kills = 0
    this.#settled = 0
    this.#result = null
    this.#lastCellId = null
    this.#startedAt = time.fixedElapsed
    return this.#transition([], [], [
      { type: 'ChallengeStarted', at: time.fixedElapsed, config },
    ])
  }

  /** Complete an initial/replacement batch at one boundary. Never exposes a partially filled set. */
  activateBatch(placements, context) {
    const time = this.#time(context)
    if (!this.running || !placements.length || placements.length !== this.deficit)
      throw new RangeError('[Challenge] Expected the complete spawn deficit')
    const ids = new Set([
      ...this.#active.values(),
    ].map(spawn => spawn.targetId))
    const cells = new Set([
      ...this.#active.values(),
    ].map(spawn => spawn.cellId))
    for (const placement of placements) {
      identifier(placement.targetId, 'targetId')
      identifier(placement.cellId, 'cellId')
      if (ids.has(placement.targetId) || cells.has(placement.cellId)
        || (this.#config.mode === 'shooting-test' && placement.cellId === this.#lastCellId)) {
        throw new Error('[Challenge] Duplicate target/cell or consecutive shooting-test cell')
      }
      ids.add(placement.targetId)
      cells.add(placement.cellId)
    }
    const spawned = placements.map(placement => immutableFact({
      ...placement,
      sessionId: this.#sessionId,
      spawnId: `${this.#sessionId}:spawn:${++this.#spawnSequence}`,
      at: time.fixedElapsed,
      spawnedTick: time.fixedTick,
      deadlineTick: this.#config.windowTicks === null
        ? null
        : time.fixedTick + this.#config.windowTicks,
    }))
    for (const spawn of spawned) this.#active.set(spawn.spawnId, spawn)
    return this.#transition([], spawned, spawned.map(spawn => ({ type: 'TargetSpawned', ...spawn })))
  }

  fixed(context) {
    const time = this.#time(context)
    if (!this.running || this.#config.mode !== 'shooting-test')
      return this.#transition()
    const expired = [
      ...this.#active.values(),
    ].filter(spawn => time.fixedTick >= spawn.deadlineTick)
    if (!expired.length)
      return this.#transition()
    for (const spawn of expired) this.#remove(spawn)
    this.#settled += expired.length
    return this.#finish(time, expired.map(spawn => ({ spawn, reason: 'expired' })), expired.map(spawn => ({
      type: 'TargetExpired',
      ...spawn,
      at: time.fixedElapsed,
    })))
  }

  resolveDeaths(deaths, context) {
    const time = this.#time(context)
    // Caller MUST process fixed expiry before shooting, not after a potentially lethal commit.
    if (this.running && this.#config.mode === 'shooting-test'
      && [
        ...this.#active.values(),
      ].some(spawn => time.fixedTick >= spawn.deadlineTick)) {
      throw new Error('[Challenge] Deadline must be processed before this step shoots')
    }
    if (!this.running)
      return this.#transition()
    const accepted = new Map()
    for (const death of deaths) {
      const spawn = this.#active.get(death.spawnId)
      if (death.sessionId !== this.#sessionId || !spawn || spawn.targetId !== death.targetId || spawn.cellId !== death.cellId)
        continue
      if (death.at !== time.fixedElapsed || death.fixedTick !== time.fixedTick
        || !Number.isSafeInteger(death.pelletIndex) || death.pelletIndex < 0) {
        throw new RangeError('[Challenge] Death does not belong to the current fixed shot')
      }
      const previous = accepted.get(death.spawnId)
      if (!previous || deathOrder(death, previous) < 0)
        accepted.set(death.spawnId, death)
    }
    const ordered = [
      ...accepted.values(),
    ].sort(deathOrder)
    const removed = ordered.map(death => ({
      spawn: this.#active.get(death.spawnId),
      reason: 'killed',
      death,
    }))
    for (const { spawn } of removed) this.#remove(spawn)
    this.#kills += Math.min(ordered.length, this.#config.goal - this.#kills)
    if (this.#config.mode === 'shooting-test')
      this.#settled += ordered.length
    return ordered.length
      ? this.#finish(time, removed, [])
      : this.#transition()
  }

  #remove(spawn) {
    this.#active.delete(spawn.spawnId)
    this.#lastCellId = spawn.cellId
  }

  #finish(time, removed, events) {
    events.push({
      type: 'ChallengeProgress',
      at: time.fixedElapsed,
      kills: this.#kills,
      settled: this.#settled,
    })
    const done = this.#config.mode === 'shooting-test'
      ? this.#settled === this.#config.goal
      : this.#kills === this.#config.goal
    if (done) {
      this.#status = 'completed'
      this.#result = immutableFact({
        sessionId: this.#sessionId,
        config: this.#config,
        kills: this.#kills,
        settled: this.#settled,
        startedAt: this.#startedAt,
        completedAt: time.fixedElapsed,
        elapsed: time.fixedElapsed - this.#startedAt,
      })
      for (const spawn of this.#active.values()) removed.push({ spawn, reason: 'completed' })
      this.#active.clear()
      events.push({ type: 'ChallengeCompleted', at: time.fixedElapsed, result: this.#result })
    }
    return this.#transition(removed, [], events)
  }

  cancel(reason = 'cancelled') {
    const removed = [
      ...this.#active.values(),
    ].map(spawn => ({ spawn, reason }))
    const wasRunning = this.running
    this.#active.clear()
    if (wasRunning) {
      this.#status = 'idle'
      this.#result = null
    }
    return this.#transition(removed, [], wasRunning
      ? [
          { type: 'ChallengeCancelled', reason },
        ]
      : [])
  }

  #transition(removed = [], spawned = [], events = []) {
    return immutableFact({
      sessionId: this.#sessionId,
      removed,
      spawned,
      events,
      deficit: this.deficit,
    })
  }

  snapshot() {
    return immutableFact({
      status: this.#status,
      sessionId: this.#sessionId,
      config: this.#config,
      active: [
        ...this.#active.values(),
      ],
      kills: this.#kills,
      settled: this.#settled,
      startedAt: this.#startedAt,
      result: this.#result,
      deficit: this.deficit,
      lastCellId: this.#lastCellId,
    })
  }
}
