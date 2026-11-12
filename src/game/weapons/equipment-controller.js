import { WeaponInventory } from './inventory.js'
import { canReloadWeapon, commitReload, durationTicks, fireWeapon } from './weapon-logic.js'

const actionCommands = new Set(['fire', 'reload', 'inspect'])
const commandTypes = new Set([
  ...actionCommands,
  'fireHeld',
  'select',
  'selectSlot',
  'cycle',
  'selectPrevious',
  'prepared',
  'prepareFailed',
  'setSkin',
  'cycleSkin',
  'skinPrepared',
  'skinFailed',
])

function immutable(value) {
  if (Array.isArray(value))
    return Object.freeze(value.map(immutable))
  if (value && typeof value === 'object') {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      immutable(entry),
    ])))
  }
  return value
}

function sameTicket(a, b) {
  return !!a && !!b && [
    'epoch',
    'requestId',
    'instanceId',
    'modelVersion',
    'skinRevision',
    'skinId',
  ]
    .every(key => a[key] === b[key])
}

function identifier(value, name) {
  if (typeof value !== 'string' || !value.length || value.trim() !== value)
    throw new TypeError(`[Equipment] Invalid ${name}`)
}

/**
 * Fixed-step gameplay only. Preparation is acknowledged with plain tickets, never a Promise.
 * Inventory is private; all observations and returned event batches are detached and immutable.
 */
export class EquipmentController {
  #inventory
  #definitions
  #resetLoadout
  #initialId
  #fixedDelta
  #tick = null
  #now = 0
  #allowClockGap = false
  #epoch = 1
  #sequence = 0
  #requestId = 0
  #actionId = 0
  #switchId = 0
  #equipmentGeneration = 0
  #phase = 'Empty'
  #activeId = null
  #previousId = null
  #desiredId = null
  #acceptedTickets = new Map()
  #preparation = null
  #skinRequests = new Map()
  #skinRevisions = new Map()
  #committedSkinRevisions = new Map()
  #transaction = null
  #action = null
  #commands = []
  #events = []
  #effects = []
  #fireHeld = false
  #automaticRun = false
  #paused = false
  #suspended = false
  #resumePending = false
  #disposed = false
  #actionBlockReason = null

  constructor({ definitions, loadout, fixedDelta = 1 / 60, initialSlot } = {}) {
    if (!Number.isFinite(fixedDelta) || fixedDelta <= 0)
      throw new RangeError('[Equipment] fixedDelta must be positive and finite')
    this.#inventory = new WeaponInventory({ definitions, slots: loadout })
    // This controller accepts at most one shot per fixed step; never silently cap a definition.
    for (const definition of definitions) {
      if (definition.fire.interval < fixedDelta)
        throw new RangeError(`[Equipment] ${definition.id}: fire.interval must be >= fixedDelta`)
    }
    this.#fixedDelta = fixedDelta
    this.#definitions = immutable(definitions)
    const snapshot = this.#inventory.snapshot()
    this.#resetLoadout = snapshot.slots.map((slot) => {
      const weapon = this.#inventory.get(slot.instanceId)
      return {
        id: slot.id,
        weapon: weapon
          ? { instanceId: weapon.instanceId, definitionId: weapon.definitionId, skinId: weapon.skinId }
          : null,
      }
    })
    if (initialSlot !== undefined && !snapshot.slots.some(slot => slot.id === initialSlot))
      throw new Error(`[Equipment] Unknown initial slot: ${initialSlot}`)
    this.#initialId = initialSlot === undefined
      ? this.#inventory.ids()[0] ?? null
      : this.#inventory.instanceAt(initialSlot)
    this.#desiredId = this.#initialId
  }

  queue(command) {
    if (this.#disposed)
      return false
    if (!command || !commandTypes.has(command.type))
      throw new TypeError('[Equipment] Unknown command')
    const { type } = command
    if (type === 'select')
      identifier(command.instanceId, 'instanceId')
    if (type === 'selectSlot')
      identifier(command.slotId, 'slotId')
    if (type === 'setSkin' || type === 'cycleSkin') {
      identifier(command.instanceId, 'instanceId')
      if (type === 'setSkin')
        identifier(command.skinId, 'skinId')
      if (this.#paused || this.#suspended || this.#resumePending)
        return false
    }
    if (type === 'fireHeld' && typeof command.held !== 'boolean')
      throw new TypeError('[Equipment] fireHeld requires a boolean')
    if (type === 'cycle' && ![-1, 1].includes(command.direction))
      throw new TypeError('[Equipment] cycle direction must be -1 or 1')
    if ([
      'prepared',
      'prepareFailed',
      'skinPrepared',
      'skinFailed',
    ].includes(type)) {
      const ticket = command.ticket
      if (!ticket || !Number.isSafeInteger(ticket.epoch) || !Number.isSafeInteger(ticket.requestId)
        || !Number.isSafeInteger(ticket.skinRevision)) {
        throw new TypeError('[Equipment] Invalid preparation ticket')
      }
      identifier(ticket.instanceId, 'ticket.instanceId')
      identifier(ticket.modelVersion, 'ticket.modelVersion')
      if (type === 'skinPrepared' || type === 'skinFailed')
        identifier(ticket.skinId, 'ticket.skinId')
    }
    if ((this.#paused || this.#suspended) && (actionCommands.has(type) || type === 'fireHeld'))
      return false
    // One-shot inputs during drawing are discarded, rather than leaking onto the next gun.
    if (actionCommands.has(type) && !this.#canAct())
      return false
    this.#commands.push({
      command: immutable(command),
      generation: this.#equipmentGeneration,
    })
    return true
  }

  /** Accept one completed-simulation candidate; a paused caller must not advance the clock. */
  step(context) {
    if (this.#disposed)
      throw new Error('[Equipment] step after dispose')
    if (this.#paused)
      return immutable({ events: [], effects: [] })
    const time = context?.time ?? context
    this.#validateTime(time)
    this.#tick = time.fixedTick
    this.#now = this.#tick * this.#fixedDelta
    this.#allowClockGap = false
    const commands = this.#commands
    this.#commands = []
    this.#actionBlockReason = null
    if (this.#suspended)
      return this.#flush()

    // All selections precede all readiness replies, regardless of callback arrival order.
    let selected = false
    for (const { command } of commands) {
      if (this.#select(command))
        selected = true
    }
    if (selected && this.#preparation?.status === 'failed')
      this.#cancelPreparation()
    // New cosmetic intentions precede old async replies, just like equipment selection.
    for (const { command } of commands) this.#requestSkin(command)
    for (const { command } of commands) this.#acceptSkinPreparation(command)
    this.#settleSkins()
    this.#ensurePreparation()
    for (const { command } of commands) this.#acceptPreparation(command)

    this.#advanceSwitch()
    let startedSwitch = false
    if (this.#mayStartSwitch()) {
      this.#startSwitch()
      startedSwitch = true
      this.#advanceSwitch() // Includes bounded zero-duration holster/draw transitions.
    }
    this.#ensurePreparation()
    this.#settleSkins()
    this.#ensurePreparation()
    if (startedSwitch && this.#mayStartSwitch())
      this.#actionBlockReason = 'nextSwitchDeferred'

    this.#settleAction()
    for (const { command } of commands) {
      if (command.type === 'fireHeld') {
        this.#fireHeld = command.held
        if (!command.held)
          this.#automaticRun = false
      }
    }
    const validAction = type => commands.some(entry => entry.command.type === type
      && entry.generation === this.#equipmentGeneration)
    const reloadAccepted = validAction('reload') && this.#startReload()
    if (!reloadAccepted) {
      const definition = this.#inventory.definition(this.#activeId)
      const wantsFire = validAction('fire') || (this.#fireHeld && definition?.fire.mode === 'auto')
      const fired = wantsFire && this.#fire()
      if (!fired && validAction('inspect'))
        this.#startInspect()
    }
    return this.#flush()
  }

  #validateTime(time) {
    if (!time || !Number.isSafeInteger(time.fixedTick) || time.fixedTick < 1)
      throw new RangeError('[Equipment] Expected a positive fixedTick')
    if (time.fixedDelta !== this.#fixedDelta)
      throw new RangeError('[Equipment] fixedDelta cannot change')
    if (this.#tick !== null && (time.fixedTick <= this.#tick
      || (!this.#allowClockGap && time.fixedTick !== this.#tick + 1))) {
      throw new RangeError('[Equipment] Expected the next fixedTick')
    }
    const expected = time.fixedTick * this.#fixedDelta
    if (!Number.isFinite(expected) || !Number.isFinite(time.fixedElapsed)
      || Math.abs(time.fixedElapsed - expected) > 1e-9 * Math.max(1, expected)) {
      throw new RangeError('[Equipment] fixedElapsed must match fixedTick * fixedDelta')
    }
    if (time.fixedStepIndex !== undefined) {
      if (!Number.isSafeInteger(time.fixedStepIndex) || time.fixedStepIndex < 0
        || !Number.isSafeInteger(time.fixedSteps) || time.fixedSteps <= time.fixedStepIndex
        || time.completedFixedSteps !== time.fixedStepIndex) {
        throw new RangeError('[Equipment] Invalid fixed step context')
      }
    }
    if (time.timeScale !== undefined && (!Number.isFinite(time.timeScale) || time.timeScale <= 0))
      throw new RangeError('[Equipment] No fixed step is allowed while timeScale is zero')
  }

  #select(command) {
    let target
    if (command.type === 'select')
      target = command.instanceId
    if (command.type === 'selectSlot')
      target = this.#inventory.instanceAt(command.slotId)
    if (command.type === 'selectPrevious')
      target = this.#previousId
    if (command.type === 'cycle') {
      const ids = this.#inventory.ids()
      const index = ids.indexOf(this.#desiredId ?? this.#activeId)
      target = ids[(index + command.direction + ids.length) % ids.length]
    }
    if (!target || !this.#inventory.get(target))
      return false
    // Resume must rebind the committed gun; selecting it again retries a failed preparation.
    if (this.#resumePending && target !== this.#activeId)
      return false
    this.#desiredId = target
    return true
  }

  #preparationTarget() {
    if (this.#resumePending)
      return this.#activeId
    if (this.#transaction) {
      return this.#desiredId === this.#transaction.toId
        ? null
        : this.#desiredId
    }
    return this.#desiredId === this.#activeId
      ? null
      : this.#desiredId
  }

  #ensurePreparation() {
    const target = this.#preparationTarget()
    if (this.#preparation && this.#preparation.ticket.instanceId !== target)
      this.#cancelPreparation()
    if (!target || this.#preparation)
      return
    const definition = this.#inventory.definition(target)
    const ticket = immutable({
      epoch: this.#epoch,
      requestId: ++this.#requestId,
      instanceId: target,
      modelVersion: definition.assets.assetVersion,
      skinRevision: this.#committedSkinRevisions.get(target) ?? 0,
    })
    this.#preparation = { ticket, status: 'loading', error: null }
    this.#effects.push(immutable({ type: 'PrepareWeapon', ticket }))
  }

  #acceptPreparation(command) {
    if (!['prepared', 'prepareFailed'].includes(command.type))
      return
    const { ticket } = command
    if (!sameTicket(ticket, this.#preparation?.ticket)) {
      // Older accepted views may still be visible on the delayed presentation timeline.
      // Their lifetime belongs to equipment facts, never to a duplicate load callback.
      if (command.type === 'prepared'
        && !sameTicket(ticket, this.#acceptedTickets.get(ticket.requestId))) {
        this.#effects.push(immutable({ type: 'DiscardPreparation', ticket }))
      }
      return
    }
    if (this.#preparation.status !== 'loading')
      return
    if (command.type === 'prepared') {
      this.#preparation.status = 'visualPrepared'
    }
    else {
      this.#preparation.status = 'failed'
      this.#preparation.error = String(command.message ?? 'Weapon preparation failed')
      this.#emit('PreparationFailed', ticket.instanceId, { ticket, message: this.#preparation.error })
    }
  }

  #cancelPreparation() {
    if (!this.#preparation)
      return
    this.#effects.push(immutable({ type: 'CancelPreparation', ticket: this.#preparation.ticket }))
    this.#preparation = null
  }

  #mayStartSwitch() {
    return !this.#transaction && this.#preparation?.status === 'visualPrepared'
      && ['Ready', 'Empty', 'Suspended'].includes(this.#phase)
      && this.#preparation.ticket.instanceId === this.#preparationTarget()
      && (!this.#skinRequests.has(this.#preparation.ticket.instanceId)
        || this.#skinRequests.get(this.#preparation.ticket.instanceId).status === 'failed')
  }

  #requestSkin(command) {
    if (!['setSkin', 'cycleSkin'].includes(command.type))
      return
    const weapon = this.#inventory.get(command.instanceId)
    if (!weapon)
      return
    const pending = this.#skinRequests.get(weapon.instanceId)
    if (command.type === 'cycleSkin') {
      const skins = this.#inventory.definition(weapon.instanceId).assets.skinIds
      const current = pending && pending.status !== 'failed'
        ? pending.ticket.skinId
        : weapon.skinId
      const index = skins.indexOf(current)
      command = { ...command, skinId: skins[(index + 1) % skins.length] }
    }
    if (pending?.ticket.skinId === command.skinId && pending.status !== 'failed')
      return
    if (pending) {
      this.#effects.push(immutable({ type: 'CancelSkinPreparation', ticket: pending.ticket }))
      this.#skinRequests.delete(weapon.instanceId)
    }
    if (weapon.skinId === command.skinId)
      return
    const skinRevision = (this.#skinRevisions.get(weapon.instanceId) ?? 0) + 1
    this.#skinRevisions.set(weapon.instanceId, skinRevision)
    this.#skinRequests.set(weapon.instanceId, {
      ticket: immutable({
        epoch: this.#epoch,
        requestId: ++this.#requestId,
        instanceId: weapon.instanceId,
        modelVersion: this.#inventory.definition(weapon.instanceId).assets.assetVersion,
        skinRevision,
        skinId: command.skinId,
      }),
      status: 'deferred',
      error: null,
    })
  }

  #acceptSkinPreparation(command) {
    if (!['skinPrepared', 'skinFailed'].includes(command.type))
      return
    const pending = this.#skinRequests.get(command.ticket.instanceId)
    if (!sameTicket(command.ticket, pending?.ticket) || pending.status !== 'loading')
      return
    pending.status = command.type === 'skinPrepared'
      ? 'prepared'
      : 'failed'
    if (command.type === 'skinFailed') {
      pending.error = String(command.message ?? 'Skin preparation failed')
      this.#emit('SkinFailed', command.ticket.instanceId, { ticket: pending.ticket, message: pending.error })
    }
  }

  #settleSkins() {
    for (const [instanceId, pending] of this.#skinRequests) {
      // A locked target keeps its already prepared appearance through the entire draw.
      if (this.#resumePending || (this.#transaction
        && [this.#transaction.fromId, this.#transaction.toId].includes(instanceId))) {
        continue
      }
      if (pending.status === 'deferred') {
        pending.status = 'loading'
        this.#effects.push(immutable({ type: 'PrepareSkin', ticket: pending.ticket }))
      }
      else if (pending.status === 'prepared') {
        const previousSkinId = this.#inventory.get(instanceId).skinId
        this.#inventory.setSkin(instanceId, pending.ticket.skinId)
        this.#committedSkinRevisions.set(instanceId, pending.ticket.skinRevision)
        this.#skinRequests.delete(instanceId)
        // Only an unlocked preparation can be invalidated. Accepted tickets stay reserved.
        if (this.#preparation?.ticket.instanceId === instanceId)
          this.#cancelPreparation()
        this.#emit('SkinChanged', instanceId, { ticket: pending.ticket, previousSkinId, skinId: pending.ticket.skinId })
      }
    }
  }

  #startSwitch() {
    const ticket = this.#preparation.ticket
    this.#acceptedTickets.set(ticket.requestId, ticket)
    this.#preparation = null
    const fromId = this.#activeId
    const toId = ticket.instanceId
    const reason = this.#resumePending
      ? 'resume'
      : fromId === null
        ? 'initial'
        : 'switch'
    this.#resumePending = false
    this.#cancelAction('switch')
    this.#automaticRun = false
    this.#equipmentGeneration++
    const holster = reason === 'switch'
      ? this.#inventory.definition(fromId).equip.holster
      : 0
    const draw = this.#inventory.definition(toId).equip.draw
    const commitTick = this.#tick + durationTicks(holster, this.#fixedDelta)
    this.#transaction = {
      switchId: ++this.#switchId,
      epoch: this.#epoch,
      fromId,
      toId,
      ticket,
      reason,
      commitTick,
      readyTick: commitTick + durationTicks(draw, this.#fixedDelta),
    }
    this.#phase = 'Holstering'
    if (reason === 'switch')
      this.#emit('SwitchStarted', fromId, { ...this.#transaction })
  }

  #advanceSwitch() {
    const transaction = this.#transaction
    if (!transaction)
      return
    if (this.#phase === 'Holstering' && this.#tick >= transaction.commitTick) {
      this.#activeId = transaction.toId
      this.#phase = 'Drawing'
      if (transaction.reason !== 'resume')
        this.#emit('EquipCommitted', this.#activeId, { ...transaction })
      this.#emit('DrawStarted', this.#activeId, { ...transaction })
    }
    if (this.#phase === 'Drawing' && this.#tick >= transaction.readyTick) {
      if (transaction.fromId && transaction.fromId !== transaction.toId)
        this.#previousId = transaction.fromId
      this.#phase = 'Ready'
      this.#transaction = null
      this.#emit('EquipReady', this.#activeId, { switchId: transaction.switchId })
    }
  }

  #canAct() {
    return !this.#disposed && !this.#paused && !this.#suspended
      && this.#phase === 'Ready' && this.#activeId !== null && this.#actionBlockReason === null
  }

  #canFire() {
    const weapon = this.#inventory.get(this.#activeId)
    return this.#canAct() && this.#action?.type !== 'reload'
      && weapon.magazine > 0 && this.#now + 1e-10 >= weapon.nextFireAt
      && this.#now + 1e-10 >= weapon.blockedUntil
  }

  #canReload() {
    return this.#canAct() && this.#action?.type !== 'reload'
      && this.#now + 1e-10 >= this.#inventory.get(this.#activeId).blockedUntil
      && canReloadWeapon(this.#inventory.get(this.#activeId), this.#inventory.definition(this.#activeId))
  }

  #canInspect() {
    return this.#canAct() && !this.#action
      && this.#now + 1e-10 >= this.#inventory.get(this.#activeId).blockedUntil
  }

  #startReload() {
    if (!this.#canReload())
      return false
    this.#cancelAction('reload')
    this.#automaticRun = false
    const weapon = this.#inventory.get(this.#activeId)
    const branch = weapon.magazine === 0
      ? 'empty'
      : 'tactical'
    const plan = this.#inventory.definition(this.#activeId).reload[branch]
    this.#action = {
      type: 'reload',
      actionId: ++this.#actionId,
      instanceId: this.#activeId,
      branch,
      startedTick: this.#tick,
      feedTick: this.#tick + durationTicks(plan.feed, this.#fixedDelta),
      endTick: this.#tick + durationTicks(plan.duration, this.#fixedDelta),
      committed: false,
    }
    this.#emit('ReloadStarted', this.#activeId, { ...this.#action })
    this.#settleAction()
    return true
  }

  #settleAction() {
    const action = this.#action
    if (!action)
      return
    if (action.type === 'reload' && !action.committed && this.#tick >= action.feedTick) {
      const result = commitReload(this.#inventory.get(action.instanceId), this.#inventory.definition(action.instanceId), action.endTick * this.#fixedDelta)
      this.#inventory.update(action.instanceId, result.patch)
      action.committed = true
      this.#emit('AmmoCommitted', action.instanceId, { actionId: action.actionId, commitIndex: 0, amount: result.amount })
    }
    if (this.#tick >= action.endTick) {
      this.#action = null
      this.#emit(action.type === 'reload'
        ? 'ReloadFinished'
        : 'InspectFinished', action.instanceId, { actionId: action.actionId })
    }
  }

  #cancelAction(reason) {
    if (!this.#action)
      return
    const action = this.#action
    this.#action = null
    this.#emit(action.type === 'reload'
      ? 'ReloadCancelled'
      : 'InspectCancelled', action.instanceId, {
      actionId: action.actionId,
      reason,
      committed: action.committed ?? false,
    })
  }

  #fire() {
    if (!this.#canFire())
      return false
    this.#cancelAction('fire')
    const definition = this.#inventory.definition(this.#activeId)
    const automatic = definition.fire.mode === 'auto' && this.#fireHeld
    const weapon = this.#inventory.update(this.#activeId, fireWeapon(
      this.#inventory.get(this.#activeId),
      definition,
      this.#now,
      automatic && this.#automaticRun,
    ))
    this.#automaticRun = automatic
    this.#emit('ShotFired', this.#activeId, { shotSequence: weapon.shotSequence, magazine: weapon.magazine })
    return true
  }

  #startInspect() {
    if (!this.#canInspect())
      return false
    this.#action = {
      type: 'inspect',
      actionId: ++this.#actionId,
      instanceId: this.#activeId,
      endTick: this.#tick + durationTicks(this.#inventory.definition(this.#activeId).inspectDuration, this.#fixedDelta),
    }
    this.#emit('InspectStarted', this.#activeId, { ...this.#action })
    this.#settleAction()
    return true
  }

  #emit(type, instanceId, payload = {}) {
    this.#events.push(immutable({
      epoch: this.#epoch,
      sequence: ++this.#sequence,
      fixedTick: this.#tick ?? 0,
      at: this.#now,
      instanceId,
      type,
      payload,
    }))
  }

  #flush() {
    const result = immutable({ events: this.#events, effects: this.#effects })
    this.#events = []
    this.#effects = []
    return result
  }

  setPaused(paused) {
    if (typeof paused !== 'boolean')
      throw new TypeError('[Equipment] paused must be a boolean')
    if (this.#disposed || paused === this.#paused)
      return
    this.#paused = paused
    this.#fireHeld = false
    this.#automaticRun = false
    this.#commands = this.#commands.filter(({ command }) => !actionCommands.has(command.type)
      && !['fireHeld', 'setSkin', 'cycleSkin'].includes(command.type))
  }

  #invalidate(reason) {
    this.#cancelAction(reason)
    this.#cancelPreparation()
    for (const pending of this.#skinRequests.values())
      this.#effects.push(immutable({ type: 'CancelSkinPreparation', ticket: pending.ticket }))
    this.#skinRequests.clear()
    this.#skinRevisions.clear()
    this.#committedSkinRevisions.clear()
    this.#epoch++
    this.#equipmentGeneration++
    this.#commands = []
    this.#transaction = null
    this.#acceptedTickets.clear()
    this.#actionBlockReason = null
    this.#fireHeld = false
    this.#automaticRun = false
    this.#resumePending = false
    this.#allowClockGap = true
    this.#emit('PresentationReset', this.#activeId, { reason })
  }

  suspend() {
    if (this.#disposed || this.#suspended)
      return immutable({ events: [], effects: [] })
    this.#invalidate('suspend')
    this.#suspended = true
    this.#phase = 'Suspended'
    this.#desiredId = this.#activeId
    return this.#flush()
  }

  resume() {
    if (this.#disposed || !this.#suspended)
      return
    this.#suspended = false
    this.#allowClockGap = true
    this.#resumePending = this.#activeId !== null
    this.#desiredId = this.#activeId ?? this.#initialId
    this.#phase = this.#resumePending ? 'Suspended' : 'Empty'
  }

  reset() {
    if (this.#disposed)
      return immutable({ events: [], effects: [] })
    this.#invalidate('reset')
    this.#inventory = new WeaponInventory({ definitions: this.#definitions, slots: this.#resetLoadout })
    this.#activeId = null
    this.#previousId = null
    this.#desiredId = this.#initialId
    this.#phase = this.#suspended ? 'Suspended' : 'Empty'
    return this.#flush()
  }

  snapshot() {
    return immutable({
      epoch: this.#epoch,
      fixedTick: this.#tick,
      at: this.#now,
      phase: this.#phase,
      activeId: this.#activeId,
      previousId: this.#previousId,
      queuedTarget: this.#transaction && this.#desiredId !== this.#transaction.toId
        ? this.#desiredId
        : null,
      pendingTarget: this.#preparation?.ticket.instanceId ?? null,
      pendingReadiness: this.#preparation?.status ?? null,
      actionBlockReason: this.#actionBlockReason,
      canAct: this.#canAct(),
      canFire: this.#canFire(),
      canReload: this.#canReload(),
      canInspect: this.#canInspect(),
      paused: this.#paused,
      suspended: this.#suspended,
      disposed: this.#disposed,
      transaction: this.#transaction,
      preparation: this.#preparation,
      skinRequests: Array.from(this.#skinRequests.values()),
      action: this.#action,
      inventory: this.#inventory.snapshot(),
    })
  }

  dispose() {
    if (this.#disposed)
      return immutable({ events: [], effects: [] })
    this.#invalidate('dispose')
    this.#disposed = true
    this.#phase = 'Empty'
    this.#activeId = null
    return this.#flush()
  }
}
