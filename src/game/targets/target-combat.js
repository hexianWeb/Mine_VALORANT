import { CombatAttributes, resolveDamage } from '../combat/attributes.js'
import { fixedTime, identifier, immutableFact, sameSpawn } from '../combat/facts.js'
import { fixedDamage } from '../combat/fixed-damage.js'

/** A single life. No registration, feedback callbacks, challenge progress or respawning. */
export class TargetCombat {
  #spawn = null
  #attributes = new CombatAttributes()
  #eligible = false
  #revision = 0

  activate(spawn, { maxHealth = 100, maxArmor = 0 } = {}) {
    identifier(spawn?.sessionId, 'sessionId')
    identifier(spawn?.spawnId, 'spawnId')
    identifier(spawn?.cellId, 'cellId')
    const attributes = new CombatAttributes({ maxHealth, maxArmor })
    this.#spawn = immutableFact(spawn)
    this.#attributes = attributes
    this.#eligible = true
    this.#revision++
  }

  deactivate() { this.#eligible = false }

  get identity() { return this.#spawn }
  get eligible() { return this.#eligible && this.#attributes.snapshot().alive }

  matches(impact) {
    return this.eligible && sameSpawn(impact, this.#spawn)
      && impact.cellId === this.#spawn.cellId
  }

  /** Preview every pellet, including ones after lethal, so bad configuration is always atomic. */
  prepareDamage(entries, shot, context) {
    const time = fixedTime(context)
    if (!this.eligible)
      return null
    let state = this.#attributes.snapshot()
    const damage = []
    let lethal = null
    for (const { index, impact } of entries) {
      if (!this.matches(impact))
        continue
      const amount = fixedDamage(shot.definitionId, impact.region)
      const next = resolveDamage(state, amount)
      if (state.alive) {
        const record = {
          ...this.#spawn,
          targetId: impact.targetId,
          pelletIndex: index,
          region: impact.region,
          amount,
          healthDamage: next.healthDamage,
          armorDamage: next.armorDamage,
          health: next.health,
          armor: next.armor,
          killed: next.killed,
          fixedTick: time.fixedTick,
          at: time.fixedElapsed,
          impact,
        }
        damage.push(record)
        if (next.killed)
          lethal = record
      }
      state = { ...next, alive: next.health > 0 }
    }
    return damage.length
      ? immutableFact({
          identity: this.#spawn,
          revision: this.#revision,
          damage,
          lethal,
        })
      : null
  }

  /** Registry has already prepared ALL targets; this method does not call external code. */
  commitDamage(plan) {
    if (!this.eligible || plan.revision !== this.#revision || !sameSpawn(plan.identity, this.#spawn))
      return null
    for (const hit of plan.damage) this.#attributes.applyDamage(hit.amount)
    this.#revision++
    if (plan.lethal)
      this.#eligible = false
    return plan
  }

  snapshot() {
    return immutableFact({
      identity: this.#spawn,
      eligible: this.eligible,
      attributes: this.#attributes.snapshot(),
    })
  }
}
