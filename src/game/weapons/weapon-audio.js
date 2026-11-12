import { weaponAudioProfiles } from './definitions/audio.js'

let nextOwner = 0

/** Independent committed-fact/marker cursor. Never consumes delayed Mixer marker callbacks. */
export class WeaponAudio {
  #audio
  #assets
  #definitions
  #profiles
  #scope
  #owner = `player-weapons:${++nextOwner}`
  #epoch = 1
  #sequence = 0
  #events = []
  #actions = new Map()
  #pending = new Map()
  #closed = false

  constructor({ audio, assets, definitions, profiles = weaponAudioProfiles }) {
    this.#audio = audio
    this.#assets = assets
    this.#scope = assets.audioScope
    this.#definitions = new Map(definitions.map(definition => [definition.id, definition]))
    this.#profiles = profiles
    for (const definition of definitions) {
      const profile = profiles[definition.id]
      if (profile)
        void assets.preloadAudio(profile).catch(error => audio.reportOnce(`bank:${definition.id}`, error))
    }
  }

  receive(batch, snapshot) {
    if (this.#closed)
      return
    for (const event of batch.events) {
      if (event.sequence <= this.#sequence)
        continue
      this.#sequence = event.sequence
      if (event.type === 'PresentationReset') {
        this.#audio.invalidate({ scope: this.#scope, owner: this.#owner })
        this.#epoch = snapshot.epoch
        this.#events = []
        this.#actions.clear()
        this.#pending.clear()
      }
      else if (event.epoch === snapshot.epoch) {
        this.#epoch = snapshot.epoch
        this.#events.push(event)
      }
    }
  }

  #id(event, suffix) { return `${this.#owner}/${event.epoch}/${event.sequence}/${suffix}` }

  #cancel(instanceId, at, actionId) {
    this.#audio.cancelAction({
      scope: this.#scope,
      owner: this.#owner,
      epoch: this.#epoch,
      group: instanceId,
      actionId,
      at,
    })
    for (const [key, pending] of this.#pending) {
      if (pending.cue.group === instanceId && (actionId === undefined || pending.cue.actionId === actionId))
        this.#pending.delete(key)
    }
    for (const [key, action] of this.#actions) {
      if (action.event.instanceId === instanceId && (actionId === undefined || action.actionId === actionId)) {
        this.#actions.delete(key)
        this.#pending.delete(key)
      }
    }
  }

  #cue(event, cueId, { kind, actionId, endAt, rate = 1, suffix = cueId, keepTail = true } = {}) {
    const loaded = this.#assets.audioCue(cueId)
    const cue = {
      id: this.#id(event, suffix),
      scope: this.#scope,
      owner: this.#owner,
      epoch: event.epoch,
      group: event.instanceId,
      actionId,
      at: event.at,
      sequence: event.sequence,
      kind,
      endAt,
      rate,
      keepTail,
      buffer: loaded?.buffer,
      gain: loaded?.gain ?? 0.22,
    }
    if (!loaded && kind === 'action')
      this.#pending.set(cue.id, { cue, cueId })
    else
      this.#audio.enqueue(cue)
    return cue.id
  }

  #start(event, role, cueId, endAt, actionId) {
    const definition = this.#definitions.get(event.payload.weapon?.definitionId)
    const manifest = definition && this.#assets.manifest(definition.assets.modelId, definition.assets.assetVersion)
    const clip = manifest?.clips.find(clip => clip.name === manifest.actions[role])
    // Match the explicit viewmodel profile: draw/inspect scale to gameplay deadlines;
    // reload retains source seconds and clips its recovery tail, firing retains its source rate.
    const rate = clip && ['draw', 'inspect'].includes(role) && endAt > event.at
      ? clip.duration / (endAt - event.at)
      : 1
    const key = this.#cue(event, cueId, {
      kind: 'action',
      actionId,
      endAt,
      rate,
      keepTail: false,
    })
    this.#actions.set(key, {
      event,
      cueId,
      actionId,
      rate,
      endAt,
      markers: (clip?.markers ?? []).map((marker, index) => ({ ...marker, index, at: event.at + marker.time / rate })),
      cursor: 0,
    })
  }

  #apply(event, h) {
    const profile = this.#profiles[event.payload.weapon?.definitionId]
    if (event.type === 'SwitchStarted')
      this.#cancel(event.instanceId, event.at)
    if (event.type === 'ReloadCancelled')
      this.#cancel(event.instanceId, event.at, `reload:${event.payload.actionId}`)
    if (event.type === 'InspectCancelled')
      this.#cancel(event.instanceId, event.at, `inspect:${event.payload.actionId}`)
    if (!profile)
      return
    if (event.type === 'ShotFired') {
      this.#cancel(event.instanceId, event.at)
      this.#cue(event, profile.fire, { kind: 'transient' })
      // Independent marker timeline, e.g. a future bolt cue; not a second zero-time shot.
      const definition = this.#definitions.get(event.payload.weapon.definitionId)
      const manifest = this.#assets.manifest(definition.assets.modelId, definition.assets.assetVersion)
      const role = event.payload.aiming ? 'fireAds' : 'fire'
      const clip = manifest?.clips.find(clip => clip.name === manifest.actions[role])
      if (clip?.markers.length) {
        const key = this.#id(event, 'fire-markers')
        this.#actions.set(key, {
          event,
          cueId: profile.fire,
          actionId: `shot:${event.sequence}`,
          rate: 1,
          endAt: event.at + clip.duration,
          markers: clip.markers.map((marker, index) => ({ ...marker, index, at: event.at + marker.time })),
          cursor: 0,
        })
      }
    }
    if (['DrawStarted', 'ReloadStarted', 'InspectStarted'].includes(event.type)) {
      this.#cancel(event.instanceId, event.at)
      if (event.type === 'DrawStarted')
        this.#start(event, 'draw', profile.draw, event.payload.readyTick * h, `draw:${event.payload.switchId}`)
      if (event.type === 'ReloadStarted') {
        const role = event.payload.branch === 'empty'
          ? 'reloadEmpty'
          : 'reloadTactical'
        this.#start(event, role, profile[role], event.payload.endTick * h, `reload:${event.payload.actionId}`)
      }
      if (event.type === 'InspectStarted')
        this.#start(event, 'inspect', profile.inspect, event.payload.endTick * h, `inspect:${event.payload.actionId}`)
    }
  }

  #markers(at, inclusive) {
    for (const [key, action] of this.#actions) {
      const { event } = action
      const profile = this.#profiles[event.payload.weapon?.definitionId]
      while (action.cursor < action.markers.length) {
        const marker = action.markers[action.cursor]
        if (marker.at > at || (!inclusive && marker.at === at))
          break
        action.cursor++
        // Start sounds are owned solely by accepted facts. Preserve independent cues only.
        if (marker.at >= action.endAt || (marker.time === 0 && marker.cue === action.cueId) || !profile?.cues[marker.cue])
          continue
        this.#cue({ ...event, at: marker.at }, marker.cue, {
          kind: 'action',
          actionId: action.actionId,
          endAt: action.endAt,
          rate: action.rate,
          suffix: `marker:${marker.index}`,
        })
      }
      if (action.endAt <= at) {
        this.#actions.delete(key)
        this.#pending.delete(key)
      }
    }
  }

  motion(time) {
    if (this.#closed)
      return
    this.#events.sort((a, b) => a.at - b.at || a.sequence - b.sequence)
    while (this.#events.length && this.#events[0].at <= time.fixedElapsed) {
      const at = this.#events[0].at
      this.#markers(at, false)
      while (this.#events[0]?.at === at)
        this.#apply(this.#events.shift(), time.fixedDelta)
      this.#markers(at, true)
    }
    this.#markers(time.fixedElapsed, true)
    for (const [key, pending] of this.#pending) {
      const loaded = this.#assets.audioCue(pending.cueId)
      if (pending.cue.endAt <= time.fixedElapsed) {
        this.#pending.delete(key)
      }
      else if (loaded) {
        this.#audio.enqueue({ ...pending.cue, buffer: loaded.buffer, gain: loaded.gain })
        this.#pending.delete(key)
      }
    }
  }

  snapshot() {
    return {
      owner: this.#owner,
      epoch: this.#epoch,
      pending: this.#pending.size,
      bank: this.#assets.audioSnapshot(),
    }
  }

  dispose() {
    if (this.#closed)
      return
    this.#audio.invalidate({ scope: this.#scope, owner: this.#owner })
    this.#closed = true
    this.#events = []
    this.#actions.clear()
    this.#pending.clear()
  }
}
