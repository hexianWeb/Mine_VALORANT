import { Group, Mesh, MeshBasicMaterial, SphereGeometry } from 'three/webgpu'
import { ammoControlSamples } from './assets/weapon-control-profile.js'

const key = ticket => `${ticket.epoch}:${ticket.requestId}`

/** Owns at most active + staged visual instances. Async loading never creates or attaches a tree. */
export class WeaponViewModel {
  #assets
  #layer
  #queue
  #definitions
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
  #aiming = false
  #queuedAiming = false
  #presentedShot = null
  error = null

  get skinError() {
    return Array.from(this.#skinRequests.values()).findLast(request => request.ticket.instanceId === this.#active?.instanceId && request.error)?.error ?? null
  }

  constructor({ assets, layer, queue, definitions }) {
    this.#assets = assets
    this.#layer = layer
    this.#queue = queue
    this.#definitions = new Map(definitions.map(definition => [definition.id, definition]))
    this.#flash = new Mesh(new SphereGeometry(0.035, 8, 4), new MeshBasicMaterial({ color: 0xFFDD72, toneMapped: false }))
    this.#flash.name = 'Weapon muzzle flash'
    this.#flash.visible = false
    layer.scene.add(this.#flash)
  }

  receive(batch, snapshot, aim = null) {
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
    if (aim && aim.aiming !== this.#queuedAiming) {
      this.#queuedAiming = aim.aiming
      // Private presentation fact, ordered before gameplay facts at the same fixed timestamp.
      // It does not allocate or modify an EquipmentController event sequence.
      this.#events.push({
        type: 'AimChanged',
        epoch: snapshot.epoch,
        at: aim.at,
        sequence: -1,
        aiming: aim.aiming,
        fade: aim.duration ?? 0,
      })
    }
    for (const effect of batch.effects) {
      if (effect.type === 'PrepareSkin') {
        const weapon = snapshot.inventory.weapons.find(weapon => weapon.instanceId === effect.ticket.instanceId)
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
        const weapon = snapshot.inventory.weapons.find(weapon => weapon.instanceId === effect.ticket.instanceId)
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

  #play(role, at, { endAt = null, clipEnd = null, fade = 0.06 } = {}) {
    const entry = this.#active
    if (role === 'idle' && this.#aiming && entry?.handle.manifest.actions.aim)
      role = 'aim'
    if (!entry || !entry.handle.manifest.actions[role])
      return
    const clip = entry.handle.manifest.clips.find(clip => clip.name === entry.handle.manifest.actions[role])
    const rate = endAt !== null && endAt > at
      ? (clipEnd ?? clip.duration) / (endAt - at)
      : 1
    const playbackId = entry.visual.player.play(role, { restart: true, fade, rate: rate || 1 })
    entry.action = {
      role,
      playbackId,
      at,
      endAt,
      // Gameplay facts end draw/holster/reload/inspect. Only a firing clip returns
      // naturally to idle; retain its absolute boundary so frame subdivision is irrelevant.
      naturalEndAt: ['fire', 'fireAds'].includes(role)
        ? at + clip.duration / (rate || 1)
        : null,
    }
  }

  #advance(at) {
    const action = this.#active?.action
    if (action && action.naturalEndAt !== null && action.naturalEndAt <= at + 1e-10) {
      const boundary = Math.max(this.#cursor ?? at, Math.min(at, action.naturalEndAt))
      this.#active.visual.player.advance(Math.max(0, boundary - (this.#cursor ?? boundary)))
      this.#cursor = boundary
      this.#play('idle', boundary)
    }
    const delta = this.#cursor === null
      ? 0
      : Math.max(0, at - this.#cursor)
    this.#active?.visual.player.advance(delta)
    this.#cursor = at
  }

  #syncControls() {
    const manifest = this.#active?.handle.manifest
    if (manifest?.ammoDisplay && this.#weapon)
      this.#active.visual.player.setControls(ammoControlSamples(manifest, this.#weapon.magazine))
  }

  #apply(event, fixedDelta, snapshot) {
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
    if (event.type === 'AimChanged') {
      this.#aiming = event.aiming
      if (['idle', 'aim', 'fire', 'fireAds'].includes(this.#active?.action?.role))
        this.#play('idle', event.at, { fade: event.fade })
      return
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
      'ReloadFinished',
      'ReloadCancelled',
      'InspectFinished',
      'InspectCancelled',
    ].includes(event.type)) {
      this.#play('idle', event.at)
    }
    if (event.type === 'ReloadStarted') {
      const weapon = snapshot.inventory.weapons.find(weapon => weapon.instanceId === event.instanceId)
      const definition = this.#definitions.get(weapon.definitionId)
      // Source reload feed uses the same seconds as the gameplay plan. A Classic tail beyond
      // its ready deadline is explicitly cut; it cannot keep the weapon unavailable longer.
      this.#play(payload.branch === 'empty'
        ? 'reloadEmpty'
        : 'reloadTactical', event.at, {
        endAt: payload.endTick * fixedDelta,
        clipEnd: definition.reload[payload.branch].duration,
      })
    }
    if (event.type === 'InspectStarted')
      this.#play('inspect', event.at, { endAt: payload.endTick * fixedDelta })
    if (event.type === 'ShotFired') {
      this.#presentedShot = event
      this.#play(payload.aiming && this.#active.handle.manifest.actions.fireAds
        ? 'fireAds'
        : 'fire', event.at, { fade: 0.025 })
      const socketName = this.#active.handle.manifest.sockets?.muzzle
      const socket = this.#active.visual.root.getObjectByName(socketName)
      this.#active.anchor.updateMatrixWorld(true)
      if (socket) {
        socket.getWorldPosition(this.#flash.position)
        this.#layer.scene.worldToLocal(this.#flash.position)
        this.#flashUntil = event.at + 0.045
      }
    }
  }

  motion(time, snapshot, pose) {
    if (this.#closed || this.#hidden)
      return
    const at = time.presentationTime
    this.#events.sort((a, b) => a.at - b.at || a.sequence - b.sequence)
    while (this.#events.length && this.#events[0].at <= at + 1e-10) {
      const event = this.#events.shift()
      if (event.epoch !== snapshot.epoch)
        continue
      this.#advance(event.at)
      this.#apply(event, time.fixedDelta, snapshot)
    }
    this.#advance(at)
    for (const request of this.#skinRequests.values()) {
      if (request.handle && !request.reported) {
        request.reported = true
        this.#queue({ type: 'skinPrepared', ticket: request.ticket })
      }
    }
    this.#prepare(snapshot)
    this.#layer.setEnabled(!!this.#active)
    if (pose)
      this.#layer.setFov(pose.viewmodelFov)
    this.#flash.visible = !!this.#active && at < this.#flashUntil
  }

  reset(snapshot, retain = false) {
    this.#request = null
    this.error = null
    this.#skinRequests.clear()
    this.#events = []
    this.#cursor = null
    this.#flashUntil = -Infinity
    this.#flash.visible = false
    this.#weapon = null
    this.#aiming = false
    this.#queuedAiming = false
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
    this.#layer.setEnabled(false)
  }

  resume() { this.#hidden = false }

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
      muzzleFlash: this.#flash.visible,
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
    this.#flash.removeFromParent()
    this.#flash.geometry.dispose()
    this.#flash.material.dispose()
  }
}
