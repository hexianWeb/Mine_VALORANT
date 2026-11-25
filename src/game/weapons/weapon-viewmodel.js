import { Group, MathUtils } from 'three/webgpu'
import { playerConfig } from '../player/config.js'
import { ammoControlSamples } from './assets/weapon-control-profile.js'
import { createMuzzleFlash, muzzleFlashDuration } from './muzzle-flash.js'
import { scopeBlend } from './scope-view.js'

const key = ticket => `${ticket.epoch}:${ticket.requestId}`
const walkRoles = Object.freeze({ forward: 'walkForward', backward: 'walkBackward', side: 'walkSide' })
const attackRoles = new Set([
  'fire',
  'fireAds',
  'fireSalvo',
  'attack',
])
const idleStance = Object.freeze({ aiming: false, direction: null })
const stillMotion = Object.freeze({
  at: 0,
  steps: 0,
  verticalSpeed: 0,
  ads: 0,
  landing: null,
})

function landingBounce(landing, at, { landingDuration, landingMinSpeed, landingFullSpeed }) {
  if (!landing || landingDuration <= 0)
    return 0
  const phase = (at - landing.at) / landingDuration
  if (phase < 0 || phase >= 1)
    return 0
  // Ignore shallow contacts. The second half of the damped cycle rebounds slightly.
  const speedRange = Math.max(landingFullSpeed - landingMinSpeed, Number.EPSILON)
  const strength = MathUtils.clamp((landing.speed - landingMinSpeed) / speedRange, 0, 1)
  return strength * Math.sin(2 * Math.PI * phase) * (1 - phase) ** 2
}

/** Owns at most active + staged visual instances. Async loading never creates or attaches a tree. */
export class WeaponViewModel {
  #assets
  #layer
  #queue
  #readWeapon
  #definitions
  #jumpFeedback
  #active = null
  #staged = null
  #request = null
  #skinRequests = new Map()
  #events = []
  #cursor = null
  #hidden = false
  #closed = false
  #flash
  #flashUntil = -Infinity
  #maximumInstances = 0
  #weapon = null
  #stance = idleStance
  #queuedStance = idleStance
  #motionSamples = []
  #presentedShot = null
  error = null

  get skinError() {
    return Array.from(this.#skinRequests.values()).findLast(request => request.ticket.instanceId === this.#active?.instanceId && request.error)?.error ?? null
  }

  constructor({ assets, layer, queue, readWeapon, definitions, jumpFeedback }) {
    this.#assets = assets
    this.#layer = layer
    this.#queue = queue
    this.#readWeapon = readWeapon
    this.#definitions = new Map(definitions.map(definition => [definition.id, definition]))
    this.#jumpFeedback = {
      ...playerConfig.jumpFeedback,
      ...jumpFeedback,
    }
    this.#flash = createMuzzleFlash()
    layer.scene.add(this.#flash.root)
  }

  receive(batch, snapshot, pose = null) {
    if (this.#closed)
      return
    // Reservation follows accepted facts immediately, not the delayed presentation cursor.
    for (const event of batch.events) {
      if (event.type === 'PresentationReset') {
        this.reset(snapshot, event.payload.reason === 'suspend')
        continue
      }
      if (['SwitchStarted', 'EquipCommitted', 'DrawStarted'].includes(event.type)
        && this.#staged && event.payload.ticket && key(this.#staged.ticket) === key(event.payload.ticket)) {
        this.#staged.reserved = true
      }
      if (event.type === 'SkinChanged') {
        const request = this.#skinRequests.get(key(event.payload.ticket))
        if (request)
          request.reserved = true
      }
      this.#events.push(event)
    }
    if (pose) {
      const stance = { aiming: pose.aiming, direction: pose.gait?.direction ?? null }
      if (pose.gait) {
        this.#motionSamples.push({
          at: pose.at,
          steps: pose.gait.steps,
          verticalSpeed: pose.verticalSpeed ?? 0,
          ads: pose.ads ?? 0,
          landing: pose.landing ?? null,
        })
      }
      if (stance.aiming !== this.#queuedStance.aiming || stance.direction !== this.#queuedStance.direction) {
        this.#queuedStance = stance
        // Present posture before gameplay facts at the same fixed timestamp.
        this.#events.push({
          type: 'StanceChanged',
          epoch: snapshot.epoch,
          at: pose.at,
          sequence: -1,
          stance,
          fade: pose.duration ?? 0,
        })
      }
    }
    for (const effect of batch.effects) {
      if (effect.type === 'PrepareSkin') {
        const weapon = this.#readWeapon(effect.ticket.instanceId)
        if (!weapon)
          continue
        const definition = this.#definitions.get(weapon.definitionId)
        const request = {
          ticket: effect.ticket,
          handle: null,
          reported: false,
          reserved: false,
          error: null,
        }
        this.#skinRequests.set(key(effect.ticket), request)
        this.#assets.load({ weaponId: definition.assets.modelId, assetVersion: effect.ticket.modelVersion, skinId: effect.ticket.skinId })
          .then((handle) => {
            if (!this.#closed && this.#skinRequests.get(key(effect.ticket)) === request)
              request.handle = handle
          })
          .catch((error) => {
            if (!this.#closed && this.#skinRequests.get(key(effect.ticket)) === request) {
              request.reported = true
              request.error = String(error.message ?? error)
              this.#queue({ type: 'skinFailed', ticket: effect.ticket, message: request.error })
            }
          })
      }
      else if (effect.type === 'CancelSkinPreparation') {
        const request = this.#skinRequests.get(key(effect.ticket))
        if (!request?.reserved) {
          this.#skinRequests.delete(key(effect.ticket))
        }
      }
      else if (effect.type === 'PrepareWeapon') {
        const weapon = effect.weapon ?? this.#readWeapon(effect.ticket.instanceId)
        const definition = this.#definitions.get(weapon.definitionId)
        const request = { ticket: effect.ticket, handle: null, failed: false }
        this.#request = request
        this.error = null
        this.#assets.load({ weaponId: definition.assets.modelId, assetVersion: definition.assets.assetVersion, skinId: weapon.skinId })
          .then((handle) => {
            if (!this.#closed && this.#request === request)
              request.handle = handle
          })
          .catch((error) => {
            if (!this.#closed && this.#request === request) {
              request.failed = true
              this.error = String(error.message ?? error)
              this.#queue({ type: 'prepareFailed', ticket: request.ticket, message: this.error })
            }
          })
      }
      else {
        if (this.#request && key(this.#request.ticket) === key(effect.ticket)) {
          this.#request = null
          this.error = null
        }
        if (this.#staged && !this.#staged.reserved && key(this.#staged.ticket) === key(effect.ticket)) {
          this.#release(this.#staged)
          this.#staged = null
        }
      }
    }
  }

  #release(entry) {
    entry.visual.dispose()
    entry.anchor.removeFromParent()
  }

  #prepare(snapshot) {
    const request = this.#request
    if (!request?.handle || request.failed || this.#staged || this.#hidden)
      return
    if (request.ticket.epoch !== snapshot.epoch || key(request.ticket) !== key(snapshot.preparation?.ticket ?? {}))
      return
    let entry
    try {
      // Resume rebinds a retained committed visual to the new epoch without cloning it again.
      if (snapshot.phase === 'Suspended' && this.#active?.instanceId === request.ticket.instanceId) {
        entry = this.#active
        // A skin may be logically committed but not yet displayed when Editor takes control.
        // Resume must rebind the retained model to the committed appearance, not its old P.
        if (entry.handle !== request.handle) {
          this.#assets.applySkin(entry.visual, request.handle)
          entry.handle = request.handle
        }
        this.#active = null
        entry.ticket = request.ticket
        entry.reserved = false
      }
      else {
        const visual = this.#assets.instantiate(request.handle)
        const anchor = new Group()
        entry = {
          visual,
          anchor,
          handle: request.handle,
          instanceId: request.ticket.instanceId,
          ticket: request.ticket,
          reserved: false,
          action: null,
        }
        // Skinned bounds can be cached while draw starts off-screen and remain stale as
        // the arms move into view. This small first-person layer must render every pose.
        visual.root.traverse((object) => {
          if (object.isSkinnedMesh)
            object.frustumCulled = false
        })
        anchor.position.fromArray(request.handle.manifest.view.mountOffset)
        anchor.add(visual.root)
      }
      entry.anchor.visible = false
      this.#staged = entry
      this.#maximumInstances = Math.max(this.#maximumInstances, Number(!!this.#active) + 1)
      this.#request = null
      this.#queue({ type: 'prepared', ticket: entry.ticket })
    }
    catch (error) {
      if (entry && entry !== this.#active)
        this.#release(entry)
      this.#staged = null
      request.failed = true
      this.error = String(error.message ?? error)
      this.#queue({ type: 'prepareFailed', ticket: request.ticket, message: this.error })
    }
  }

  #restRole() {
    const { aiming, direction } = this.#stance
    const handle = this.#active?.handle
    const walk = aiming ? 'walkAim' : walkRoles[direction]
    if (direction && handle?.locomotion?.[walk])
      return walk
    return aiming && handle?.manifest.actions.aim
      ? 'aim'
      : 'idle'
  }

  #play(role, at, { endAt = null, clipEnd = null, fade = 0.06 } = {}) {
    if (role === 'idle')
      role = this.#restRole()
    const entry = this.#active
    const walkClip = entry?.handle.locomotion?.[role]
    const clipName = walkClip ?? entry?.handle.manifest.actions[role]
    if (!clipName)
      return
    const clip = entry.handle.manifest.clips.find(clip => clip.name === clipName)
    const rate = endAt !== null && endAt > at
      ? (clipEnd ?? clip.duration) / (endAt - at)
      : 1
    const playbackId = entry.visual.player.play(role, {
      restart: true,
      fade,
      rate: rate || 1,
      phaseDriven: !!walkClip,
    })
    entry.action = {
      role,
      playbackId,
      at,
      endAt,
      resting: role === 'idle' || role === 'aim' || !!walkClip,
      // Attacks return to idle at their absolute clip boundary.
      naturalEndAt: attackRoles.has(role)
        ? at + clip.duration / (rate || 1)
        : null,
    }
  }

  #advancePlayer(at) {
    while (this.#motionSamples.length > 1 && this.#motionSamples[1].at <= at)
      this.#motionSamples.shift()
    const entry = this.#active
    if (entry) {
      const [first, second] = this.#motionSamples
      const previous = first?.at <= at
        ? first
        : stillMotion
      const next = previous === first
        ? second ?? previous
        : previous
      const alpha = next === previous
        ? 0
        : MathUtils.clamp((at - previous.at) / (next.at - previous.at), 0, 1)
      const steps = MathUtils.lerp(previous.steps, next.steps, alpha)
      const speed = MathUtils.lerp(previous.verticalSpeed, next.verticalSpeed, alpha)
      const ads = MathUtils.lerp(previous.ads, next.ads, alpha)
      const feedback = this.#jumpFeedback
      const air = feedback.airReferenceSpeed > 0
        ? MathUtils.clamp(speed / feedback.airReferenceSpeed, -1, 1)
        : 0
      const bounce = landingBounce(previous.landing, at, feedback)
      const weight = MathUtils.lerp(1, feedback.adsScale, ads)
      const mountY = entry.handle.manifest.view.mountOffset[1]
      entry.anchor.position.y = mountY - weight * (feedback.airOffset * air + feedback.landingOffset * bounce)
      entry.anchor.rotation.x = -weight * (feedback.airPitchRad * air + feedback.landingPitchRad * bounce)

      // A cycle contains two steps. Interpolate without wrapping until the final sample.
      const delta = this.#cursor === null
        ? 0
        : Math.max(0, at - this.#cursor)
      entry.visual.player.advance(delta, (steps / 2) % 1)
    }
    this.#cursor = at
  }

  #advance(at) {
    const action = this.#active?.action
    if (action && action.naturalEndAt !== null && action.naturalEndAt <= at + 1e-10) {
      const boundary = Math.max(this.#cursor ?? at, Math.min(at, action.naturalEndAt))
      this.#advancePlayer(boundary)
      this.#play('idle', boundary)
    }
    this.#advancePlayer(at)
  }

  #syncControls() {
    const manifest = this.#active?.handle.manifest
    if (manifest?.ammoDisplay && this.#weapon)
      this.#active.visual.player.setControls(ammoControlSamples(manifest, this.#weapon.magazine))
  }

  #apply(event, fixedDelta) {
    if (event.type === 'SkinChanged') {
      const request = this.#skinRequests.get(key(event.payload.ticket))
      if (!request?.handle)
        throw new Error('[WeaponViewModel] Accepted skin lost its prepared handle')
      for (const entry of [this.#active, this.#staged]) {
        if (entry?.instanceId === event.instanceId) {
          this.#assets.applySkin(entry.visual, request.handle)
          entry.handle = request.handle
        }
      }
      if (this.#active?.instanceId === event.instanceId) {
        this.#weapon = event.payload.weapon
        this.#syncControls()
      }
      this.#skinRequests.delete(key(event.payload.ticket))
      return
    }
    if (event.type === 'StanceChanged') {
      const aimChanged = event.stance.aiming !== this.#stance.aiming
      this.#stance = event.stance
      const action = this.#active?.action
      const keepsBolt = this.#definitions.get(this.#weapon?.definitionId)?.fire?.scopeRecovery
      if (action && action.role !== this.#restRole() && (action.resting || (aimChanged && action.naturalEndAt !== null && !keepsBolt))) {
        this.#play('idle', event.at, {
          fade: aimChanged ? event.fade : undefined,
        })
      }
      return
    }
    if (event.type === 'SwitchCancelled' && this.#staged && key(this.#staged.ticket) === key(event.payload.ticket)) {
      this.#release(this.#staged)
      this.#staged = null
    }
    if (event.type === 'EquipCommitted' || (event.type === 'DrawStarted' && event.payload.reason === 'resume')) {
      if (!this.#staged || key(this.#staged.ticket) !== key(event.payload.ticket))
        throw new Error('[WeaponViewModel] Accepted equipment lost its reserved visual')
      if (this.#active)
        this.#release(this.#active)
      this.#active = this.#staged
      this.#staged = null
      this.#active.anchor.visible = true
      this.#layer.scene.add(this.#active.anchor)
    }
    if (event.instanceId !== this.#active?.instanceId)
      return
    const payload = event.payload
    if (payload.weapon)
      this.#weapon = payload.weapon
    this.#syncControls()
    if (event.type === 'SwitchStarted')
      this.#play('holster', event.at, { endAt: payload.commitTick * fixedDelta, fade: 0.04 })
    if (event.type === 'DrawStarted')
      this.#play('draw', event.at, { endAt: payload.readyTick * fixedDelta, fade: 0 })
    if ([
      'EquipReady',
      'SwitchCancelled',
      'ReloadFinished',
      'ReloadCancelled',
      'InspectFinished',
      'InspectCancelled',
    ].includes(event.type)) {
      this.#play('idle', event.at)
    }
    if (event.type === 'ReloadStarted') {
      const definition = this.#definitions.get(this.#weapon.definitionId)
      const plan = definition.reload[payload.branch]
      // A retimed reload keeps the same authored endpoint, including any previously trimmed tail.
      this.#play(payload.branch === 'empty'
        ? 'reloadEmpty'
        : 'reloadTactical', event.at, {
        endAt: payload.endTick * fixedDelta,
        clipEnd: plan.clipEnd ?? plan.duration,
      })
    }
    if (event.type === 'InspectStarted')
      this.#play('inspect', event.at, { endAt: payload.endTick * fixedDelta })
    if (event.type === 'MeleeSwung')
      this.#play('attack', event.at, { fade: 0.025 })
    if (event.type === 'ShotFired') {
      this.#presentedShot = event
      const exposesBolt = this.#definitions.get(this.#weapon?.definitionId)?.fire?.scopeRecovery
      const actions = this.#active.handle.manifest.actions
      const normalFire = payload.aiming && !exposesBolt && actions.fireAds
        ? 'fireAds'
        : 'fire'
      const role = payload.salvo && actions.fireSalvo
        ? 'fireSalvo'
        : normalFire
      this.#play(role, event.at, { fade: 0.025 })
      const socketName = this.#active.handle.manifest.sockets?.muzzle
      const socket = this.#active.visual.root.getObjectByName(socketName)
      this.#active.anchor.updateMatrixWorld(true)
      if (socket) {
        socket.getWorldPosition(this.#flash.root.position)
        this.#layer.scene.worldToLocal(this.#flash.root.position)
        this.#flash.setShot(payload.shotSequence)
        this.#flashUntil = event.at + muzzleFlashDuration
        return this.#flash.root.position.toArray()
      }
    }
  }

  motion(time, snapshot, pose) {
    if (this.#closed || this.#hidden)
      return []
    const at = time.presentationTime
    const shots = []
    this.#events.sort((a, b) => a.at - b.at || a.sequence - b.sequence)
    while (this.#events.length && this.#events[0].at <= at + 1e-10) {
      const event = this.#events.shift()
      if (event.epoch !== snapshot.epoch)
        continue
      this.#advance(event.at)
      const muzzle = this.#apply(event, time.fixedDelta)
      if (muzzle)
        shots.push({ event, muzzle })
    }
    this.#advance(at)
    for (const request of this.#skinRequests.values()) {
      if (request.handle && !request.reported) {
        request.reported = true
        this.#queue({ type: 'skinPrepared', ticket: request.ticket })
      }
    }
    this.#prepare(snapshot)
    const blend = scopeBlend(pose?.scopeProgress ?? 0)
    this.#layer.setEnabled(!!this.#active && blend < 1)
    this.#layer.setOpacity?.(1 - blend)
    if (pose) {
      this.#layer.setFov(pose.viewmodelFov)
      this.#active?.visual.sight?.setAim(pose.ads ?? 0)
    }
    const strength = this.#active
      ? (this.#flashUntil - at) / muzzleFlashDuration
      : 0
    this.#flash.setStrength(strength)
    return shots
  }

  reset(snapshot, retain = false) {
    this.#request = null
    this.error = null
    this.#skinRequests.clear()
    this.#events = []
    this.#cursor = null
    this.#flashUntil = -Infinity
    this.#flash.setStrength(0)
    this.#weapon = null
    this.#stance = idleStance
    this.#queuedStance = idleStance
    this.#motionSamples = []
    this.#presentedShot = null
    const kept = retain
      ? [this.#active, this.#staged].find(entry => entry?.instanceId === snapshot.activeId)
      : null
    for (const entry of new Set([this.#active, this.#staged])) {
      if (entry && entry !== kept)
        this.#release(entry)
    }
    this.#active = kept ?? null
    this.#staged = null
    if (kept) {
      kept.visual.player.stop()
      kept.anchor.visible = false
      kept.action = null
    }
    this.#hidden = retain
    this.#layer.setOpacity?.(1)
    this.#layer.setEnabled(false)
  }

  resume() { this.#hidden = false }

  #hud = null

  /** No animation, inventory, audio, effect or event-log diagnostics on the HUD path. */
  readHud() {
    const weapon = this.#weapon
    const skinId = this.#active?.handle.skinId ?? null
    const action = this.#active?.action?.role ?? null
    const hit = !!this.#presentedShot?.payload.impact.hit
      && this.#cursor - this.#presentedShot.at >= 0
      && this.#cursor - this.#presentedShot.at < 0.12
    const moving = !!this.#stance.direction
    const previous = this.#hud
    if (previous && previous.weapon?.instanceId === weapon?.instanceId
      && previous.weapon?.definitionId === weapon?.definitionId
      && previous.weapon?.slotId === weapon?.slotId && previous.weapon?.melee === weapon?.melee
      && previous.weapon?.magazine === weapon?.magazine
      && previous.weapon?.reserve === weapon?.reserve
      && (previous.weapon?.ammoPolicy ?? 'finite') === (weapon?.ammoPolicy ?? 'finite')
      && previous.skinId === skinId && previous.action === action
      && previous.error === this.error && previous.skinError === this.skinError
      && previous.hit === hit && previous.moving === moving) {
      return previous
    }
    this.#hud = Object.freeze({
      revision: (previous?.revision ?? 0) + 1,
      weapon: weapon
        ? Object.freeze({
            instanceId: weapon.instanceId,
            definitionId: weapon.definitionId,
            ...(weapon.slotId
              ? { slotId: weapon.slotId, melee: weapon.melee }
              : {}),
            magazine: weapon.magazine,
            reserve: weapon.reserve,
            ammoPolicy: weapon.ammoPolicy ?? 'finite',
          })
        : null,
      skinId,
      action,
      error: this.error,
      skinError: this.skinError,
      moving,
      hit,
    })
    return this.#hud
  }

  snapshot() {
    return {
      renderActiveId: this.#active?.instanceId ?? null,
      stagedId: this.#staged?.instanceId ?? null,
      stagedReserved: this.#staged?.reserved ?? false,
      instances: Number(!!this.#active) + Number(!!this.#staged),
      maximumInstances: this.#maximumInstances,
      visibleInstances: Number(!!this.#active?.anchor.visible && !this.#hidden),
      action: this.#active?.action?.role ?? null,
      playback: this.#active?.visual.player.snapshot() ?? null,
      presentationTime: this.#cursor,
      muzzleFlash: this.#flash.root.visible,
      error: this.error,
      skinError: this.skinError,
      skinId: this.#active?.handle.skinId ?? null,
      weapon: this.#weapon,
      lastShot: this.#presentedShot,
    }
  }

  dispose() {
    if (this.#closed)
      return
    this.reset({ activeId: null })
    this.#closed = true
    this.#flash.dispose()
  }
}
