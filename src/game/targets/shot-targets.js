/** Level-local, with shot queries and reactions separated so pellets see the same pose. */
export class ShotTargets {
  #targets = new Map()

  register(id, target) {
    if (this.#targets.has(id))
      throw new Error(`[ShotTargets] Duplicate target: ${id}`)
    this.#targets.set(id, target)
    return () => {
      if (this.#targets.get(id) === target)
        this.#targets.delete(id)
    }
  }

  trace(origin, direction, limit) {
    let nearest = limit
    let result = null
    for (const [id, target] of this.#targets) {
      const hit = target.trace(origin, direction, nearest)
      if (!hit || hit.distance >= nearest)
        continue
      nearest = hit.distance
      result = { ...hit, hit: id, targetId: id }
    }
    return result && {
      ...result,
      position: origin.map((value, axis) => value + direction[axis] * nearest),
    }
  }

  react(impacts, timing) {
    const nearestByTarget = new Map()
    for (const impact of impacts) {
      if (!impact.targetId)
        continue
      const previous = nearestByTarget.get(impact.targetId)
      if (!previous || impact.distance < previous.distance)
        nearestByTarget.set(impact.targetId, impact)
    }
    for (const [id, impact] of nearestByTarget)
      this.#targets.get(id)?.react(impact, timing)
  }
}
