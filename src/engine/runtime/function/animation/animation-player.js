import { AnimationClip, AnimationMixer, LoopOnce } from 'three/webgpu'
import { AnimationStateMachine } from './animation-state-machine.js'
import { ClipLibrary, immutable, seconds } from './clip-library.js'
import { ControlSampler } from './control-sampler.js'

/** One visual instance, one playback owner. Gameplay decides which semantic role to play. */
export class AnimationPlayer {
  #root
  #library
  #mixer
  #controls
  #state = new AnimationStateMachine()
  #actions = new Map()
  #disposed = false

  constructor({ root, clips, actions, controls } = {}) {
    this.#library = new ClipLibrary({ root, clips, actions, controls })
    this.#root = root
    this.#mixer = new AnimationMixer(root)
    this.#controls = new ControlSampler(root, this.#library)
  }

  /** Replace the complete sparse override set atomically. Times are explicit clip-local seconds. */
  setControls(samples) {
    this.#assertLive()
    this.#controls.set(samples)
    this.#sample()
  }

  clearControls() {
    this.setControls({})
  }

  play(role, { restart = false, fade, rate } = {}) {
    this.#assertLive()
    const profile = this.#library.get(role)
    if (typeof restart !== 'boolean')
      throw new TypeError('[Animation] restart must be boolean')
    const options = {
      restart,
      fade: seconds(fade ?? profile.fade, 'fade'),
      rate: seconds(rate ?? profile.rate, 'rate', true),
    }
    const id = this.#state.play(profile, options)
    this.#sample()
    return id
  }

  advance(delta) {
    this.#assertLive()
    seconds(delta, 'delta')
    if (!Number.isFinite(this.#state.time + delta))
      throw new RangeError('[Animation] Time overflow')
    for (const layer of this.#state.layers) {
      if (!Number.isFinite((this.#state.time + delta - layer.startedAt) * layer.rate))
        throw new RangeError('[Animation] Playback time overflow')
    }
    const events = this.#state.advance(delta)
    this.#sample()
    return immutable(events)
  }

  #sample() {
    // Restore BEFORE action stop/creation: Mixer caches originals on activation and may skip
    // unchanged outputs. An override must never become its original or next frame's base pose.
    this.#controls.restore()
    const alive = new Set(this.#state.layers.map(layer => layer.playbackId))
    for (const [id, entry] of this.#actions) {
      if (!alive.has(id)) {
        entry.action.stop()
        this.#mixer.uncacheAction(entry.clip, this.#root)
        this.#mixer.uncacheClip(entry.clip)
        this.#actions.delete(id)
      }
    }
    for (const layer of this.#state.layers) {
      let entry = this.#actions.get(layer.playbackId)
      if (!entry) {
        // Distinct clip identity permits a continuous crossfade when restarting the same clip.
        // Immutable tracks/typed arrays remain shared with the resource-owned source clip.
        const clip = new AnimationClip(layer.clip.name, layer.clip.duration, layer.clip.tracks, layer.clip.blendMode)
        const action = this.#mixer.clipAction(clip, this.#root)
        action.setLoop(LoopOnce, 1)
        action.clampWhenFinished = true
        action.play()
        entry = { clip, action }
        this.#actions.set(layer.playbackId, entry)
      }
      entry.action.enabled = true
      entry.action.paused = true
      entry.action.time = layer.localTime
      entry.action.setEffectiveWeight(layer.weight)
    }
    // All clocks and event decisions are above. Mixer only samples the selected local times.
    this.#mixer.update(0)
    this.#controls.apply()
    this.#root.updateMatrixWorld(true)
  }

  stop() {
    if (this.#disposed)
      return
    this.#controls.clear()
    this.#state.stop()
    this.#sample()
  }

  snapshot() {
    const describe = layer => ({
      role: layer.role,
      playbackId: layer.playbackId,
      localTime: layer.localTime,
      weight: layer.weight,
      loop: layer.loop,
      finished: layer.finished,
    })
    return immutable({
      time: this.#state.time,
      current: this.#state.current
        ? describe(this.#state.current)
        : null,
      layers: this.#state.layers.map(describe),
      disposed: this.#disposed,
      controls: this.#controls.snapshot(),
      stats: { actions: this.#mixer.stats.actions.total, bindings: this.#mixer.stats.bindings.total },
    })
  }

  #assertLive() {
    if (this.#disposed)
      throw new Error('[Animation] Player is disposed')
  }

  dispose() {
    if (this.#disposed)
      return
    this.stop()
    this.#mixer.stopAllAction()
    this.#mixer.uncacheRoot(this.#root)
    this.#disposed = true
  }
}
