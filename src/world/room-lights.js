import { RectAreaLightTexturesLib } from 'three/addons/lights/RectAreaLightTexturesLib.js'
import * as THREE from 'three/webgpu'

let ltcInitialized = false

/** Three measured strip lights. No implicit GLB lights or second full-strength shadow rig. */
export function createRoomLights(manifest, options = {}) {
  if (!ltcInitialized) {
    THREE.RectAreaLightNode.setLTC(RectAreaLightTexturesLib.init())
    ltcInitialized = true
  }
  const root = new THREE.Group()
  root.name = 'Room runtime lighting (unbaked + localized corridor receivers)'
  for (const source of manifest.lights) {
    const light = new THREE.RectAreaLight(new THREE.Color().setRGB(...source.color, THREE.LinearSRGBColorSpace), source.intensity, source.width, source.height)
    light.name = source.id
    light.position.fromArray(source.position)
    // Maps local +X across the narrow strip and local +Y along room -Z.
    // Local -Z then points down (-Y), preserving both normal AND long-axis roll.
    light.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(0, 1, 0),
    ))
    light.userData.sourcePowerWatts = source.sourcePowerWatts
    light.userData.shadowLimitation = 'RectAreaLight has no shadow or Blender Spread support'
    root.add(light)
  }
  const ambient = new THREE.AmbientLight(new THREE.Color().setRGB(...manifest.environment.color, THREE.LinearSRGBColorSpace), options.environmentLoaded ? 0 : manifest.environment.intensity)
  ambient.name = 'Controlled room indirect approximation (not GI)'
  root.add(ambient)
  const points = []
  const bounds = {
    min: [-24, 7.5, -20],
    max: [24, 15, -7.5],
    fade: 1,
  }
  if (options.corridorLighting) {
    // Blender ray checks: rear passage roof at z=14–14.5, floor z=8–9.
    const positions = [
      [-10, 13.6, -10],
      [0, 14.1, -13],
      [10, 13.6, -10],
    ]
    for (const [index, position] of positions.entries()) {
      const light = new THREE.PointLight(new THREE.Color().setRGB(1, 0.88, 0.72, THREE.LinearSRGBColorSpace), 55, 9, 2)
      light.name = `走廊顶棚补光 ${index + 1}`
      light.position.fromArray(position)
      light.userData.role = 'corridor-fill'
      root.add(light)
      points.push(light)
    }
  }
  const originalIntensities = new Map(root.children.map(light => [light, light.intensity]))
  let enabled = true
  let corridorEnabled = true
  const apply = () => {
    root.visible = enabled
    for (const [light, intensity] of originalIntensities) {
      light.intensity = enabled && (!points.includes(light) || corridorEnabled)
        ? intensity
        : 0
    }
  }
  return {
    root,
    corridor: { points, bounds },
    setEnabled(value) {
      enabled = value
      apply()
    },
    setCorridorEnabled(value) {
      corridorEnabled = value
      apply()
    },
    dispose() {
      root.removeFromParent()
      root.traverse(object => object.isLight && object.dispose?.())
      root.clear()
    },
  }
}
