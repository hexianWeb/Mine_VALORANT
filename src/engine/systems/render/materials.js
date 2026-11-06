import { materialColor, positionWorld, lights as selectiveLights, smoothstep, texture, uv } from 'three/tsl'
import * as THREE from 'three/webgpu'

/** Replacement materials are instance-owned; source maps and geometry remain ResourceManager-owned. */
export function createRoomMaterial(source, binding, atlases, corridor = null) {
  let material
  if (binding.mode === 'baked-appearance') {
    const atlas = atlases.get(binding.atlasId)
    if (!atlas)
      throw new Error(`[Room materials] Missing atlas ${binding.atlasId}`)
    // glTF exports V-flipped mesh UVs; EXRLoader's typed scanlines retain the
    // opposite image origin. Normalize once here, keeping texture.flipY=false.
    const bakedColor = texture(atlas, uv(binding.uvChannel).flipY()).rgb
    if (corridor?.points.length) {
      // Only the NEW corridor lights may add direct light to baked radiance.
      // lights=false skips scene environment/AO/original ceiling lights.
      material = new THREE.MeshLambertNodeMaterial()
      material.lights = false
      material.lightsNode = selectiveLights(corridor.points)
      material.emissiveNode = bakedColor
      material.color.copy(source.color)
      material.map = source.map
      const { min, max, fade } = corridor.bounds
      let mask = smoothstep(min[0], min[0] + fade, positionWorld.x).mul(smoothstep(max[0] - fade, max[0], positionWorld.x).oneMinus())
      mask = mask.mul(smoothstep(min[1], min[1] + fade, positionWorld.y)).mul(smoothstep(max[1] - fade, max[1], positionWorld.y).oneMinus())
      mask = mask.mul(smoothstep(min[2], min[2] + fade, positionWorld.z)).mul(smoothstep(max[2] - fade, max[2], positionWorld.z).oneMinus())
      material.colorNode = materialColor.rgb.mul(mask)
      material.userData.corridorLightOnly = true
    }
    else {
      material = new THREE.MeshBasicNodeMaterial()
      material.lights = false
      material.colorNode = bakedColor
    }
    material.side = source.side
    // These atlas receivers are opaque baked walls, even when an old GLB
    // incorrectly tagged the source material as BLEND/depthWrite=false.
    material.transparent = false
    material.depthWrite = true
    material.toneMapped = true
  }
  else if (binding.mode === 'fixture-emissive') {
    material = new THREE.MeshBasicNodeMaterial()
    material.lights = false
    material.color.setRGB(...binding.emissionColor, THREE.LinearSRGBColorSpace)
    material.color.multiplyScalar(binding.emissionStrength)
    material.side = THREE.DoubleSide
  }
  else {
    material = source.isMeshPhysicalMaterial
      ? new THREE.MeshPhysicalNodeMaterial()
      : new THREE.MeshStandardNodeMaterial()
    // Same conversion principle as WebGPURenderer's NodeLibrary, but clone mutable values
    // and retain the new material's identity and node defaults.
    const cloned = source.clone()
    for (const key of Object.keys(cloned)) {
      if (['uuid', 'type', 'version'].includes(key) || key.startsWith('is'))
        continue
      material[key] = cloned[key]
    }
    material.lightMap = null
    material.aoMap = null
    material.userData = { ...source.userData }
  }
  material.name = `${binding.mode}:${binding.sourceMaterial}`
  material.userData.roomMode = binding.mode
  material.userData.atlasId = binding.atlasId ?? null
  return material
}
