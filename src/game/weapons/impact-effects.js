import { Color, Vector3 } from 'three/webgpu'

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

function shotRandom(sequence) {
  let state = Math.imul(sequence, 0x9E3779B9) || 1
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 0x100000000
  }
}

function createImpactParticles({ at, payload }) {
  const { impact, eyeOrigin, shotDirection, shotSequence } = payload
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
        color: preset.colors[Math.floor(random() * preset.colors.length)],
        stretch: preset.stretch,
      })
    }
  }
  return particles
}

/** Converts accepted shots into world effects using the shots' presentation timestamps. */
export class ImpactEffects {
  #particles

  constructor(particles) {
    this.#particles = particles
  }

  receive({ events }) {
    for (const event of events) {
      if (event.type === 'PresentationReset')
        this.#particles.clear()
      if (event.type === 'ShotFired' && event.payload.impact.hit)
        this.#particles.emit(createImpactParticles(event))
    }
  }

  dispose() {
    this.#particles.clear()
  }
}
