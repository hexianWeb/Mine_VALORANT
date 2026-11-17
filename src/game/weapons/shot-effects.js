import { Color, PerspectiveCamera, Vector3 } from 'three/webgpu'
import { Disposer } from '../../engine/runtime/core/disposer.js'
import { createDecalSystem } from '../../engine/runtime/function/decal/decal-system.js'
import { createBulletHoleTexture } from './bullet-hole.js'
import { isImpactColor } from './impact-surfaces.js'
import { shotRandom } from './shot-random.js'

const palette = (colors, intensity = 1) => colors.map(hex => new Color(hex).multiplyScalar(intensity).toArray())
const presets = {
  metal: [
    {
      shape: 'streak',
      count: [8, 12],
      life: [0.13, 0.17],
      speed: [5, 10],
      size: [0.014, 0.026],
      cone: 1.02,
      gravity: 10,
      colors: palette([0xFFEA84, 0xFFC354, 0xFFF8BB], 7),
    },
    {
      shape: 'cube',
      count: [2, 2],
      life: [0.18, 0.27],
      speed: [1.6, 3.1],
      size: [0.035, 0.052],
      cone: 0.9,
      gravity: 11,
      colors: palette([0x5B6570, 0x9297A0]),
    },
  ],
  stone: [
    {
      shape: 'streak',
      count: [2, 3],
      life: [0.08, 0.13],
      speed: [3.5, 6],
      size: [0.011, 0.018],
      cone: 1,
      gravity: 10,
      colors: palette([0xFFD688, 0xFFB358], 2.8),
    },
    {
      shape: 'cube',
      count: [6, 8],
      life: [0.23, 0.37],
      speed: [1.5, 4],
      size: [0.036, 0.071],
      cone: 1.06,
      gravity: 10,
      colors: palette([0x777D82, 0x9DA0A4, 0xC6C5BD, 0x565B63]),
    },
    {
      shape: 'puff',
      count: [1, 1],
      life: [0.28, 0.34],
      speed: [0.55, 1.1],
      size: [0.16, 0.23],
      cone: 0.62,
      gravity: -0.4,
      colors: palette([0xC7C5C1, 0xB1B4B9]),
    },
  ],
  wood: [
    {
      shape: 'cube',
      count: [6, 8],
      life: [0.24, 0.38],
      speed: [1.8, 4.5],
      size: [0.023, 0.046],
      cone: 1.03,
      gravity: 9.5,
      stretch: 2.25,
      colors: palette([0xD0924D, 0xEDC17E, 0x865231, 0xB5743F]),
    },
    {
      shape: 'puff',
      count: [1, 1],
      life: [0.24, 0.31],
      speed: [0.55, 0.95],
      size: [0.13, 0.18],
      cone: 0.66,
      gravity: -0.35,
      colors: palette([0xCEA371, 0xBD925E]),
    },
  ],
  sand: [
    {
      shape: 'cube',
      count: [6, 9],
      life: [0.22, 0.35],
      speed: [1.4, 3.4],
      size: [0.024, 0.052],
      cone: 1.08,
      gravity: 10,
      colors: palette([0xD8C38F, 0xE9D8AB, 0xBFA472, 0xCDB580]),
    },
    {
      shape: 'puff',
      count: [2, 2],
      life: [0.32, 0.45],
      speed: [0.55, 1.05],
      size: [0.17, 0.25],
      cone: 0.85,
      gravity: -0.35,
      colors: palette([0xDFCCA1, 0xCDB88C]),
    },
  ],
  dirt: [
    {
      shape: 'cube',
      count: [4, 4],
      life: [0.22, 0.34],
      speed: [1.3, 2.8],
      size: [0.035, 0.059],
      cone: 1.06,
      gravity: 10,
      colors: palette([0x8E5E37, 0xB08454, 0x6F4A31]),
    },
    {
      shape: 'puff',
      count: [2, 2],
      life: [0.36, 0.47],
      speed: [0.65, 1.18],
      size: [0.23, 0.3],
      cone: 0.9,
      gravity: -0.38,
      colors: palette([0xA98256, 0xC4A374, 0xAE875F]),
    },
  ],
}

function presetColor(preset, random, tint) {
  const index = Math.floor(random() * preset.colors.length)
  if (!tint || preset.shape === 'streak')
    return preset.colors[index]
  // Keep the shot's random sequence and motion unchanged when only the tint changes.
  const shade = 0.7 + 0.35 * index / Math.max(1, preset.colors.length - 1)
  return tint.clone().multiplyScalar(shade).toArray()
}

function createImpactParticles({ at, payload }) {
  const { impact, eyeOrigin, shotDirection, shotSequence } = payload
  const tint = isImpactColor(impact.surfaceColor)
    ? new Color(impact.surfaceColor)
    : null
  const normal = new Vector3().fromArray(impact.normal)
  const point = new Vector3().fromArray(impact.position)
  // For a multi-pellet shot, the impact belongs to the nearest hit pellet.
  const incident = impact.distance > 0
    ? point.clone().sub(new Vector3().fromArray(eyeOrigin)).normalize()
    : new Vector3().fromArray(shotDirection)
  const axis = incident.reflect(normal).add(normal).normalize()
  const reference = Math.abs(axis.y) > 0.95
    ? new Vector3(1, 0, 0)
    : new Vector3(0, 1, 0)
  const tangent = new Vector3().crossVectors(reference, axis).normalize()
  const bitangent = new Vector3().crossVectors(axis, tangent)
  const origin = point.addScaledVector(normal, 0.01).toArray()
  const random = shotRandom(shotSequence)
  const between = ([min, max]) => min + (max - min) * random()
  const particles = []
  for (const preset of presets[impact.surface]) {
    const count = Math.floor(between([preset.count[0], preset.count[1] + 1]))
    const minCos = Math.cos(preset.cone)
    for (let index = 0; index < count; index++) {
      const angle = random() * 2 * Math.PI
      const cos = between([minCos, 1])
      const sin = Math.sqrt(1 - cos * cos)
      const direction = axis.clone().multiplyScalar(cos).addScaledVector(tangent, Math.cos(angle) * sin).addScaledVector(bitangent, Math.sin(angle) * sin)
      if (direction.dot(normal) < 0)
        direction.reflect(normal)
      particles.push({
        shape: preset.shape,
        origin,
        velocity: direction.multiplyScalar(between(preset.speed)).toArray(),
        born: at,
        life: between(preset.life),
        size: between(preset.size),
        gravity: preset.gravity,
        color: presetColor(preset, random, tint),
        stretch: preset.stretch,
      })
    }
  }
  return particles
}

/** Muzzle is camera-local, not the socket's borrowed world-space transform. */
export function projectMuzzleToWorld(muzzle, viewCamera, worldCamera, depth = 0.4) {
  const screen = new Vector3().fromArray(muzzle).applyMatrix4(viewCamera.projectionMatrix)
  const plane = new Vector3(0, 0, -Math.max(depth, worldCamera.near * 1.01))
    .applyMatrix4(worldCamera.projectionMatrix)
  worldCamera.updateWorldMatrix(true, false)
  return new Vector3(screen.x, screen.y, plane.z).unproject(worldCamera).toArray()
}

const tracerSpeed = 160
const maxPelletTracers = 3
const bulletHoleLifetime = 8

/** Shot event dispatcher. Engine effects own draws; this layer owns weapon-specific policy. */
export class ShotEffects {
  #particles
  #decals
  #camera
  #viewCamera
  #samplePose
  #shotCamera = new PerspectiveCamera()
  #shotViewCamera = new PerspectiveCamera()
  #owned = new Disposer()

  constructor({ particles = null, decals = null, scene = null, camera = null, viewCamera = null, samplePose = null }) {
    this.#particles = particles
    this.#camera = camera
    this.#viewCamera = viewCamera
    this.#samplePose = samplePose
    this.#decals = decals
    if (!decals && scene) {
      const map = this.#owned.add(createBulletHoleTexture())
      this.#decals = this.#owned.add(createDecalSystem({ scene, map, lifetime: bulletHoleLifetime }))
    }
  }

  receive({ events }) {
    if (this.#owned.disposed)
      return
    for (const event of events) {
      if (event.type === 'PresentationReset') {
        this.#particles?.clear()
        this.#decals?.clear()
      }
      if (event.type !== 'ShotFired')
        continue
      if (event.payload.impact.hit)
        this.#particles?.emit(createImpactParticles(event))
      const impacts = event.payload.pellets?.map(pellet => pellet.impact) ?? [event.payload.impact]
      const random = shotRandom(event.payload.shotSequence)
      const decals = impacts.filter(impact => impact.hit && !impact.targetId).map(impact => ({
        position: impact.position,
        normal: impact.normal,
        born: event.at,
        size: (0.075 + random() * 0.025) * 1.5,
        rotation: random() * Math.PI * 2,
      }))
      if (decals.length)
        this.#decals?.emit(decals)
    }
  }

  /** Muzzle samples are captured by WeaponViewModel at each shot boundary, before frame advance. */
  motion(time, shots = []) {
    if (this.#owned.disposed)
      return
    if (this.#particles && this.#camera && this.#viewCamera && this.#samplePose) {
      for (const { event, muzzle } of shots) {
        const pose = this.#samplePose(event.at)
        const camera = this.#shotCamera.copy(this.#camera, false)
        camera.position.fromArray(pose.position)
        camera.quaternion.fromArray(pose.quaternion)
        camera.scale.set(1, 1, 1)
        camera.fov = pose.worldFov
        camera.updateProjectionMatrix()
        const viewCamera = this.#shotViewCamera.copy(this.#viewCamera, false)
        viewCamera.fov = pose.viewmodelFov
        viewCamera.updateProjectionMatrix()
        const pellets = event.payload.pellets
        const stride = Math.ceil((pellets?.length ?? 1) / maxPelletTracers)
        const impacts = pellets
          ? pellets.filter((_pellet, index) => index % stride === 0).map(pellet => pellet.impact)
          : [event.payload.impact]
        const tracers = []
        for (const impact of impacts) {
          if (impact.distance <= camera.near * 1.01)
            continue
          const origin = projectMuzzleToWorld(muzzle, viewCamera, camera, Math.min(0.4, impact.distance * 0.5))
          const velocity = new Vector3().fromArray(impact.position).sub(new Vector3().fromArray(origin))
          const distance = velocity.length()
          if (distance <= 1e-5)
            continue
          tracers.push({
            shape: 'tracer',
            origin,
            velocity: velocity.multiplyScalar(tracerSpeed / distance).toArray(),
            born: event.at,
            life: distance / tracerSpeed,
            size: 0.005,
            gravity: 0,
            color: [6, 3.4, 1.2],
          })
        }
        if (tracers.length)
          this.#particles.emit(tracers)
      }
    }
    this.#decals?.flush(time)
  }

  snapshot() {
    return { decals: this.#decals?.snapshot() ?? null }
  }

  dispose() {
    if (this.#owned.disposed)
      return
    this.#particles?.clear()
    this.#decals?.clear()
    this.#owned.dispose()
  }
}
