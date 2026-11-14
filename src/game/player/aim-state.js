import { Euler, MathUtils, Quaternion, Vector3 } from 'three/webgpu'
import { createAimProfile } from '../weapons/aim-profile.js'

const neutral = createAimProfile()
const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle))

function finite(value, name) {
  if (!Number.isFinite(value))
    throw new TypeError(`[AimState] ${name} must be finite`)
  return value
}

function point(value) {
  const result = Array.isArray(value)
    ? [...value]
    : [value?.x, value?.y, value?.z]
  if (result.length !== 3 || !result.every(Number.isFinite))
    throw new TypeError('[AimState] Expected finite feet coordinates')
  return result
}

function freeze(value) {
  if (Array.isArray(value))
    return Object.freeze(value.map(freeze))
  if (value && typeof value === 'object') {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      freeze(entry),
    ])))
  }
  return value
}

function hashSeed(seed, instanceId, sequence) {
  let result = (2166136261 ^ seed) >>> 0
  for (const character of `${instanceId}:${sequence}`)
    result = Math.imul(result ^ character.charCodeAt(0), 16777619) >>> 0
  return result
}

function random(seed) {
  let state = seed
  return () => {
    state = (state + 0x6D2B79F5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), state | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function spreadDirection(next, spread, orientation) {
  return new Vector3((next() - next()) * spread, (next() - next()) * spread, -1 + (next() - next()) * spread)
    .normalize()
    .applyQuaternion(orientation)
    .toArray()
}

function curveAt(curve, time) {
  if (!curve.length || time < 0 || time > curve.at(-1).time)
    return 0
  for (let index = 1; index < curve.length; index++) {
    if (time <= curve[index].time) {
      const previous = curve[index - 1]
      const next = curve[index]
      return MathUtils.lerp(previous.value, next.value, (time - previous.time) / (next.time - previous.time))
    }
  }
  return curve[0].value
}

function recoilAt(segments, at) {
  let yaw = 0
  let pitch = 0
  for (const segment of segments) {
    yaw += curveAt(segment.yaw, at - segment.at)
    pitch += curveAt(segment.pitch, at - segment.at)
  }
  return { yaw, pitch }
}

function quaternion(yaw, pitch) {
  return new Quaternion().setFromEuler(new Euler(pitch, yaw, 0, 'YXZ')).toArray()
}

/** Fixed gameplay view and shot authority. Presentation reads history without advancing it. */
export class AimState {
  #yaw = 0
  #pitch = 0
  #pendingYaw = 0
  #pendingPitch = 0
  #maxPitch
  #verticalOffset
  #offsetSmoothing
  #stepRate
  #smoothedStep = 0
  #stepDeltaY = 0
  #stepOffset = 0
  #worldFov
  #viewmodelFov
  #limitStepOffset
  #seed
  #at = 0
  #feet = [0, 0, 0]
  #ads = 0
  #aiming = false
  #spread = 0
  #profile = neutral
  #segments = []
  #history = []
  #step = null
  #lastStepAt = null
  #shots = new Map()

  constructor({ maxPitch = MathUtils.degToRad(89), verticalOffset = 1.62, offsetSmoothing = 12, stepSmoothingTime = 0.1, worldFov = 75, viewmodelFov = 70, limitStepOffset = null, seed = 1 } = {}) {
    if (!Number.isFinite(maxPitch) || maxPitch < 0 || maxPitch > Math.PI / 2
      || !Number.isFinite(verticalOffset) || !Number.isFinite(offsetSmoothing) || offsetSmoothing < 0
      || !Number.isFinite(stepSmoothingTime) || stepSmoothingTime < 0
      || !Number.isFinite(worldFov) || worldFov <= 0 || worldFov >= 180
      || !Number.isFinite(viewmodelFov) || viewmodelFov <= 0 || viewmodelFov >= 180
      || (limitStepOffset !== null && typeof limitStepOffset !== 'function') || !Number.isSafeInteger(seed)) {
      throw new TypeError('[AimState] Invalid view configuration')
    }
    this.#maxPitch = maxPitch
    this.#verticalOffset = verticalOffset
    this.#offsetSmoothing = offsetSmoothing
    this.#stepRate = stepSmoothingTime > 0
      ? Math.LN10 / stepSmoothingTime
      : 0
    this.#worldFov = worldFov
    this.#viewmodelFov = viewmodelFov
    this.#limitStepOffset = limitStepOffset
    this.#seed = seed >>> 0
    this.reset({
      feet: [0, 0, 0],
    })
  }

  get yaw() { return this.#yaw }
  get pitch() { return this.#pitch }
  get headingYaw() { return wrap(this.#yaw + this.#pendingYaw) }

  queueLook(deltaYaw, deltaPitch) {
    finite(deltaYaw, 'deltaYaw')
    finite(deltaPitch, 'deltaPitch')
    const yaw = finite(this.#pendingYaw + deltaYaw, 'pending yaw')
    const pitch = finite(this.#pendingPitch + deltaPitch, 'pending pitch')
    this.#pendingYaw = yaw
    this.#pendingPitch = pitch
  }

  clearInput() {
    this.#pendingYaw = 0
    this.#pendingPitch = 0
  }

  /** Resume an unscheduled view at the next step's left boundary without consuming new input. */
  rebase(at) {
    finite(at, 'rebase time')
    if (this.#step || at < this.#at)
      throw new RangeError('[AimState] Cannot rebase an active step or move time backwards')
    const offset = at - this.#at
    this.#segments = this.#segments.map(segment => freeze({
      ...segment,
      at: segment.at + offset,
      endAt: segment.endAt + offset,
    }))
    const pose = freeze({
      ...this.#history.at(-1).after,
      at,
    })
    this.#at = at
    this.#lastStepAt = at
    this.#history = [
      {
        at,
        before: pose,
        after: pose,
        segments: [...this.#segments],
      },
    ]
  }

  reset({ feet, yaw = 0, pitch = 0, verticalOffset = this.#verticalOffset, stepDeltaY = 0, at = 0 }) {
    const position = point(feet)
    for (const [name, value] of Object.entries({
      yaw,
      pitch,
      verticalOffset,
      stepDeltaY,
      at,
    })) finite(value, name)
    if (at < 0)
      throw new RangeError('[AimState] Negative reset time')
    this.#yaw = wrap(yaw)
    this.#pitch = MathUtils.clamp(pitch, -this.#maxPitch, this.#maxPitch)
    this.#feet = position
    this.#verticalOffset = verticalOffset
    this.#smoothedStep = stepDeltaY
    this.#stepDeltaY = stepDeltaY
    this.#stepOffset = 0
    this.#at = at
    this.#ads = 0
    this.#aiming = false
    this.#spread = 0
    this.#profile = neutral
    this.#segments = []
    this.#step = null
    this.#lastStepAt = null
    this.#shots.clear()
    this.clearInput()
    const pose = this.#pose()
    this.#history = [
      {
        at,
        before: pose,
        after: pose,
        segments: [],
      },
    ]
  }

  beginStep({ at, delta, feet, verticalOffset = this.#verticalOffset, stepDeltaY = this.#stepDeltaY, aim = false, definition = null, moving = false, crouched = false }) {
    const position = point(feet)
    for (const [name, value] of Object.entries({
      at,
      delta,
      verticalOffset,
      stepDeltaY,
    })) finite(value, name)
    if (this.#step || delta <= 0 || at < this.#at
      || (this.#lastStepAt !== null && Math.abs(at - this.#lastStepAt - delta) > 1e-8)) {
      throw new RangeError('[AimState] Expected the next complete fixed step')
    }
    this.#at = at
    this.#feet = position
    this.#yaw = this.headingYaw
    this.#pitch = MathUtils.clamp(this.#pitch + this.#pendingPitch, -this.#maxPitch, this.#maxPitch)
    this.clearInput()
    this.#profile = definition
      ? {
          recoil: definition.recoil ?? neutral.recoil,
          spread: definition.spread ?? neutral.spread,
          aim: definition.aim ?? neutral.aim,
        }
      : neutral
    this.#aiming = !!aim && !!definition?.capabilities?.ads
    const target = Number(this.#aiming)
    if (!definition?.capabilities?.ads || this.#profile.aim.duration === 0)
      this.#ads = target
    else
      this.#ads += MathUtils.clamp(target - this.#ads, -delta / this.#profile.aim.duration, delta / this.#profile.aim.duration)
    const spread = this.#profile.spread
    this.#spread = this.#aiming
      ? spread.ads
      : moving
        ? spread.move
        : crouched ? spread.crouch : spread.stand
    const blend = this.#offsetSmoothing > 0
      ? 1 - Math.exp(-this.#offsetSmoothing * delta)
      : 1
    this.#verticalOffset += (verticalOffset - this.#verticalOffset) * blend
    this.#stepDeltaY = stepDeltaY
    this.#smoothedStep = this.#stepRate > 0
      ? MathUtils.damp(this.#smoothedStep, stepDeltaY, this.#stepRate, delta)
      : stepDeltaY
    this.#stepOffset = this.#smoothedStep - stepDeltaY
    if (Math.abs(this.#stepOffset) < 1e-6)
      this.#stepOffset = 0
    this.#segments = this.#segments.filter(segment => segment.endAt >= at)
    const before = this.#pose()
    this.#step = { at, before, current: before }
    return this.#step.before
  }

  #pose() {
    const recoil = recoilAt(this.#segments, this.#at)
    const yaw = wrap(this.#yaw + recoil.yaw)
    const pitch = MathUtils.clamp(this.#pitch + recoil.pitch, -this.#maxPitch, this.#maxPitch)
    const rotation = quaternion(yaw, pitch)
    const worldFov = MathUtils.lerp(this.#worldFov, this.#profile.aim.worldFov, this.#ads)
    const position = [this.#feet[0], this.#feet[1] + this.#verticalOffset, this.#feet[2]]
    let stepOffset = this.#stepOffset
    if (stepOffset > 0 && this.#limitStepOffset) {
      const limit = this.#limitStepOffset(freeze({ position, quaternion: rotation, worldFov }), stepOffset)
      if (!Number.isFinite(limit))
        throw new TypeError('[AimState] Step limiter must return finite clearance')
      stepOffset = MathUtils.clamp(limit, 0, stepOffset)
    }
    position[1] += stepOffset
    return freeze({
      at: this.#at,
      position,
      quaternion: rotation,
      baseQuaternion: quaternion(this.#yaw, this.#pitch),
      yaw,
      pitch,
      baseYaw: this.#yaw,
      basePitch: this.#pitch,
      worldFov,
      viewmodelFov: MathUtils.lerp(this.#viewmodelFov, this.#profile.aim.viewmodelFov, this.#ads),
      ads: this.#ads,
      aiming: this.#aiming,
      spread: this.#spread,
      verticalOffset: this.#verticalOffset,
      stepOffset,
      recoilYaw: recoil.yaw,
      recoilPitch: recoil.pitch,
    })
  }

  /** Call only for an accepted fixed-step ShotFired; this method never decides ammo or cooldown. */
  fire({ instanceId, shotSequence, definition }) {
    if (!this.#step)
      throw new Error('[AimState] fire requires beginStep')
    if (typeof instanceId !== 'string' || !instanceId || !Number.isSafeInteger(shotSequence) || shotSequence < 1
      || shotSequence <= (this.#shots.get(instanceId) ?? 0)) {
      throw new Error('[AimState] Expected a new accepted shot identity')
    }
    const pelletCount = definition?.fire?.pellets ?? 1
    if (!Number.isSafeInteger(pelletCount) || pelletCount < 1 || pelletCount > 64)
      throw new RangeError('[AimState] Invalid pellet count')
    const before = this.#step.current
    const seed = hashSeed(this.#seed, instanceId, shotSequence)
    const next = random(seed)
    const orientation = new Quaternion().fromArray(before.quaternion)
    const aimDirection = new Vector3(0, 0, -1).applyQuaternion(orientation).toArray()
    const spread = before.spread
    const shotDirection = spreadDirection(next, spread, orientation)
    // A separate stream keeps the original first ray and ONE recoil impulse byte-for-byte stable.
    let pelletDirections
    if (pelletCount > 1) {
      const pelletRandom = random(hashSeed(this.#seed, `${instanceId}:pellets`, shotSequence))
      pelletDirections = [
        shotDirection,
        ...Array.from({ length: pelletCount - 1 }, () => spreadDirection(pelletRandom, spread, orientation)),
      ]
    }
    const source = definition?.recoil ?? neutral.recoil
    const sampleCurve = curve => curve.map(frame => ({
      time: frame.time,
      value: MathUtils.lerp(frame.min, frame.max, next()),
    }))
    const segment = {
      at: this.#at,
      pitch: sampleCurve(source.pitch),
      yaw: sampleCurve(source.yaw),
      endAt: this.#at + Math.max(source.pitch.at(-1)?.time ?? 0, source.yaw.at(-1)?.time ?? 0),
    }
    this.#segments.push(freeze(segment))
    this.#shots.set(instanceId, shotSequence)
    this.#step.current = this.#pose()
    return freeze({
      eyeOrigin: before.position,
      aimDirection,
      shotDirection,
      ...(pelletDirections
        ? { pelletDirections }
        : {}),
      seed,
      shotId: `${instanceId}:${shotSequence}`,
      patternIndex: shotSequence - 1,
      spread,
      impulse: {
        pitch: curveAt(segment.pitch, 0),
        yaw: curveAt(segment.yaw, 0),
      },
    })
  }

  endStep() {
    if (!this.#step)
      throw new Error('[AimState] endStep requires beginStep')
    const after = this.#step.current
    this.#smoothedStep = this.#stepDeltaY + after.stepOffset
    const record = {
      at: this.#step.at,
      before: this.#step.before,
      after,
      segments: [...this.#segments],
    }
    if (this.#history.at(-1).at === record.at)
      this.#history.pop()
    this.#history.push(record)
    if (this.#history.length > 64)
      this.#history.shift()
    this.#lastStepAt = this.#at
    this.#step = null
    return after
  }

  sample(at) {
    finite(at, 'sample time')
    const first = this.#history[0]
    const last = this.#history.at(-1)
    if (at <= first.at)
      return first.after
    if (at >= last.at)
      return last.after
    const index = this.#history.findIndex(record => record.at >= at)
    const next = this.#history[index]
    if (next.at === at)
      return next.after
    const previous = this.#history[index - 1]
    const start = previous.after
    const end = next.before
    const alpha = (at - previous.at) / (next.at - previous.at)
    const baseRotation = new Quaternion().fromArray(start.baseQuaternion).slerp(new Quaternion().fromArray(end.baseQuaternion), alpha)
    const base = new Euler().setFromQuaternion(baseRotation, 'YXZ')
    const recoil = recoilAt(previous.segments, at)
    const appliedPitch = MathUtils.clamp(base.x + recoil.pitch, -this.#maxPitch, this.#maxPitch) - base.x
    const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), recoil.yaw).multiply(baseRotation).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), appliedPitch))
    const viewAngles = new Euler().setFromQuaternion(rotation, 'YXZ')
    const yaw = viewAngles.y
    const pitch = viewAngles.x
    const interpolate = key => MathUtils.lerp(start[key], end[key], alpha)
    return freeze({
      at,
      position: start.position.map((value, axis) => MathUtils.lerp(value, end.position[axis], alpha)),
      quaternion: rotation.toArray(),
      baseQuaternion: baseRotation.toArray(),
      yaw,
      pitch,
      baseYaw: base.y,
      basePitch: base.x,
      worldFov: interpolate('worldFov'),
      viewmodelFov: interpolate('viewmodelFov'),
      ads: interpolate('ads'),
      aiming: start.aiming,
      spread: interpolate('spread'),
      verticalOffset: interpolate('verticalOffset'),
      stepOffset: interpolate('stepOffset'),
      recoilYaw: recoil.yaw,
      recoilPitch: recoil.pitch,
    })
  }
}
