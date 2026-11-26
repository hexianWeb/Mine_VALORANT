import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DynamicDrawUsage,
  Group,
  LineBasicMaterial,
  LineSegments,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
} from 'three/webgpu'
import { Disposer } from '../../../engine/runtime/core/disposer.js'
import { createParticleSystem } from '../../../engine/runtime/function/particle/particle-system.js'
import { shotRandom } from '../../weapons/shot-random.js'

const arcLifetime = 0.19
const fragmentLifetime = 0.28
const arcCount = 3
const segmentsPerArc = 5
const gold = new Color(0xFFB337).multiplyScalar(3)
const spark = new Color(0xFFE480).multiplyScalar(5).toArray()
const chip = new Color(0x99754E).toArray()

function flashTexture(document) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const ctx = canvas.getContext('2d')
  const halo = ctx.createRadialGradient(64, 64, 0, 64, 64, 63)
  halo.addColorStop(0, '#fffff4')
  halo.addColorStop(0.18, '#ffecb7e8')
  halo.addColorStop(0.43, '#ffb43d53')
  halo.addColorStop(1, '#ff8d0500')
  ctx.fillStyle = halo
  ctx.fillRect(0, 0, 128, 128)
  ctx.translate(64, 64)
  ctx.fillStyle = '#fffbe8'
  for (let index = 0; index < 8; index++) {
    ctx.rotate(Math.PI / 4)
    ctx.beginPath()
    ctx.moveTo(-5, 2)
    ctx.lineTo(0, index % 2 === 0
      ? -60
      : -34)
    ctx.lineTo(5, 2)
    ctx.closePath()
    ctx.fill()
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

function burstParticles({ at, origin, random, motionRate }) {
  return Array.from({ length: 18 }, (_, index) => {
    const debris = index >= 13
    const azimuth = random() * Math.PI * 2
    const speed = debris
      ? 1.7 + random() * 1.8
      : 3.2 + random() * 4.3
    return {
      shape: debris ? 'cube' : 'streak',
      origin,
      velocity: [
        Math.cos(azimuth) * speed * motionRate,
        (random() - 0.24) * speed * motionRate,
        Math.sin(azimuth) * speed * motionRate,
      ],
      born: at,
      life: (debris
        ? fragmentLifetime
        : 0.14 + random() * 0.05) / motionRate,
      size: debris ? 0.075 : 0.023,
      stretch: debris ? 1.5 : 1,
      color: debris ? chip : spark,
      gravity: 9 * motionRate ** 2,
    }
  })
}

/** All flashes, arcs and particles are level-owned and sampled on presentation time. */
export function createRangeKillEffects({ scene, document, capacity }) {
  const owned = new Disposer()
  const texture = owned.add(flashTexture(document))
  const root = new Group()
  root.name = 'Range kill effects'
  owned.add(() => root.removeFromParent())
  const particles = owned.add(createParticleSystem({ scene: root, capacity: capacity * 18 }))
  const slots = Array.from({ length: capacity }, () => {
    const material = owned.add(new SpriteMaterial({
      map: texture,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }))
    const sprite = new Sprite(material)
    sprite.visible = false
    sprite.raycast = () => {}
    root.add(sprite)
    return {
      sprite,
      fact: null,
      arcs: null,
      born: 0,
    }
  })
  const vertices = capacity * arcCount * segmentsPerArc * 2
  const arcGeometry = owned.add(new BufferGeometry())
  const positions = new BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(DynamicDrawUsage)
  const colors = new BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(DynamicDrawUsage)
  arcGeometry.setAttribute('position', positions)
  arcGeometry.setAttribute('color', colors)
  const arcs = new LineSegments(arcGeometry, owned.add(new LineBasicMaterial({
    vertexColors: true,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  })))
  arcs.frustumCulled = false
  arcs.visible = false
  arcs.raycast = () => {}
  root.add(arcs)
  let displayed = 0
  let overflow = 0
  let lastAt = null
  let clockOffset = 0
  let currentScale = 1
  const origin = new Vector3()
  const normal = new Vector3()

  function release(slot) {
    slot.fact = null
    slot.arcs = null
    slot.born = 0
    slot.sprite.visible = false
  }

  scene.add(root)
  return {
    start(fact, presentationTime, motionRate = 1) {
      const worldNow = lastAt === null
        ? presentationTime
        : presentationTime - clockOffset
      const born = worldNow - Math.max(0, presentationTime - fact.at) * currentScale
      if (worldNow >= born + fragmentLifetime)
        return
      for (const slot of slots) {
        if (slot.fact && worldNow >= slot.born + fragmentLifetime)
          release(slot)
      }
      const slot = slots.find(slot => !slot.fact)
      if (!slot) {
        overflow++
        return
      }
      displayed++
      const random = shotRandom(fact.presentationSeed)
      origin.fromArray(fact.impact.position).addScaledVector(normal.fromArray(fact.impact.normal), 0.045)
      slot.fact = fact
      slot.born = born
      slot.sprite.position.copy(origin)
      slot.sprite.material.rotation = random() * Math.PI
      slot.arcs = Array.from({ length: arcCount }, (_, index) => {
        const angle = index * Math.PI * 2 / arcCount + random()
        return Array.from({ length: segmentsPerArc + 1 }, (_, step) => {
          const distance = step * (0.14 + random() * 0.035)
          return [
            Math.cos(angle) * distance + (random() - 0.5) * 0.18,
            Math.sin(angle) * distance + (random() - 0.5) * 0.22,
            (random() - 0.5) * 0.44,
          ]
        })
      })
      particles.emit(burstParticles({
        at: fact.at,
        origin: origin.toArray(),
        random,
        motionRate,
      }))
    },
    present(at, worldTimeScale = 1) {
      const scale = Number.isFinite(worldTimeScale) && worldTimeScale >= 0
        ? worldTimeScale
        : 1
      if (lastAt !== null && at > lastAt)
        clockOffset += (at - lastAt) * (1 - scale)
      lastAt = at
      currentScale = scale
      const worldAt = at - clockOffset
      let count = 0
      for (const slot of slots) {
        const { fact, sprite, arcs, born } = slot
        if (!fact)
          continue
        const age = worldAt - born
        if (age >= fragmentLifetime) {
          release(slot)
          continue
        }
        // The bright core subsides while arcs and metal fragments keep moving.
        const flash = Math.max(0, 1 - age / 0.1)
        sprite.visible = flash > 0
        if (sprite.visible) {
          sprite.scale.setScalar(2.15 + age * 5)
          sprite.material.opacity = flash * flash
        }
        if (age >= arcLifetime)
          continue
        const life = 1 - age / arcLifetime
        const spread = 0.72 + age * 2.7
        for (const arc of arcs) {
          for (let step = 0; step < segmentsPerArc; step++) {
            for (const index of [step, step + 1]) {
              const [x, y, z] = arc[index]
              const intensity = life * (1 - 0.65 * index / segmentsPerArc)
              positions.setXYZ(count, sprite.position.x + x * spread, sprite.position.y + y * spread, sprite.position.z + z * spread)
              colors.setXYZ(count, gold.r * intensity, gold.g * intensity, gold.b * intensity)
              count++
            }
          }
        }
      }
      arcs.visible = count > 0
      if (count) {
        arcGeometry.setDrawRange(0, count)
        positions.needsUpdate = colors.needsUpdate = true
      }
      particles.setTimeScale(scale)
      particles.flush({ presentationTime: at })
    },
    clear() {
      lastAt = null
      clockOffset = 0
      currentScale = 1
      for (const slot of slots) release(slot)
      arcs.visible = false
      particles.clear()
    },
    snapshot() {
      return {
        capacity,
        displayed,
        overflow,
        active: slots.flatMap(({ fact }) => fact
          ? [
              {
                spawnId: fact.spawnId,
                cellId: fact.cellId,
                at: fact.at,
                bodyHideAt: fact.bodyHideAt,
                position: fact.position,
              },
            ]
          : []),
      }
    },
    dispose: () => owned.dispose(),
  }
}
