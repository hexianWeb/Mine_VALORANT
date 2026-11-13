import * as THREE from 'three/webgpu'

export { weaponMaterialProfiles } from '../src/game/weapons/assets/weapon-materials.js'

function check(value, message) {
  if (!value)
    throw new Error(message)
}

/** Real weapon HDR readbacks: each lighting source must contribute without moving its silhouette. */
export async function checkWeaponLighting(app) {
  const { render, scene, camera } = app
  const layer = render.viewmodel
  const settings = render.getDebugState()
  const position = camera.position.clone()
  const quaternion = camera.quaternion.clone()
  const environmentIntensity = scene.environmentIntensity
  const lights = []
  scene.traverseVisible((object) => {
    if (object.isLight)
      lights.push({ light: object, intensity: object.intensity })
  })
  const candidates = []
  const width = render.renderer.domElement.width
  const height = render.renderer.domElement.height
  for (let y = 0.55; y < 0.96; y += 0.06) {
    for (let x = 0.45; x < 0.96; x += 0.05) {
      candidates.push([
        Math.floor(x * width),
        Math.floor(y * height),
      ])
    }
  }
  // Use the rendered mask, not cached CPU bounds from a different skinned animation pose.
  await new Promise(requestAnimationFrame)
  render.update()
  const mask = await Promise.all(candidates.map(([x, y]) => render.readViewModelPixel(x, y)))
  const points = candidates.filter((_, index) => mask[index][3] > 0.99)
  check(points.length >= 6, 'Not enough visible weapon surfaces for HDR samples')
  const sample = async () => {
    await new Promise(requestAnimationFrame)
    render.update()
    return Promise.all(points.map(([x, y]) => render.readViewModelPixel(x, y)))
  }
  const delta = (a, b) => Math.max(...a.flatMap((pixel, i) => pixel.slice(0, 3).map((value, channel) => Math.abs(value - b[i][channel]))))
  const select = (enabled) => {
    for (const { light, intensity } of lights) {
      light.intensity = enabled(light)
        ? intensity
        : 0
    }
  }
  try {
    const full = await sample()
    select(() => false)
    scene.environmentIntensity = 0
    const fill = await sample()
    select(light => !light.isLightProbeGrid && !light.isLightProbe)
    const direct = await sample()
    select(light => light.isLightProbeGrid || light.isLightProbe)
    const probes = await sample()
    select(() => false)
    scene.environmentIntensity = environmentIntensity
    const environment = await sample()
    select(() => true)
    const restored = await sample()
    render.setEffects({ aoStrength: 0 })
    const noWorldAO = await sample()
    render.setEffects({ aoStrength: 5 })
    const strongWorldAO = await sample()
    render.setEffects({ aoStrength: settings.aoStrength })
    camera.rotateY(Math.PI / 2)
    const turned = await sample()
    camera.quaternion.copy(quaternion)
    camera.position.add(new THREE.Vector3(4, 0, 8))
    const moved = await sample()
    const result = {
      samples: points.length,
      probeGrids: lights.filter(({ light }) => light.isLightProbeGrid).length,
      directDelta: delta(direct, fill),
      probeDelta: delta(probes, fill),
      environmentDelta: delta(environment, fill),
      restoreDelta: delta(full, restored),
      worldAODelta: delta(noWorldAO, strongWorldAO),
      turnDelta: delta(full, turned),
      moveDelta: delta(full, moved),
      silhouetteDelta: Math.max(...full.map((pixel, i) => Math.max(Math.abs(pixel[3] - turned[i][3]), Math.abs(pixel[3] - moved[i][3])))),
      borrowedEnvironment: layer.scene.environment === scene.environment,
    }
    check(result.directDelta > 0.001, 'Room lighting does not affect the weapon')
    check(result.probeGrids > 0 && result.probeDelta > 0.001, 'Room probes do not affect the weapon')
    check(result.environmentDelta > 0.001, 'Room environment does not affect the weapon')
    check(result.restoreDelta < 0.0001, 'Restoring room lighting changed the weapon pose or materials')
    check(result.worldAODelta < 0.0001, 'World AO leaked into the independent weapon pass')
    check(result.turnDelta > 0.001 && result.moveDelta > 0.001, 'Weapon lighting does not follow world pose')
    check(result.silhouetteDelta < 0.001, 'World camera motion moved the camera-local weapon silhouette')
    check(result.borrowedEnvironment, 'Viewmodel environment is not shared with the world')
    return result
  }
  finally {
    select(() => true)
    scene.environmentIntensity = environmentIntensity
    camera.position.copy(position)
    camera.quaternion.copy(quaternion)
    render.setEffects({ aoStrength: settings.aoStrength })
    await new Promise(requestAnimationFrame)
    render.update()
  }
}
