// All durations use foreground, unpaused real seconds. The world/weapon clocks stay untouched.
export const haoqiRules = Object.freeze({
  seconds: 30,
  targets: 4,
  cap: 180,
  initial: 108,
  base: 5,
  acquire: 0.15,
})

export class HaoqiTrial {
  #chargeCents = haoqiRules.initial * 100
  multiplier = 100
  outsideKills = 0
  flowKills = 0
  enters = 0
  firstFlow = null
  firstConfirm = null
  firstReturnShot = null
  #waitingReturn = false
  #now
  #start
  #pause = null
  #until = null
  #entered = 0
  #chain = 0
  #batch = []
  #visible = []
  #emit

  constructor(emit, now = () => performance.now() / 1000) {
    this.#emit = emit
    this.#now = now
    this.#start = now()
  }

  get elapsed() { return Math.min(haoqiRules.seconds, (this.#pause ?? this.#now()) - this.#start) }
  get inFlow() { return this.#until !== null }
  get charge() { return this.#chargeCents / 100 }
  get remaining() { return Math.max(0, (this.#until ?? 0) - this.elapsed) }
  get confirmed() { return this.#batch.length > 0 }
  get locks() {
    return this.confirmed
      ? this.#batch.map(id => this.#visible.find(target => target.id === id)).filter(Boolean)
      : this.#visible
  }

  pause(value) {
    if (value && this.#pause === null) {
      this.#pause = this.#now()
    }
    else if (!value && this.#pause !== null) {
      this.#start += this.#now() - this.#pause
      this.#pause = null
    }
  }

  update(readTargets) {
    if (!this.inFlow)
      return
    if (this.elapsed >= this.#until) {
      this.exit('elapsed')
      return
    }
    this.#visible = readTargets()
    this.#batch = this.#batch.filter(id => this.#visible.some(target => target.id === id))
  }

  // The equipment controller still owns cadence, ammo, reload and accepted shots.
  allowFire(pressed, weapon) {
    if (weapon !== 'vandal' || this.elapsed >= haoqiRules.seconds)
      return false
    if (!this.inFlow)
      return true
    if (pressed && !this.confirmed && this.#visible.length) {
      this.#batch = this.#visible.map(target => target.id)
      this.firstConfirm ??= this.elapsed
      this.#emit('flow_confirm')
    }
    return this.confirmed && this.elapsed >= this.#entered + haoqiRules.acquire
  }

  guide(origin) {
    if (!this.inFlow || !this.confirmed)
      return null
    const lock = this.locks[0]
    if (!lock)
      return null
    const vector = lock.point.map((v, i) => v - origin[i])
    const length = Math.hypot(...vector)
    return length
      ? vector.map(v => v / length)
      : null
  }

  settle(result, killed) {
    if (result.attackType !== 'ShotFired' || result.disposition === 'interaction' || result.definitionId !== 'vandal')
      return
    if (this.inFlow) {
      for (const { spawn } of killed) {
        this.#until += 0.5 * 0.8 ** this.#chain++
        this.#batch = this.#batch.filter(id => id !== spawn.spawnId)
        this.#visible = this.#visible.filter(target => target.id !== spawn.spawnId)
        this.flowKills++
        this.#emit('flow_extend')
      }
      return
    }
    if (this.#waitingReturn) {
      this.#waitingReturn = false
      this.firstReturnShot ??= this.elapsed
      this.#emit('post_flow_shot')
    }
    this.multiplier = result.damage.length
      ? Math.min(300, this.multiplier + 10)
      : Math.max(100, Math.floor(this.multiplier / 2))
    for (const { death } of killed) {
      this.outsideKills++
      this.#chargeCents = Math.min(haoqiRules.cap * 100, this.#chargeCents + (death.region === 'head'
        ? 10
        : 6) * this.multiplier)
    }
    if (this.charge >= haoqiRules.cap) {
      this.#entered = this.elapsed
      this.#until = this.#entered + haoqiRules.base
      this.firstFlow ??= this.#entered
      this.enters++
      this.#chain = 0
      this.#emit('flow_enter')
    }
  }

  exit(reason) {
    if (!this.inFlow)
      return
    this.#until = null
    this.#visible = []
    this.#batch = []
    this.#chargeCents = 0
    this.multiplier = 100
    this.#waitingReturn = true
    this.#emit('flow_exit', reason)
  }

  summary() {
    const ms = t => t === null
      ? null
      : Math.round(t * 1000)
    return {
      outside_kills: this.outsideKills,
      flow_kills: this.flowKills,
      flow_count: this.enters,
      first_flow_ms: ms(this.firstFlow),
      first_confirm_ms: ms(this.firstConfirm),
      first_post_flow_shot_ms: ms(this.firstReturnShot),
    }
  }
}
