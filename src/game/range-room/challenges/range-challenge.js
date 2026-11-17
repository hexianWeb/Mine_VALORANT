import { Component } from '../../../engine/runtime/function/framework/index.js'
import { fixedTime, immutableFact } from '../../combat/facts.js'
import { ChallengeSession } from './challenge-session.js'
import { lockChallengeConfig } from './config.js'
import { SpawnGrid } from './spawn-grid.js'

let nextOwner = 0

/**
 * Logic adapter, not assembled into the level yet. Level retains ownership of every target GO.
 * pool.acquire(count) synchronously lends preloaded {id, bot} handles; pool.release returns them.
 * pool.available() excludes bodies/presentation records that are not yet reusable.
 */
export class RangeChallengeComponent extends Component {
  static phases = ['fixed', 'motion']
  #owner = `range-challenge:${++nextOwner}`
  #session = new ChallengeSession()
  #grid
  #pool
  #random
  #fixedDelta
  #hideTicks
  #canStart
  #practice
  #selection = null
  #revision = 0
  #reason = 'Challenge not prepared'
  #active = new Map()
  #retiring = new Map()
  #pending = []
  #presented = null
  #presentationAt = 0
  #lastShot = new Map()
  #cancelQueued = false
  #at = 0
  #seenResults = new WeakSet()
  #onPracticeRequested
  #onSensitivityRequested

  constructor({ cells, pool, random, fixedDelta, bodyHideDelay, canStart = () => true, setPracticeEnabled = () => {}, onPracticeRequested = null, onSensitivityRequested = null }) {
    super()
    if (typeof random !== 'function' || !Number.isFinite(bodyHideDelay) || bodyHideDelay <= 0
      || !Number.isFinite(fixedDelta) || fixedDelta <= 0
      || !['acquire', 'release', 'available'].every(key => typeof pool?.[key] === 'function')) {
      throw new TypeError('[RangeChallenge] Preloaded target pool, fixed retirement plan and random source required')
    }
    this.#grid = new SpawnGrid(cells)
    this.#pool = pool
    this.#random = random
    this.#fixedDelta = fixedDelta
    this.#hideTicks = Math.ceil(bodyHideDelay / fixedDelta - 1e-10)
    this.#canStart = canStart
    this.#practice = setPracticeEnabled
    this.#onPracticeRequested = onPracticeRequested
    this.#onSensitivityRequested = onSensitivityRequested
  }

  prepare(selection) {
    if (this.#session.running || this.disposed)
      return false
    const config = lockChallengeConfig(selection, this.#fixedDelta)
    this.#selection = immutableFact(selection)
    this.#revision++
    try {
      this.#grid.assertCapacity(config.concurrency)
      this.#reason = null
    }
    catch (error) {
      this.#reason = error.message
    }
    return !this.#reason
  }

  readControlState() {
    const config = this.#selection && lockChallengeConfig(this.#selection, this.#fixedDelta)
    // Starting a new session invalidates its old retirements, but the prepared pool must
    // still cover an ENTIRE simultaneous replacement batch, not just the initial N.
    const required = config
      ? config.concurrency * 2
      : 0
    let reason = this.#reason
    if (!reason) {
      if (this.disposed)
        reason = 'Challenge unloaded'
      else if (this.running)
        reason = 'Challenge running'
      else if (!this.#canStart())
        reason = 'Equipment selection is not ready'
      else if (this.#pool.available() + this.#retiring.size < required)
        reason = 'Pool needs initial targets plus retirement buffer'
    }
    return immutableFact({
      enabled: !this.disposed && !this.#session.running,
      ready: !reason,
      reason,
      revision: this.#revision,
      selection: this.#selection,
    })
  }

  get running() { return this.#session.running }

  armoryRestriction() { return this.running ? '本局进行中，请先取消挑战' : null }
  requestCancel() {
    if (this.running)
      this.#cancelQueued = true
  }

  #record(events, at) {
    this.#pending.push(immutableFact({
      at,
      events,
      simulation: this.#session.snapshot(),
    }))
  }

  #cleanupTargets(reason, at) {
    for (const handle of [
      ...this.#active.values(),
      ...[
        ...this.#retiring.values(),
      ].map(entry => entry.handle),
    ]) {
      if (handle.bot.invalidateSpawn)
        handle.bot.invalidateSpawn(at, reason)
      else
        handle.bot.removeSpawn(at, reason)
      this.#pool.release(handle, reason)
    }
    this.#active.clear()
    this.#retiring.clear()
  }

  /** Lifecycle invalidation is immediate even when the player no longer receives ticks. */
  cancel(reason = 'cancelled', at = this.#at) {
    this.#session.cancel(reason)
    this.#cleanupTargets(reason, at)
    this.#grid.reset(`${this.#owner}:invalid:${++this.#revision}`)
    this.#pending = []
    this.#presented = null
    this.#cancelQueued = false
  }

  #spawn(time) {
    const state = this.#session.snapshot()
    const count = state.deficit
    if (!count)
      return
    if (this.#pool.available() < count)
      throw new Error('[RangeChallenge] Pool replacement capacity exhausted')
    const placements = this.#grid.allocateBatch(state.sessionId, this.#session.nextSpawnIds(), this.#random, state.config.mode === 'shooting-test' && state.lastCellId
      ? [state.lastCellId]
      : [])
    const handles = this.#pool.acquire(count)
    if (!Array.isArray(handles) || handles.length !== count || new Set(handles.map(handle => handle.id)).size !== count) {
      if (Array.isArray(handles)) {
        for (const handle of new Set(handles)) this.#pool.release(handle, 'invalid-batch')
      }
      throw new Error('[RangeChallenge] Pool failed synchronous batch readiness')
    }
    // Include every acquired handle in cleanup even if activation detects a bad adapter.
    for (const handle of handles) this.#active.set(handle.id, handle)
    const transition = this.#session.activateBatch(placements.map((placement, index) => ({
      targetId: handles[index].id,
      cellId: placement.cellId,
      position: placement.position,
      quaternion: [0, 0, 0, 1],
      scale: [1, 1, 1],
      bodyHideTicks: this.#hideTicks,
    })), time)
    for (const spawn of transition.spawned)
      this.#active.get(spawn.targetId).bot.activateSpawn(spawn, state.config, time)
    this.#record(transition.events, time.fixedElapsed)
  }

  #apply(transition, time) {
    for (const { spawn, reason } of transition.removed) {
      const handle = this.#active.get(spawn.targetId)
      if (!handle)
        continue
      this.#active.delete(spawn.targetId)
      if (reason === 'killed') {
        const releaseAt = (time.fixedTick + this.#hideTicks) * this.#fixedDelta
        this.#grid.retire(spawn, releaseAt)
        this.#retiring.set(spawn.spawnId, { handle, releaseAt })
      }
      else {
        this.#grid.release(spawn)
        handle.bot.removeSpawn(time.fixedElapsed, reason)
        this.#pool.release(handle, reason)
      }
    }
    if (transition.events.length)
      this.#record(transition.events, time.fixedElapsed)
    this.#spawn(time)
  }

  #abort(error, time) {
    this.cancel('capacity-error', time.fixedElapsed)
    this.#reason = error.message
  }

  /** This is injected directly into PlayerWeapons; it runs AFTER resolveShot returned. */
  onShotResolved(result, context) {
    const time = fixedTime(context)
    if (this.disposed || result.disposition === 'ignored' || result.fixedTick !== time.fixedTick || result.at !== time.fixedElapsed
      || time.fixedElapsed < this.#at || time.fixedDelta !== this.#fixedDelta || this.#seenResults.has(result)) {
      return
    }
    this.#at = time.fixedElapsed
    this.#seenResults.add(result)
    const cursor = this.#lastShot.get(result.sourceId)
    if (cursor && (result.epoch < cursor.epoch || (result.epoch === cursor.epoch && result.sequence <= cursor.sequence)))
      return
    this.#lastShot.set(result.sourceId, { epoch: result.epoch, sequence: result.sequence })
    // Retain cursors only for the current small set of live sources. The registry remains
    // the authoritative source lifecycle gate; this guard covers repeated observer delivery.
    if (this.#lastShot.size > 16)
      this.#lastShot.delete(this.#lastShot.keys().next().value)
    const practice = result.interactions.find(command => command.type === 'PracticeRequested')
    if (practice && !this.running)
      this.#onPracticeRequested?.(practice, time)
    const sensitivity = result.interactions.find(command => command.type === 'SensitivityRequested')
    if (sensitivity)
      this.#onSensitivityRequested?.(sensitivity, time)
    const start = result.interactions.find(command => command.type === 'StartRequested')
    if (start) {
      const control = this.readControlState()
      if (!control.enabled || !control.ready || start.revision !== this.#revision
        || JSON.stringify(start.selection) !== JSON.stringify(this.#selection)) {
        return
      }
      this.#cleanupTargets('new-session', time.fixedElapsed)
      this.#pending = []
      this.#practice(false, time.fixedElapsed)
      const transition = this.#session.start(start.selection, time, this.#owner)
      this.#grid.reset(transition.sessionId)
      this.#record(transition.events, time.fixedElapsed)
    }
    try {
      this.#apply(this.#session.resolveDeaths(result.deaths, time), time)
    }
    catch (error) {
      this.#abort(error, time)
    }
  }

  tick({ phase, time }) {
    if (phase === 'fixed') {
      fixedTime(time)
      if (time.fixedDelta !== this.#fixedDelta || time.fixedElapsed < this.#at)
        throw new RangeError('[RangeChallenge] Invalid fixed clock')
      this.#at = time.fixedElapsed
      if (this.#cancelQueued) {
        this.cancel('cancelled', time.fixedElapsed)
        return
      }
      this.#grid.releaseDue(time.fixedElapsed)
      for (const [id, { handle, releaseAt }] of this.#retiring) {
        if (time.fixedElapsed >= releaseAt) {
          this.#pool.release(handle, 'body-hidden')
          this.#retiring.delete(id)
        }
      }
      try {
        this.#apply(this.#session.fixed(time), time)
      }
      catch (error) {
        this.#abort(error, time)
      }
    }
    else if (phase === 'motion') {
      const at = time.presentationTime
      if (!Number.isFinite(at) || at < this.#presentationAt)
        throw new RangeError('[RangeChallenge] Invalid presentation cursor')
      while (this.#pending.length && this.#pending[0].at <= at)
        this.#presented = this.#pending.shift().simulation
      this.#presentationAt = at
    }
  }

  snapshot() {
    return immutableFact({
      simulation: this.#session.snapshot(),
      grid: this.#grid.snapshot(),
      presentation: { presentationTime: this.#presentationAt, state: this.#presented },
      pending: this.#pending.length,
      reason: this.#reason,
      bodyHideTicks: this.#hideTicks,
    })
  }

  dispose() {
    if (this.disposed)
      return
    this.cancel('unload')
    this.#lastShot.clear()
    super.dispose()
  }
}
