import { Quaternion, Vector3 } from 'three/webgpu'
import { intersectRayBox } from '../../engine/runtime/function/physics/ray-box.js'
import { createArmoryCatalog } from './armory-catalog.js'
import { classicDefinition } from './definitions/classic.js'
import { ghostDefinition } from './definitions/ghost.js'
import { judgeDefinition } from './definitions/judge.js'
import { karambitDefinition } from './definitions/karambit.js'
import { odinDefinition } from './definitions/odin.js'
import { phantomDefinition } from './definitions/phantom.js'
import { sheriffDefinition } from './definitions/sheriff.js'
import { vandalDefinition } from './definitions/vandal.js'
import { EquipmentController } from './equipment-controller.js'
import { isImpactColor, isImpactSurface, namedImpactSurface } from './impact-surfaces.js'
import { PracticeArmory } from './practice-armory.js'
import { ShotEffects } from './shot-effects.js'
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
  {
    id: 'quaternary',
    weapon: { instanceId: 'vandal', definitionId: 'vandal' },
  },
  {
    id: 'quinary',
    weapon: { instanceId: 'sheriff', definitionId: 'sheriff' },
  },
  {
    id: 'senary',
    weapon: { instanceId: 'judge', definitionId: 'judge' },
  },
  {
    id: 'septenary',
    weapon: { instanceId: 'odin', definitionId: 'odin' },
  },
])

export const rangeLoadout = Object.freeze([
  practiceLoadout[0],
  practiceLoadout[1],
  Object.freeze({
    id: 'tertiary',
    weapon: Object.freeze({ instanceId: 'karambit', definitionId: karambitDefinition.id }),
  }),
])

const shotRange = 200

function surfaceOf(box) {
  if (isImpactSurface(box.surface))
    return box.surface
  const named = namedImpactSurface(box.name)
  if (named)
    return named
  if (box.name?.includes('Anvil'))
    return 'metal'
  if (/Chest|Jungle|Bed|Fence|CounterSlab/u.test(box.name ?? ''))
    return 'wood'
  return box.group === 'Ground'
    ? 'dirt'
    : 'stone'
}

export function traceWeaponImpact(origin, direction, world, range = shotRange, shotTargets = null) {
  let nearest = range
  let target = null
  let face = -1
  for (const box of world?.boxes ?? []) {
    const entry = intersectRayBox(origin, direction, box, nearest)
    if (!entry || entry.distance >= nearest)
      continue
    nearest = entry.distance
    target = box
    face = entry.axis
  }
  const dynamicHit = shotTargets?.trace(origin, direction, nearest)
  if (dynamicHit)
    return dynamicHit
  let normal = null
  if (target) {
    normal = face === -1
      ? direction.map(value => -value || 0)
      : [0, 0, 0]
    if (face !== -1)
      normal[face] = -Math.sign(direction[face])
  }
  return {
    hit: target
      ? target.name ?? 'surface'
      : null,
    distance: nearest,
    position: origin.map((value, axis) => value + direction[axis] * nearest),
    normal,
    surface: target
      ? surfaceOf(target)
      : null,
    ...(isImpactColor(target?.surfaceColor)
      ? { surfaceColor: target.surfaceColor }
      : {}),
  }
}

function traceMeleeImpact(pose, range, world, targets) {
  const aim = new Quaternion().fromArray(pose.quaternion)
  const trace = (angle) => {
    const direction = new Vector3(Math.sin(angle), 0, -Math.cos(angle)).applyQuaternion(aim).toArray()
    const impact = traceWeaponImpact(pose.position, direction, world, range, targets)
    return { direction, impact }
  }
  const center = trace(0)
  if (center.impact.targetId)
    return center
  const halfAngle = Math.PI / 18
  const sides = [
    trace(-halfAngle),
    trace(halfAngle),
  ]
    .filter(hit => hit.impact.targetId)
    .sort((a, b) => a.impact.distance - b.impact.distance)
  return sides[0] ?? center
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
  #effects
  #aim
  #world
  #shotTargets
  #definitions
  #aimHeld = false
  #events = []
  #lastShot = null
  #paused = false
  #pausedSelection = null
  #initialSlot
  #meleeSlot
  #disposed = false
  #armory
  #shotSource = null
  #onShotResolved

  constructor({
    assets,
    layer,
    aim,
    world,
    scene = null,
    camera = null,
    shotTargets = null,
    audio = null,
    particles = null,
    jumpFeedback,
    definitions = [
      classicDefinition,
      phantomDefinition,
      ghostDefinition,
      vandalDefinition,
      sheriffDefinition,
      judgeDefinition,
      odinDefinition,
      karambitDefinition,
    ],
    loadout = practiceLoadout,
    initialSlot = 'secondary',
    fixedDelta = 1 / 60,
    armoryAccess,
    purchaseSlots,
    meleeSlot = null,
    onShotResolved = null,
    ammoPolicy = 'finite',
  }) {
    this.#controller = new EquipmentController({
      definitions,
      loadout,
      initialSlot,
      fixedDelta,
      ammoPolicy,
      purchaseSlots,
      meleeSlot,
    })
    this.#definitions = new Map(definitions.map(definition => [definition.id, definition]))
    const equipment = this.#controller.snapshot()
    const inventory = equipment.inventory
    this.#armory = new PracticeArmory({
      catalog: createArmoryCatalog({ definitions, inventory, purchaseSlots }),
      purchasing: !!purchaseSlots,
      equipment,
      access: armoryAccess,
    })
    this.#initialSlot = initialSlot ?? inventory.slots.find(slot => slot.instanceId)?.id
    this.#meleeSlot = meleeSlot
    this.#aim = aim
    this.#world = world
    this.#shotTargets = shotTargets
    this.#shotSource = shotTargets?.openSource(equipment.epoch) ?? null
    this.#onShotResolved = onShotResolved
    this.#effects = particles || scene
      ? new ShotEffects({
          particles,
          scene,
          camera,
          viewCamera: layer.camera,
          samplePose: at => aim.sample(at),
        })
      : null
    this.#audio = audio
      ? new WeaponAudio({
          audio,
          assets,
          definitions: definitions.filter(definition => Object.hasOwn(purchaseSlots ?? {}, definition.id)
            || inventory.weapons.some(weapon => weapon.definitionId === definition.id)),
        })
      : null
    this.#view = new WeaponViewModel({
      assets,
      layer,
      definitions,
      jumpFeedback,
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
      'quaternaryWeapon',
      'quinaryWeapon',
      'senaryWeapon',
      'septenaryWeapon',
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
        quaternaryWeapon: { type: 'selectSlot', slotId: 'quaternary' },
        quinaryWeapon: { type: 'selectSlot', slotId: 'quinary' },
        senaryWeapon: { type: 'selectSlot', slotId: 'senary' },
        septenaryWeapon: { type: 'selectSlot', slotId: 'septenary' },
        nextWeapon: { type: 'cycle', direction: 1 },
        previousWeapon: { type: 'cycle', direction: -1 },
        previousEquipped: { type: 'selectPrevious' },
        reload: { type: 'reload' },
        inspect: { type: 'inspect' },
        cycleSkin: { type: 'cycleSkin', instanceId: this.#controller.snapshot().activeId },
        fire: { type: 'fire' },
      }[action]
      if (this.#meleeSlot && command?.type === 'selectSlot'
        && !['primary', 'secondary', this.#meleeSlot].includes(command.slotId)) {
        continue
      }
      if (paused && command) {
        this.#rememberPausedSelection(command)
      }
      else if (command && (command.type !== 'cycleSkin' || command.instanceId)) {
        if (['selectSlot', 'cycle', 'selectPrevious'].includes(command.type)) {
          this.#armory.supersede()
        }
        this.#controller.queue(command, { source: 'input' })
      }
    }
    if (paused)
      return
    this.#aimHeld = input.isDown('aim')
    this.#controller.queue({
      type: 'fireHeld',
      held: input.isDown('fire'),
    }, { source: 'input' })
  }

  clearInput() {
    this.#aimHeld = false
    this.#controller.clearInput()
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
        ?? state.transaction?.toId ?? state.activeId ?? state.inventory.slots.find(slot => slot.id === this.#initialSlot)?.instanceId
      target = ids[(ids.indexOf(current) + command.direction + ids.length) % ids.length]
    }
    if (target && ids.includes(target))
      this.#pausedSelection = target
  }

  queue(command) {
    if ([
      'select',
      'selectSlot',
      'cycle',
      'selectPrevious',
    ].includes(command?.type)) {
      this.#armory.supersede()
    }
    return this.#controller.queue(command)
  }

  readArmory() { return this.#armory.read() }
  requestArmorySelection(command) { return this.#armory.request(command) }
  setArmoryAccess(check) { this.#armory.setAccess(check) }
  canStartChallenge() { return this.#armory.canStartChallenge() }

  fixed(context, pose) {
    const time = context.time ?? context
    const aimHeld = pose.aimHeld ?? this.#aimHeld
    this.#armory.beforeFixed(command => this.#controller.queue(command))
    const batch = this.#controller.step(context, { aimHeld })
    const snapshot = this.#controller.snapshot()
    const weapon = snapshot.inventory.weapons.find(weapon => weapon.instanceId === snapshot.activeId)
    const definition = this.#definitions.get(weapon?.definitionId)
    const aiming = aimHeld && snapshot.canAct && !snapshot.action && !!definition?.capabilities.ads
    const aimPose = this.#aim.beginStep({
      ...pose,
      at: time.fixedElapsed,
      delta: time.fixedDelta,
      aim: aiming,
      definition,
    })
    const events = batch.events.map((event) => {
      const stored = snapshot.inventory.weapons.find(weapon => weapon.instanceId === event.instanceId)
      const slotId = snapshot.inventory.slots.find(slot => slot.instanceId === event.instanceId)?.id
      const weapon = stored && {
        ...stored,
        ...(this.#meleeSlot
          ? { slotId, melee: slotId === this.#meleeSlot }
          : {}),
        ammoPolicy: snapshot.ammoPolicy,
      }
      if (event.type !== 'ShotFired' && event.type !== 'MeleeContact') {
        return {
          ...event,
          payload: { ...event.payload, weapon },
        }
      }
      const shot = event.type === 'ShotFired'
        ? this.#aim.fire({ instanceId: event.instanceId, shotSequence: event.payload.shotSequence, definition })
        : null
      this.#shotTargets?.setSourceEpoch(this.#shotSource, snapshot.epoch)
      this.#shotTargets?.beginShot(context)
      let attack
      if (shot) {
        const trace = direction => traceWeaponImpact(shot.eyeOrigin, direction, this.#world, shotRange, this.#shotTargets)
        const pellets = shot.pelletDirections?.map((direction, index) => ({
          index,
          direction,
          impact: trace(direction),
        }))
        const impact = pellets
          ? pellets.filter(pellet => pellet.impact.hit).sort((a, b) => a.impact.distance - b.impact.distance)[0]?.impact ?? pellets[0].impact
          : trace(shot.shotDirection)
        attack = {
          ...shot,
          impact,
          ...(pellets
            ? { pellets }
            : {}),
        }
      }
      else {
        attack = traceMeleeImpact(aimPose, definition.meleeAttack.range, this.#world, this.#shotTargets)
      }
      const enriched = {
        ...event,
        payload: {
          ...event.payload,
          ...attack,
          weapon,
        },
      }
      if (this.#shotTargets) {
        const result = this.#shotTargets.resolveShot({ ...enriched, sourceId: this.#shotSource }, context)
        this.#onShotResolved?.(result, context)
      }
      if (shot)
        this.#lastShot = enriched
      return enriched
    })
    const view = this.#aim.endStep()
    this.#accept({ ...batch, events }, snapshot, {
      at: time.fixedElapsed,
      aiming,
      duration: definition?.aim?.duration ?? 0,
      gait: pose.gait,
      verticalSpeed: pose.verticalSpeed,
      landing: pose.landing,
      ads: view.ads,
    })
    return immutable({ ...batch, events })
  }

  #accept(batch, snapshot = this.#controller.snapshot(), aim = null) {
    this.#shotTargets?.setSourceEpoch(this.#shotSource, snapshot.epoch)
    this.#events.push(...batch.events)
    this.#events = this.#events.slice(-64)
    this.#view.receive(batch, snapshot, aim)
    this.#audio?.receive(batch, snapshot)
    this.#effects?.receive(batch)
    this.#armory.accept(snapshot)
    this.#armory.present(this.#view.readHud())
  }

  motion(time, pose = this.#aim.sample(time.presentationTime)) {
    this.#audio?.motion(time)
    const shots = this.#view.motion(time, this.#controller.snapshot(), pose)
    this.#effects?.motion(time, shots)
    this.#armory.present(this.#view.readHud())
  }

  setPaused(value) {
    if (value === this.#paused)
      return
    this.#paused = value
    this.#controller.setPaused(value)
    this.#armory.setPaused(value)
    if (value) {
      this.#aimHeld = false
      this.#pausedSelection = null
    }
    else if (this.#pausedSelection) {
      this.#armory.supersede()
      this.#controller.queue({ type: 'select', instanceId: this.#pausedSelection })
      this.#pausedSelection = null
    }
  }

  suspend() {
    this.#armory.setEnabled(false)
    this.#aimHeld = false
    this.#pausedSelection = null
    this.#accept(this.#controller.suspend())
  }

  resume() {
    this.#armory.setEnabled(true)
    this.#controller.resume()
    this.#view.resume()
  }

  reset() {
    this.#armory.invalidate()
    this.#lastShot = null
    this.#pausedSelection = null
    this.#accept(this.#controller.reset())
  }

  snapshot() {
    return immutable({
      ...this.#controller.snapshot(),
      view: this.#view.snapshot(),
      audio: this.#audio?.snapshot() ?? null,
      effects: this.#effects?.snapshot() ?? null,
      lastShot: this.#lastShot,
      recentEvents: [...this.#events],
    })
  }

  readHud() { return this.#view.readHud() }

  dispose() {
    if (this.#disposed)
      return
    this.#disposed = true
    if (this.#shotSource)
      this.#shotTargets.closeSource(this.#shotSource)
    this.#armory.dispose()
    this.#controller.dispose()
    this.#audio?.dispose()
    this.#effects?.dispose()
    this.#view.dispose()
  }
}
