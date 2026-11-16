import { mix, smoothstep, uniform, uv, vec3 } from 'three/tsl'
import { DoubleSide, Group, Mesh, MeshBasicNodeMaterial, PlaneGeometry } from 'three/webgpu'
import { Disposer } from '../../engine/runtime/core/disposer.js'
import { shotRandom } from './shot-random.js'

export const muzzleFlashDuration = 0.045

/** Camera-local crossed flame cards, owned by the weapon presentation, not the world. */
export function createMuzzleFlash() {
  const owned = new Disposer()
  const root = new Group()
  root.name = 'Weapon muzzle flash'
  root.visible = false
  const strength = uniform(0)
  const point = uv().sub(0.5).mul(2)
  const radius = point.length()
  const cross = point.x.abs().min(point.y.abs()).mul(2.6).add(radius.mul(0.55))
  const material = owned.add(new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
  }))
  material.colorNode = mix(vec3(6, 1.4, 0.15), vec3(10, 6, 1.9), smoothstep(0.05, 0.65, radius).oneMinus())
  material.opacityNode = smoothstep(0.15, 1, cross).oneMinus().mul(strength)
  const geometry = owned.add(new PlaneGeometry(1, 1))
  const cards = Array.from({ length: 3 }, (_, index) => {
    const card = new Mesh(geometry, material)
    card.name = `Muzzle flame ${index + 1}`
    card.frustumCulled = false
    card.raycast = () => {}
    root.add(card)
    return card
  })
  owned.add(() => root.removeFromParent())
  return {
    root,
    setShot(sequence) {
      const random = shotRandom(sequence)
      for (const [index, card] of cards.entries()) {
        const tilt = index === 0
          ? 0
          : Math.PI / 3
        card.rotation.set(0, tilt, random() * Math.PI * 2)
        card.scale.set(0.09 + random() * 0.07, 0.13 + random() * 0.09, 1)
        card.position.z = -index * 0.025
      }
    },
    setStrength(value) {
      strength.value = Math.max(0, Math.min(1, value))
      root.visible = strength.value > 0
    },
    dispose() {
      root.visible = false
      owned.dispose()
    },
  }
}
