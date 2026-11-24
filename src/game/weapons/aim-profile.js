const radians = degrees => degrees * Math.PI / 180

function record(value, name, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Object.keys(value).some(key => !fields.includes(key))) {
    throw new TypeError(`[AimProfile] Invalid ${name}`)
  }
}

function finite(value, name, minimum = 0) {
  if (!Number.isFinite(value) || value < minimum)
    throw new RangeError(`[AimProfile] Invalid ${name}`)
  return value
}

function curve(source, axis) {
  if (!Array.isArray(source))
    throw new TypeError(`[AimProfile] ${axis} must be a curve`)
  let previous = -1
  const result = Array.from(source, (point, index) => {
    record(point, axis, ['time', 'min', 'max'])
    const time = finite(point.time, `${axis}.time`)
    if ((index === 0 && time !== 0) || time <= previous
      || !Number.isFinite(point.min) || !Number.isFinite(point.max) || point.min > point.max) {
      throw new RangeError(`[AimProfile] Invalid ${axis} point`)
    }
    previous = time
    return Object.freeze({ time, min: point.min, max: point.max })
  })
  const last = result.at(-1)
  if (last && (last.min !== 0 || last.max !== 0))
    throw new RangeError(`[AimProfile] ${axis} must recover to zero`)
  return Object.freeze(result)
}

function sprayProfile(source) {
  record(source, 'recoil.spray', ['points', 'recoveryDelay', 'recoveryDuration'])
  const { points, recoveryDelay, recoveryDuration } = source
  if (!Array.isArray(points) || points.length < 2)
    throw new TypeError('[AimProfile] Spray needs at least two points')
  let previous = -1
  const result = Array.from(points, (point, index) => {
    record(point, 'recoil.spray point', ['index', 'pitch', 'yaw'])
    if (!Number.isSafeInteger(point.index) || point.index <= previous
      || !Number.isFinite(point.pitch) || !Number.isFinite(point.yaw)
      || (index === 0 && (point.index !== 0 || point.pitch !== 0 || point.yaw !== 0))) {
      throw new RangeError('[AimProfile] Spray points must start at zero and have increasing shot indices')
    }
    previous = point.index
    return Object.freeze({ index: point.index, pitch: point.pitch, yaw: point.yaw })
  })
  if (!Number.isFinite(recoveryDelay) || recoveryDelay <= 0
    || !Number.isFinite(recoveryDuration) || recoveryDuration <= 0
    || !Number.isFinite(recoveryDelay + recoveryDuration)) {
    throw new RangeError('[AimProfile] Spray recovery delay and duration must be positive finite seconds')
  }
  return Object.freeze({
    points: Object.freeze(result),
    recoveryDelay,
    recoveryDuration,
  })
}

function bloomProfile(source) {
  record(source, 'spread.bloom', [
    'perShot',
    'max',
    'recoveryDelay',
    'recoveryDuration',
  ])
  const perShot = finite(source.perShot, 'spread.bloom.perShot')
  const max = finite(source.max, 'spread.bloom.max', perShot)
  const recoveryDelay = finite(source.recoveryDelay, 'spread.bloom.recoveryDelay')
  const recoveryDuration = finite(source.recoveryDuration, 'spread.bloom.recoveryDuration')
  if (perShot === 0 || recoveryDuration === 0)
    throw new RangeError('[AimProfile] Bloom perShot and recoveryDuration must be positive')
  return Object.freeze({
    perShot,
    max,
    recoveryDelay,
    recoveryDuration,
  })
}

/** All runtime angles are radians, FOVs are degrees, and time is retained simulation seconds. */
export function createAimProfile({ recoil = { pitch: [], yaw: [] }, spread = {}, aim = {} } = {}) {
  record(recoil, 'recoil', ['pitch', 'yaw', 'spray'])
  record(spread, 'spread', [
    'stand',
    'move',
    'crouch',
    'ads',
    'bloom',
  ])
  record(aim, 'aim', [
    'duration',
    'releaseDuration',
    'worldFov',
    'viewmodelFov',
    'scopeZoom',
    'scopeAltZoom',
  ])
  const worldFov = finite(aim.worldFov ?? 45, 'worldFov')
  const viewmodelFov = finite(aim.viewmodelFov ?? 45, 'viewmodelFov')
  if (worldFov <= 0 || worldFov >= 180 || viewmodelFov <= 0 || viewmodelFov >= 180)
    throw new RangeError('[AimProfile] FOV must be in (0, 180)')
  const scopeZoom = aim.scopeZoom === undefined
    ? undefined
    : finite(aim.scopeZoom, 'scopeZoom', 1)
  const scopeAltZoom = aim.scopeAltZoom
  if (scopeAltZoom !== undefined && (scopeZoom === undefined || !Number.isFinite(scopeAltZoom) || scopeAltZoom <= scopeZoom))
    throw new RangeError('[AimProfile] Alternate scope magnification must exceed the primary magnification')
  const spreadValues = Object.fromEntries(['stand', 'move', 'crouch', 'ads']
    .map(key => [
      key,
      finite(spread[key] ?? 0, `spread.${key}`),
    ]))
  if (spread.bloom !== undefined)
    spreadValues.bloom = bloomProfile(spread.bloom)
  const recoilValues = {
    pitch: curve(recoil.pitch, 'pitch'),
    yaw: curve(recoil.yaw, 'yaw'),
  }
  if (recoil.spray !== undefined)
    recoilValues.spray = sprayProfile(recoil.spray)
  return Object.freeze({
    recoil: Object.freeze(recoilValues),
    spread: Object.freeze(spreadValues),
    aim: Object.freeze({
      duration: finite(aim.duration ?? 0, 'aim.duration'),
      ...(aim.releaseDuration === undefined
        ? {}
        : {
            releaseDuration: finite(aim.releaseDuration, 'aim.releaseDuration'),
          }),
      worldFov,
      viewmodelFov,
      ...(scopeZoom === undefined
        ? {}
        : { scopeZoom }),
      ...(scopeAltZoom === undefined
        ? {}
        : { scopeAltZoom }),
    }),
  })
}

export function aimTransitionDuration(profile, aiming) {
  const duration = profile?.duration ?? 0
  return aiming
    ? duration
    : profile?.releaseDuration ?? duration
}

// Source: first-person-pack/{classic,phantom}/sources/*_data.json, recoil/inaccuracy/aim_time.
// TACZ GunRecoil.java treats recoil times as seconds and samples each min/max keyframe.
// CameraSetupEvent applies curve differences to Minecraft player rotation in degrees:
// https://github.com/MCModderAnchor/TACZ/blob/1.20.1/src/main/java/com/tacz/guns/resource/pojo/data/gun/GunRecoil.java
// https://github.com/MCModderAnchor/TACZ/blob/1.20.1/src/main/java/com/tacz/guns/client/event/CameraSetupEvent.java
// Project policy: convert degrees to radians; positive pitch raises -Z aim and positive yaw turns
// left. Use an immediate post-shot first key and linear recovery per shot, retaining old curves
// through switches. This does not reproduce TACZ's +30 ms spline or latest-shot replacement.
// These sources have recoil, not camera_recoil; only one authoritative contribution is applied.
function recoilCurve(points) {
  return points.map(([time, min, max]) => ({
    time,
    min: radians(min),
    max: radians(max),
  }))
}

// Source inaccuracy is a dimensionless Projectile input, NOT degrees. This project's explicit
// calibration uses independent triangular direction noise at source * 0.0172275, then normalizes.
// The coefficient/distribution is project policy, not a claim of exact TACZ/Minecraft parity.
// Optional automatic-fire bloom is local gameplay tuning, not source inaccuracy data.
const spreadScale = 0.0172275
const phantomAimDuration = 0.12
function spreadProfile(stand, move, crouch, ads) {
  return {
    stand: stand * spreadScale,
    move: move * spreadScale,
    crouch: crouch * spreadScale,
    ads: ads * spreadScale,
  }
}

// Outlaw's local source pack provides these recoil curves and stance values.
export const outlawAimProfile = createAimProfile({
  aim: {
    duration: phantomAimDuration,
    releaseDuration: 0.25,
    viewmodelFov: 45,
    scopeZoom: 2.5,
  },
  recoil: {
    pitch: recoilCurve([
      [0, 0.8, 0.8],
      [0.1, 0.7, 0.7],
      [0.45, -0.2, -0.2],
      [0.6, 0, 0],
    ]),
    yaw: recoilCurve([
      [0, -0.3, 0.25],
      [0.35, 0, 0],
    ]),
  },
  spread: spreadProfile(4.5, 9, 3.5, 0.1),
})

// Source curves retain their local keys and recover to neutral after the last authored key.
export const operatorAimProfile = createAimProfile({
  aim: {
    duration: phantomAimDuration,
    releaseDuration: 0.35,
    viewmodelFov: 45,
    scopeZoom: 4,
    scopeAltZoom: 10,
  },
  recoil: {
    pitch: recoilCurve([
      [0, 4, 4],
      [0.1, 3, 3],
      [0.2, 3.6, 3.6],
      [0.45, 0, 0],
    ]),
    yaw: recoilCurve([
      [0, -0.8, 0.8],
      [0.1, 0.7, 0.7],
      [0.18, -0.4, -0.4],
      [0.35, 0, 0],
    ]),
  },
  spread: spreadProfile(6, 12, 5, 0.1),
})

export const classicAimProfile = createAimProfile({
  recoil: {
    pitch: recoilCurve([
      [0, 0.3, 0.3],
      [0.25, 0.4, 0.4],
      [0.45, -0.1, -0.1],
      [0.6, 0, 0],
    ]),
    yaw: recoilCurve([
      [0, -0.15, 0.15],
      [0.45, 0, 0],
    ]),
  },
  spread: spreadProfile(0.4, 6, 0.3, 6),
  aim: { duration: 0.005, worldFov: 70, viewmodelFov: 70 },
})

export const phantomAimProfile = createAimProfile({
  recoil: {
    pitch: recoilCurve([
      [0, 0.4, 0.4],
      [0.25, 0.55, 0.55],
      [0.45, -0.12, -0.12],
      [0.6, 0, 0],
    ]),
    yaw: recoilCurve([
      [0, -0.25, 0.15],
      [0.45, 0, 0],
    ]),
  },
  spread: {
    ...spreadProfile(0.2, 6.8, 0.17, 0.11),
    // Shared by Phantom, Vandal, Bulldog and Odin. At full bloom, recovery takes 0.52 s.
    bloom: {
      perShot: 0.0035,
      max: 0.0175,
      recoveryDelay: 0.18,
      recoveryDuration: 0.34,
    },
  },
  // Practice range transition shared with Vandal and Odin.
  aim: { duration: phantomAimDuration, worldFov: 45, viewmodelFov: 45 },
})
