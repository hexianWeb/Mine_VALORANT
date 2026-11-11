import { lights as selectiveLights, texture, uv } from 'three/tsl'
import * as THREE from 'three/webgpu'

/** Replacement materials are instance-owned; source maps and geometry remain ResourceManager-owned. */
export function createRoomMaterial(source, binding, atlases) {
  let material
  if (binding.mode === 'lightmap') {
    const atlas = atlases.get(binding.atlasId)
    if (!atlas)
      throw new Error(`[Room materials] Missing lightmap ${binding.atlasId}`)
    // These receivers were authored as diffuse-only (specular level = 0).
    // Lambert keeps the baked unit-albedo response without a second PBR energy loss.
    material = new THREE.MeshLambertNodeMaterial()
    material.color.copy(source.color)
    material.map = source.map
    material.normalMap = source.normalMap
    if (source.normalScale)
      material.normalScale.copy(source.normalScale)
    material.side = source.side
    material.lightMap = atlas
    material.lightMapIntensity = binding.lightMapIntensity
    // lights=true retains built-in lightMap and GTAO; the explicit list excludes
    // original lights already baked into the map. Lambert has no scene IBL diffuse.
    material.lightsNode = selectiveLights([])
    material.transparent = false
    material.depthWrite = true
    material.toneMapped = true
    material.userData.staticLightingBaked = true
  }
  else if (binding.mode === 'baked-appearance') {
    const atlas = atlases.get(binding.atlasId)
    if (!atlas)
      throw new Error(`[Room materials] Missing atlas ${binding.atlasId}`)
    // glTF exports V-flipped mesh UVs; EXRLoader's typed scanlines retain the
    // opposite image origin. Normalize once here, keeping texture.flipY=false.
    const bakedColor = texture(atlas, uv(binding.uvChannel).flipY()).rgb
    material = new THREE.MeshBasicNodeMaterial()
    material.lights = false
    material.colorNode = bakedColor
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
