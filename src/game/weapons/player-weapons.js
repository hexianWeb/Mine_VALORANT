import { classicDefinition } from './definitions/classic.js'
import { ghostDefinition } from './definitions/ghost.js'
import { phantomDefinition } from './definitions/phantom.js'
import { EquipmentController } from './equipment-controller.js'
import { WeaponAudio } from './weapon-audio.js'
import { WeaponViewModel } from './weapon-viewmodel.js'

export const practiceLoadout = Object.freeze([
  {
    id: 'primary',
    weapon: { instanceId: 'rifle', definitionId: 'phantom' },
  },
  {
    id: 'secondary',
    weapon: { instanceId: 'pistol', definitionId: 'classic' },
  },
  {
    id: 'tertiary',
    weapon: { instanceId: 'ghost', definitionId: 'ghost' },
  },
])

function trace(origin, direction, world, range = 200) {
  let nearest = range
  let hit = null
  for (const box of world?.boxes ?? []) {
    let enter = 0
    let exit = range
    for (let axis = 0; axis < 3; axis++) {
      if (Math.abs(direction[axis]) < 1e-12) {
        if (origin[axis] < box.min[axis] || origin[axis] > box.max[axis])
          exit = -1
      }
      else {
        const a = (box.min[axis] - origin[axis]) / direction[axis]
        const b = (box.max[axis] - origin[axis]) / direction[axis]
        enter = Math.max(enter, Math.min(a, b))
        exit = Math.min(exit, Math.max(a, b))
      }
    }
    if (enter <= exit && enter < nearest) {
      nearest = enter
      hit = box.name ?? 'surface'
    }
  }
  return {
    hit,
    distance: nearest,
    position: origin.map((value, axis) => value + direction[axis] * nearest),
  }
}

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

/** Player's single weapon interface: fixed gameplay facts, then committed presentation. */
export class PlayerWeapons {
  #controller
  #view
  #audio
  #aim
  #world
  #definitions
  #aimHeld = false
  #events = []
  #lastShot = null
  #paused = false
  #pausedSelection = null
  #initialSelectionId
  #disposed = false

  constructor({
    assets,
    layer,
    aim,
    world,
    audio = null,
    definitions = [
      classicDefinition,
      phantomDefinition,
      ghostDefinition,
    ],
    loadout = practiceLoadout,
    initialSlot = 'secondary',
    fixedDelta = 1 / 60,
  }) {
    this.#controller = new EquipmentController({
      definitions,
      loadout,
      initialSlot,
      fixedDelta,
    })
    this.#definitions = new Map(definitions.map(definition => [definition.id, definition]))
    const inventory = this.#controller.snapshot().inventory
    this.#initialSelectionId = initialSlot === undefined
      ? inventory.weapons[0]?.instanceId ?? null
      : inventory.slots.find(slot => slot.id === initialSlot)?.instanceId ?? null
    this.#aim = aim
    this.#world = world
    this.#audio = audio
      ? new WeaponAudio({
          audio,
          assets,
          definitions: definitions.filter(definition => inventory.weapons.some(weapon => weapon.definitionId === definition.id)),
        })
      : null
    this.#view = new WeaponViewModel({
      assets,
      layer,
      definitions,
      queue: command => this.#controller.queue(command),
    })
  }

  collectInput(input, paused = false) {
    if (this.#paused && !paused) {
      // A stopped Engine has no input ticks. Collect its final paused edges before clearing holds.
      this.collectInput(input, true)
      input.clear?.()
      this.setPaused(false)
      return
    }
    this.setPaused(paused)
    const edges = input.consumePressedEvents?.() ?? [
      'primaryWeapon',
      'secondaryWeapon',
      'tertiaryWeapon',
      'nextWeapon',
      'previousWeapon',
      'previousEquipped',
      'reload',
      'inspect',
      'cycleSkin',
      'fire',
    ].filter(action => input.consumePressed(action)).map(action => ({ action }))
    for (const { action } of edges) {
      const command = {
        primaryWeapon: { type: 'selectSlot', slotId: 'primary' },
        secondaryWeapon: { type: 'selectSlot', slotId: 'secondary' },
        tertiaryWeapon: { type: 'selectSlot', slotId: 'tertiary' },
        nextWeapon: { type: 'cycle', direction: 1 },
        previousWeapon: { type: 'cycle', direction: -1 },
        previousEquipped: { type: 'selectPrevious' },
        reload: { type: 'reload' },
        inspect: { type: 'inspect' },
        cycleSkin: { type: 'cycleSkin', instanceId: this.#controller.snapshot().activeId },
        fire: { type: 'fire' },
      }[action]
      if (paused && command)
        this.#rememberPausedSelection(command)
      else if (command && (command.type !== 'cycleSkin' || command.instanceId))
        this.#controller.queue(command)
    }
    if (paused)
      return
    this.#aimHeld = input.isDown('aim')
    this.#controller.queue({
      type: 'fireHeld',
      held: input.isDown('fire'),
    })
  }

  #rememberPausedSelection(command) {
    const state = this.#controller.snapshot()
    if (state.suspended)
      return
    const ids = state.inventory.weapons.map(weapon => weapon.instanceId)
    let target
    if (command.type === 'selectSlot') {
      target = state.inventory.slots.find(slot => slot.id === command.slotId)?.instanceId
    }
    else if (command.type === 'selectPrevious') {
      target = state.previousId
    }
    else if (command.type === 'cycle' && ids.length) {
      const current = this.#pausedSelection ?? state.queuedTarget ?? state.pendingTarget
        ?? state.transaction?.toId ?? state.activeId ?? this.#initialSelectionId
      target = ids[(ids.indexOf(current) + command.direction + ids.length) % ids.length]
    }
    if (target && ids.includes(target))
      this.#pausedSelection = target
  }

  queue(command) { return this.#controller.queue(command) }

  fixed(context, pose) {
    const time = context.time ?? context
    const batch = this.#controller.step(context)
    const snapshot = this.#controller.snapshot()
    const weapon = snapshot.inventory.weapons.find(weapon => weapon.instanceId === snapshot.activeId)
    const definition = this.#definitions.get(weapon?.definitionId)
    const aiming = (pose.aimHeld ?? this.#aimHeld) && snapshot.canAct && !snapshot.action && !!definition?.capabilities.ads
    this.#aim.beginStep({
      ...pose,
      at: time.fixedElapsed,
      delta: time.fixedDelta,
      aim: aiming,
      definition,
    })
    const events = batch.events.map((event) => {
      const weapon = snapshot.inventory.weapons.find(weapon => weapon.instanceId === event.instanceId)
      if (event.type !== 'ShotFired') {
        return {
          ...event,
          payload: { ...event.payload, weapon },
        }
      }
      const shot = this.#aim.fire({ instanceId: event.instanceId, shotSequence: event.payload.shotSequence, definition })
      const pellets = shot.pelletDirections?.map((direction, index) => ({
        index,
        direction,
        impact: trace(shot.eyeOrigin, direction, this.#world),
      }))
      const impact = pellets
        ? pellets.filter(pellet => pellet.impact.hit).sort((a, b) => a.impact.distance - b.impact.distance)[0]?.impact ?? pellets[0].impact
        : trace(shot.eyeOrigin, shot.shotDirection, this.#world)
      const enriched = {
        ...event,
        payload: {
          ...event.payload,
          ...shot,
          weapon,
          aiming,
          impact,
          ...(pellets
            ? { pellets }
            : {}),
        },
      }
      this.#lastShot = enriched
      return enriched
    })
    this.#aim.endStep()
    this.#accept({ ...batch, events }, snapshot, { at: time.fixedElapsed, aiming, duration: definition?.aim?.duration ?? 0 })
    return immutable({ ...batch, events })
  }

  #accept(batch, snapshot = this.#controller.snapshot(), aim = null) {
    this.#events.push(...batch.events)
    this.#events = this.#events.slice(-64)
    this.#view.receive(batch, snapshot, aim)
    this.#audio?.receive(batch, snapshot)
  }

  motion(time) {
    this.#audio?.motion(time)
    this.#view.motion(time, this.#controller.snapshot(), this.#aim.sample(time.presentationTime))
  }

  setPaused(value) {
    if (value === this.#paused)
      return
    this.#paused = value
    this.#controller.setPaused(value)
    if (value) {
      this.#aimHeld = false
      this.#pausedSelection = null
    }
    else if (this.#pausedSelection) {
      this.#controller.queue({ type: 'select', instanceId: this.#pausedSelection })
      this.#pausedSelection = null
    }
  }

  suspend() {
    this.#aimHeld = false
    this.#pausedSelection = null
    this.#accept(this.#controller.suspend())
  }

  resume() {
    this.#controller.resume()
    this.#view.resume()
  }

  reset() {
    this.#lastShot = null
    this.#pausedSelection = null
    this.#accept(this.#controller.reset())
  }

  snapshot() {
    return immutable({
      ...this.#controller.snapshot(),
      view: this.#view.snapshot(),
      audio: this.#audio?.snapshot() ?? null,
      lastShot: this.#lastShot,
      recentEvents: [...this.#events],
    })
  }

  dispose() {
    if (this.#disposed)
      return
    this.#disposed = true
    this.#controller.dispose()
    this.#audio?.dispose()
    this.#view.dispose()
  }
}
