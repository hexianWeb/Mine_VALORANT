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
  root.name = 'Room runtime lighting (unbaked receivers)'
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
  const originalIntensities = new Map(root.children.map(light => [light, light.intensity]))
  let enabled = true
  let scale = 1
  const apply = () => {
    root.visible = enabled
    for (const [light, intensity] of originalIntensities) {
      light.intensity = enabled
        ? intensity * scale
        : 0
    }
  }
  return {
    root,
    setEnabled(value) {
      enabled = !!value
      apply()
    },
    setIntensityScale(value) {
      if (!Number.isFinite(value) || value < 0 || value > 4)
        throw new Error('[Room lights] Invalid intensity scale')
      scale = value
      apply()
    },
    dispose() {
      root.removeFromParent()
      root.traverse(object => object.isLight && object.dispose?.())
      root.clear()
    },
  }
}
