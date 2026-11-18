let nextOwner = 0
const terminal = new Set(['ready', 'failed', 'superseded'])

/** Scoped shop intent. Equipment owns the fixed-step replacement and preparation. */
export class PracticeArmory {
  #owner = ++nextOwner
  #generation = 1
  #catalog
  #purchasing
  #access
  #equipment
  #readSlot
  #view = null
  #request = null
  #queued = false
  #logicalDone = false
  #lastRequest = 0
  #enabled = true
  #paused = false
  #closed = false
  #model = null

  constructor({ catalog, equipment, readSlot, access = () => null, purchasing = false }) {
    this.#catalog = catalog
    this.#equipment = equipment
    this.#readSlot = readSlot
    this.#purchasing = purchasing
    this.setAccess(access)
  }

  get scopeId() { return `practice-armory:${this.#owner}:${this.#generation}` }

  setAccess(check) {
    if (typeof check !== 'function')
      throw new TypeError('[Armory] Access check must be a game-owned function returning a reason or null')
    this.#access = check
  }

  #restriction() {
    if (this.#closed)
      return '关卡已卸载'
    if (!this.#enabled)
      return '观察模式中不可选择武器'
    return this.#access() || null
  }

  #pending() { return this.#request && !terminal.has(this.#request.status) }

  #patch(patch) {
    if (Object.entries(patch).some(([key, value]) => this.#request[key] !== value)) {
      this.#request = Object.freeze({
        ...this.#request,
        ...patch,
      })
    }
  }

  #fail(reason, status = 'failed') {
    this.#queued = false
    this.#logicalDone = false
    this.#patch({ status, reason })
  }

  request({ scopeId, requestId, slotId, definitionId } = {}) {
    const reason = this.#restriction()
    const slot = this.#catalog.find(entry => this.#purchasing || definitionId !== undefined
      ? entry.id === definitionId
      : entry.slotId === slotId)
    if (reason || scopeId !== this.scopeId || !Number.isSafeInteger(requestId) || requestId <= this.#lastRequest || !slot)
      return Object.freeze({ accepted: false, reason: reason ?? '选择请求已过期或槽位无效' })
    if (this.#pending() && this.#request.definitionId === slot.id)
      return Object.freeze({ accepted: false, reason: '该武器正在准备，请勿重复提交' })
    this.#lastRequest = requestId
    const held = this.#purchasing
      ? this.#readSlot(slot.slotId)
      : null
    const purchase = this.#purchasing && held?.definitionId !== slot.id
    this.#request = Object.freeze({
      scopeId,
      requestId,
      slotId: slot.slotId,
      definitionId: slot.id,
      instanceId: purchase
        ? `${this.scopeId}:weapon:${requestId}`
        : held?.instanceId ?? slot.instanceId,
      purchase,
      status: 'queued',
      reason: null,
    })
    this.#queued = true
    this.#logicalDone = false
    return Object.freeze({ accepted: true, reason: null })
  }

  /** Called only before a valid controller fixed step; paused DOM requests wait here. */
  beforeFixed(queue) {
    // Once authority finished, only P confirmation remains. A later challenge must not
    // retroactively fail that accepted choice or make its acceptance depend on rendering.
    if (!this.#pending() || this.#paused || this.#logicalDone)
      return
    const reason = this.#restriction()
    if (reason) {
      // Cancel an uncommitted preparation/holster through normal selection. Never roll back
      // an EquipCommitted fact, spend ammo, suspend the player or rewrite inventory.
      if (!this.#queued && !this.#logicalDone && this.#equipment.activeId)
        queue({ type: 'select', instanceId: this.#equipment.activeId })
      this.#fail(reason)
      return
    }
    if (this.#queued) {
      const { slotId, definitionId, instanceId, purchase } = this.#request
      const command = purchase
        ? {
            type: 'purchase',
            slotId,
            definitionId,
            instanceId,
          }
        : { type: 'selectSlot', slotId }
      if (!queue(command)) {
        this.#fail('当前不能提交装备选择')
        return
      }
      this.#queued = false
      this.#patch({ status: 'preparing' })
    }
  }

  /** Accept fixed readiness independently of when presentation catches up. */
  accept(equipment) {
    this.#equipment = equipment
    if (!this.#pending() || this.#queued)
      return
    const target = this.#request.instanceId
    const preparation = equipment.preparation
    if (preparation?.ticket.instanceId === target && preparation.status === 'failed') {
      this.#fail(preparation.error ?? '武器资源准备失败，请重试')
      return
    }
    const intended = equipment.queuedTarget ?? preparation?.ticket.instanceId
      ?? equipment.switchTarget ?? equipment.activeId
    if (intended !== target) {
      this.#fail('已由新的装备选择替代', 'superseded')
      return
    }
    this.#logicalDone = equipment.activeId === target && equipment.phase === 'Ready'
      && !equipment.switchTarget && (!preparation || preparation.status === 'failed')
    this.#patch({
      status: this.#logicalDone
        ? 'presenting'
        : equipment.switchTarget === target || equipment.activeId === target
          ? 'drawing'
          : 'preparing',
    })
    this.#completePresented()
  }

  present(view) {
    this.#view = view
    this.#completePresented()
  }

  #completePresented() {
    if (this.#pending() && !this.#queued && this.#logicalDone
      && this.#view?.weapon?.instanceId === this.#request.instanceId
      && !['draw', 'holster'].includes(this.#view.action)) {
      this.#patch({ status: 'ready' })
    }
  }

  supersede() {
    if (this.#pending())
      this.#fail('已通过其他装备操作改选', 'superseded')
  }

  setPaused(value) { this.#paused = !!value }

  setEnabled(value) {
    if (this.#enabled === !!value)
      return
    this.#enabled = !!value
    if (!value)
      this.invalidate()
  }

  invalidate() {
    this.#generation++
    this.#lastRequest = 0
    this.#queued = false
    this.#logicalDone = false
    this.#request = null
    this.#view = null
  }

  /** Authoritative readiness: never depends on P, HUD sampling, or modal visibility. */
  canStartChallenge() {
    const equipment = this.#equipment
    return !this.#restriction() && !this.#paused && !this.#queued
      && equipment.phase === 'Ready' && !!equipment.activeId && !equipment.switchTarget
      && (!equipment.preparation || equipment.preparation.status === 'failed')
      && !equipment.hasPendingSkin
  }

  read() {
    const restriction = this.#restriction()
    const presentedId = this.#view?.weapon?.instanceId ?? null
    const presentedSlotId = this.#view?.weapon?.slotId ?? this.#catalog.find(entry => entry.instanceId && entry.instanceId === presentedId)?.slotId ?? null
    const presentedDefinitionId = this.#view?.weapon?.melee
      ? null
      : this.#view?.weapon?.definitionId ?? this.#catalog.find(entry => entry.instanceId && entry.instanceId === presentedId)?.id ?? null
    const primary = this.#purchasing
      ? this.#readSlot('primary')?.definitionId ?? null
      : null
    const secondary = this.#purchasing
      ? this.#readSlot('secondary')?.definitionId ?? null
      : null
    const canStartChallenge = this.canStartChallenge()
    const previous = this.#model
    if (previous && previous.scopeId === this.scopeId && previous.request === this.#request
      && previous.presentedSlotId === presentedSlotId && previous.restriction === restriction
      && previous.presentedDefinitionId === presentedDefinitionId && previous.primary === primary && previous.secondary === secondary
      && previous.paused === this.#paused && previous.canStartChallenge === canStartChallenge) {
      return previous
    }
    this.#model = Object.freeze({
      scopeId: this.scopeId,
      revision: (previous?.revision ?? 0) + 1,
      catalog: this.#catalog,
      presentedSlotId,
      presentedDefinitionId,
      primary,
      secondary,
      request: this.#request,
      restriction,
      available: !restriction,
      paused: this.#paused,
      canStartChallenge,
    })
    return this.#model
  }

  dispose() {
    this.#closed = true
    this.invalidate()
  }
}
