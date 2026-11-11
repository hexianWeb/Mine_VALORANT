import { Fn, mix, output, shadow, uniform, vec4 } from 'three/tsl'
import * as THREE from 'three/webgpu'

/** Reversible shadow rig. Receives roots/positions, with no dependency on room loading. */
export function createRoomShadows({ scene, renderer, roots, position, target, mapSize = 2048 }) {
  const previousRenderer = { enabled: renderer.shadowMap.enabled, type: renderer.shadowMap.type }
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap

  // RectAreaLight cannot cast shadows. This interior key supplies one shared map
  // for PBR props and shadow-only modulation of the baked receivers.
  const light = new THREE.SpotLight(0xFFF1DD, 180, 65, Math.PI * 0.43, 0.4, 2)
  light.name = 'Interior inspection shadow key'
  light.position.copy(position)
  light.target.position.copy(target)
  light.castShadow = true
  light.shadow.mapSize.setScalar(mapSize)
  light.shadow.camera.near = 0.2
  light.shadow.camera.far = 65
  light.shadow.bias = -0.00015
  light.shadow.normalBias = 0.035
  light.shadow.intensity = 1
  light.shadow.radius = 2
  const visibility = shadow(light)
  // Reuse the exact same ShadowNode in regular lighting and custom baked output.
  light.shadow.shadowNode = visibility
  scene.add(light, light.target)

  const bakedStrength = uniform(0.65)
  const replacements = new Map()
  const originals = new Map()
  let enabled = true
  let disposed = false
  const withBakedShadow = (source) => {
    if (!['lightmap', 'baked-appearance'].includes(source.userData.roomMode))
      return source
    if (!replacements.has(source)) {
      const material = source.clone()
      if (source.colorNode) {
        // Opaque baked receivers need no albedo in the depth pass. In particular,
        // pixel-art materialReference('color') must not read the colorless override.
        material.colorNode = Fn((_, builder) => {
          return builder.material.isShadowPassMaterial
            ? vec4(1)
            : source.colorNode
        })()
      }
      const base = source.outputNode ?? output
      // Keep baked irradiance/albedo and GTAO intact; add only a visibility mask.
      material.outputNode = vec4(base.rgb.mul(mix(1, visibility, bakedStrength)), base.a)
      material.name = `${source.name}:dynamic-shadow`
      replacements.set(source, material)
    }
    return replacements.get(source)
  }
  for (const root of roots) {
    root.traverse((object) => {
      if (!object.isMesh || originals.has(object))
        return
      originals.set(object, { material: object.material, castShadow: object.castShadow, receiveShadow: object.receiveShadow })
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material]
      const fixture = materials.every(material => material.userData.roomMode === 'fixture-emissive')
      object.castShadow = !fixture
      object.receiveShadow = !fixture
      object.material = Array.isArray(object.material)
        ? materials.map(withBakedShadow)
        : withBakedShadow(object.material)
    })
  }

  return {
    light,
    get enabled() { return enabled },
    setEnabled(value) {
      enabled = !!value
      // Uniform changes allow a clean lit/shadow comparison without rebuilding shaders.
      light.shadow.intensity = enabled ? 1 : 0
      bakedStrength.value = enabled ? 0.65 : 0
    },
    snapshot() {
      return {
        enabled,
        mapSize: light.shadow.mapSize.toArray(),
        mapReady: !!light.shadow.map,
        casters: Array.from(originals.keys()).filter(mesh => mesh.castShadow).length,
        receivers: Array.from(originals.keys()).filter(mesh => mesh.receiveShadow).length,
        bakedMaterials: replacements.size,
      }
    },
    dispose() {
      if (disposed)
        return
      disposed = true
      for (const [object, original] of originals)
        Object.assign(object, original)
      for (const material of replacements.values())
        material.dispose()
      originals.clear()
      replacements.clear()
      light.removeFromParent()
      light.target.removeFromParent()
      visibility.dispose()
      light.dispose()
      Object.assign(renderer.shadowMap, previousRenderer)
    },
  }
}
