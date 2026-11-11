import { mix, positionLocal, uniform } from 'three/tsl'
import * as THREE from 'three/webgpu'

export function createNodeMaterial({ colorTop, colorBottom, metalness, roughness }) {
  const uniforms = {
    colorTop: uniform(new THREE.Color(colorTop)),
    colorBottom: uniform(new THREE.Color(colorBottom)),
    metalness: uniform(metalness),
    roughness: uniform(roughness),
  }

  const gradient = positionLocal.y.mul(0.5).add(0.5).clamp(0, 1)
  const material = new THREE.MeshStandardNodeMaterial()
  material.colorNode = mix(uniforms.colorBottom, uniforms.colorTop, gradient)
  material.metalnessNode = uniforms.metalness
  material.roughnessNode = uniforms.roughness

  return { material, uniforms }
}
