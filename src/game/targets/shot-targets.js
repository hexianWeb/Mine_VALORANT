import { deathOrder, fixedTime, identifier, immutableFact } from '../combat/facts.js'

let nextSource = 0

const vector = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)

/** Level-local query/commit boundary. It owns neither weapon damage tables nor challenge rules. */
export class ShotTargets {
  #targets = new Map()
  #sources = new Map()
  #registration = 0
  #query = null
  #resolving = false

  openSource(epoch) {
    const id = `shot-source:${++nextSource}`
    this.#sources.set(id, { epoch: 0, sequence: 0 })
    this.setSourceEpoch(id, epoch)
    return id
  }

  setSourceEpoch(id, epoch) {
    const cursor = this.#sources.get(id)
    if (!cursor || !Number.isSafeInteger(epoch) || epoch < 1 || epoch < cursor.epoch)
      throw new RangeError('[ShotTargets] Invalid source epoch')
    if (epoch > cursor.epoch) {
      cursor.epoch = epoch
      cursor.sequence = 0
    }
  }

  closeSource(id) { this.#sources.delete(id) }

  register(id, target) {
    identifier(id, 'target id')
    if (this.#targets.has(id) || this.#resolving)
      throw new Error(`[ShotTargets] Duplicate target or registration during commit: ${id}`)
    const entry = { target, registrationId: ++this.#registration }
    this.#targets.set(id, entry)
    return () => {
      if (this.#targets.get(id) === entry)
        this.#targets.delete(id)
    }
  }

  /** Called once BEFORE tracing all pellets; pose sampling is idempotent per fixed timestamp. */
  beginShot(context) {
    const time = fixedTime(context, 'postPhysics')
    this.#query = [...this.#targets].map(([id, entry]) => {
      entry.target.preparePose?.(time)
      return {
        id,
        ...entry,
        identity: immutableFact(entry.target.captureIdentity?.() ?? {}),
      }
    })
  }

  trace(origin, direction, limit) {
    let nearest = limit
    let result = null
    const entries = this.#query ?? [...this.#targets].map(([id, entry]) => ({
      id,
      ...entry,
      identity: entry.target.captureIdentity?.() ?? {},
    }))
    for (const { id, target, registrationId, identity } of entries) {
      const hit = target.trace(origin, direction, nearest)
      if (!hit || hit.distance >= nearest)
        continue
      nearest = hit.distance
      result = {
        ...hit,
        ...identity,
        hit: id,
        targetId: id,
        registrationId,
      }
    }
    return result && immutableFact({
      ...result,
      position: origin.map((value, axis) => value + direction[axis] * nearest),
    })
  }

  resolveShot(event, context) {
    this.#query = null
    if (this.#resolving)
      throw new Error('[ShotTargets] Reentrant shot resolution')
    const { sourceId, epoch, sequence } = event ?? {}
    if (typeof sourceId !== 'string' || !Number.isSafeInteger(epoch) || epoch < 1
      || !Number.isSafeInteger(sequence) || sequence < 1) {
      throw new TypeError('[ShotTargets] Missing accepted shot identity')
    }
    const cursor = this.#sources.get(sourceId)
    const base = {
      sourceId,
      epoch,
      sequence,
      fixedTick: event.fixedTick,
      at: event.at,
    }
    const result = (disposition, damage = [], deaths = [], reactions = [], interactions = []) => immutableFact({
      ...base,
      attackType: event.type,
      definitionId: event.payload?.weapon?.definitionId,
      magazineAfter: event.payload?.magazine,
      ammoPolicy: event.payload?.weapon?.ammoPolicy,
      disposition,
      damage,
      deaths,
      reactions,
      interactions,
    })
    if (!cursor || epoch !== cursor.epoch || sequence <= cursor.sequence)
      return result('ignored')
    const time = fixedTime(context, 'postPhysics')
    const payload = event.payload
    const melee = event.type === 'MeleeContact'
    if ((!melee && event.type !== 'ShotFired') || event.fixedTick !== time.fixedTick || event.at !== time.fixedElapsed
      || typeof event.instanceId !== 'string' || !payload?.weapon?.definitionId) {
      throw new TypeError('[ShotTargets] Expected this fixed step\'s accepted attack')
    }
    const shot = immutableFact({ ...base, instanceId: event.instanceId, definitionId: payload.weapon.definitionId })
    const pellets = (melee ? undefined : payload.pellets) ?? [
      {
        index: 0,
        direction: melee ? payload.direction : payload.shotDirection,
        impact: payload.impact,
      },
    ]
    if (!Array.isArray(pellets) || !pellets.length)
      throw new TypeError('[ShotTargets] Empty pellet batch')
    const indices = new Set()
    const groups = new Map()
    for (const pellet of pellets) {
      const { index, impact, direction } = pellet
      if (!Number.isSafeInteger(index) || index < 0 || indices.has(index) || !vector(direction)
        || Math.abs(Math.hypot(...direction) - 1) > 1e-6 || !impact || !Number.isFinite(impact.distance)
        || impact.distance < 0 || !vector(impact.position)
        || (impact.normal !== null && !vector(impact.normal))) {
        throw new TypeError('[ShotTargets] Invalid/duplicate pellet or impact')
      }
      indices.add(index)
      if (!impact.targetId)
        continue
      const entry = this.#targets.get(impact.targetId)
      if (!entry || entry.registrationId !== impact.registrationId)
        continue
      if (!groups.has(impact.targetId))
        groups.set(impact.targetId, { target: entry.target, entries: [] })
      groups.get(impact.targetId).entries.push(immutableFact(pellet))
    }
    const orderedGroups = [...groups].sort(([a], [b]) => a.localeCompare(b))
    for (const [, group] of orderedGroups) group.entries.sort((a, b) => a.index - b.index)

    this.#resolving = true
    try {
      // Pure preview only: an accepted interaction consumes the ENTIRE shot.
      const interactionGroups = melee
        ? []
        : orderedGroups
      const commands = interactionGroups.flatMap(([targetId, { target, entries }]) => {
        const command = target.prepareInteraction?.(entries, shot, time)
        return command
          ? [
              { targetId, ...command },
            ]
          : []
      }).sort((a, b) => a.pelletIndex - b.pelletIndex || a.targetId.localeCompare(b.targetId))
      if (commands.length) {
        cursor.sequence = sequence
        return result('interaction', [], [], [], [commands[0]])
      }
      // No target mutates until every preview has succeeded, including all late pellets.
      const plans = orderedGroups.flatMap(([, { target, entries }]) => {
        const plan = target.prepareDamage?.(entries, shot, time)
        return plan
          ? [
              { target, plan },
            ]
          : []
      })
      for (const { plan } of plans) {
        if ((!plan.practice && !Array.isArray(plan.damage)) || (plan.damage ?? []).some(hit => !Number.isFinite(hit.amount)
          || hit.amount <= 0 || !Number.isFinite(hit.healthDamage) || hit.healthDamage < 0
          || !Number.isFinite(hit.armorDamage) || hit.armorDamage < 0)) {
          throw new TypeError('[ShotTargets] Invalid precomputed target damage')
        }
      }
      const damage = []
      const deaths = []
      const reactions = []
      for (const { target, plan } of plans) {
        const committed = target.commitDamage(plan, shot, time)
        damage.push(...committed.damage)
        deaths.push(...committed.deaths)
        reactions.push(...committed.reactions)
      }
      cursor.sequence = sequence
      damage.sort((a, b) => a.pelletIndex - b.pelletIndex || a.targetId.localeCompare(b.targetId))
      deaths.sort(deathOrder)
      return result(plans.length ? 'combat' : 'none', damage, deaths, reactions)
    }
    finally {
      this.#query = null
      this.#resolving = false
    }
  }
}
