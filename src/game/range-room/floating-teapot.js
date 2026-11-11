import { TeapotGeometry } from 'three/addons/geometries/TeapotGeometry.js'
import * as THREE from 'three/webgpu'
import { GameObject, MeshComponent, MotorComponent, TransformComponent } from '../../engine/runtime/function/framework/index.js'

/** Teapot-specific orbit, float and spin are one plain motion function. */
function updateTeapotMotion({ elapsed, state }) {
  const { center, radius, orbitPeriod, floatAmplitude, floatPeriod } = state
  const angle = elapsed * Math.PI * 2 / orbitPeriod
  const entry = THREE.MathUtils.smoothstep(elapsed, 0, 4)
  return {
    position: new THREE.Vector3(
      center.x + Math.sin(angle) * radius.x * entry,
      center.y + Math.sin(elapsed * Math.PI * 2 / floatPeriod) * floatAmplitude,
      center.z + Math.cos(angle) * radius.y * entry,
    ),
    quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(
      Math.sin(elapsed * 0.7) * 0.07,
      elapsed * 0.55,
      Math.sin(elapsed * 0.9) * 0.09,
    )),
  }
}

/** Assemble shared capabilities; Level owns attachment and all updates. */
export function createFloatingTeapot({
  scene,
  center = new THREE.Vector3(),
  radius = new THREE.Vector2(6.5, 4.5),
  size = 0.85,
  orbitPeriod = 32,
  floatAmplitude = 0.55,
  floatPeriod = 4.5,
} = {}) {
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
  const object = new GameObject({ name: 'Floating teapot' })
  object.addComponent(new TransformComponent({ position: center }))
  object.addComponent(new MeshComponent({
    root: mesh,
    scene,
    release() {
      geometry.dispose()
      material.dispose()
    },
  }))
  object.addComponent(new MotorComponent({
    clock: 'frame',
    motion: updateTeapotMotion,
    state: {
      center: center.clone(),
      radius: radius.clone(),
      orbitPeriod,
      floatAmplitude,
      floatPeriod,
    },
  }))
  return object
}
