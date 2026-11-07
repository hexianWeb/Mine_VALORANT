import { TeapotGeometry } from 'three/addons/geometries/TeapotGeometry.js'
import * as THREE from 'three/webgpu'

/** Self-contained, delta-driven prop; the caller owns scheduling and scene attachment. */
export function createFloatingTeapot({
  center = new THREE.Vector3(),
  radius = new THREE.Vector2(6.5, 4.5),
  size = 0.85,
  orbitPeriod = 32,
  floatAmplitude = 0.55,
  floatPeriod = 4.5,
} = {}) {
  const origin = center.clone()
  const geometry = new TeapotGeometry(size, 16)
  const material = new THREE.MeshPhysicalNodeMaterial({
    color: 0xD98739,
    metalness: 0.28,
    roughness: 0.23,
    clearcoat: 1,
    clearcoatRoughness: 0.16,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(geometry, material)
  material.userData.roomMode = 'realtime'
  mesh.name = 'Floating inspection teapot'
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.position.copy(origin)
  let elapsed = 0
  let paused = false
  let disposed = false

  return {
    mesh,
    get paused() { return paused },
    setPaused(value) { paused = !!value },
    update(delta) {
      if (paused || disposed)
        return
      elapsed += Math.max(0, delta)
      const angle = elapsed * Math.PI * 2 / orbitPeriod
      // Start at the exact room center, then smoothly enter the interior ellipse.
      const entry = THREE.MathUtils.smoothstep(elapsed, 0, 4)
      mesh.position.set(
        origin.x + Math.sin(angle) * radius.x * entry,
        origin.y + Math.sin(elapsed * Math.PI * 2 / floatPeriod) * floatAmplitude,
        origin.z + Math.cos(angle) * radius.y * entry,
      )
      mesh.rotation.set(
        Math.sin(elapsed * 0.7) * 0.07,
        elapsed * 0.55,
        Math.sin(elapsed * 0.9) * 0.09,
      )
    },
    snapshot() {
      return {
        paused,
        elapsed,
        center: origin.toArray(),
        position: mesh.position.toArray(),
        radius: radius.toArray(),
        orbitPeriod,
      }
    },
    dispose() {
      if (disposed)
        return
      disposed = true
      mesh.removeFromParent()
      geometry.dispose()
      material.dispose()
    },
  }
}
