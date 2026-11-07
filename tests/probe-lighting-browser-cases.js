import { LightProbeGrid } from 'three/addons/lighting/LightProbeGrid.js'
import * as THREE from 'three/webgpu'
import { atlasLayout, uploadProbeAtlas } from '../src/world/probe-data.js'
import { createProbeEnvironment } from '../src/world/probe-environment.js'

function check(value, message) {
  if (!value)
    throw new Error(message)
}

/** GPU energy checks: split IBL must preserve metallic/coat reflections and probe diffuse. */
export async function checkProbeEnvironment() {
  const renderer = new THREE.WebGPURenderer({
    canvas: new OffscreenCanvas(32, 32),
    antialias: false,
  })
  await renderer.init()
  renderer.setSize(32, 32, false)
  const scene = new THREE.Scene()
  const sky = new THREE.DataTexture(new Float32Array(16 * 8 * 4).fill(0.5), 16, 8, THREE.RGBAFormat, THREE.FloatType)
  sky.mapping = THREE.EquirectangularReflectionMapping
  sky.needsUpdate = true
  scene.environment = sky
  const material = new THREE.MeshPhysicalNodeMaterial({ color: 0xFFFFFF, roughness: 0.4 })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
  scene.add(mesh)
  const environment = createProbeEnvironment()
  environment.bindRoot(mesh)
  const grid = new LightProbeGrid(10, 10, 10, 2, 2, 2)
  const layout = atlasLayout([2, 2, 2])
  const data = new Uint16Array(layout.bytes / 2)
  // Constant RGB SH l=0. No directional/position variation in this fixture.
  for (let i = 0; i < 2 * 2 * 4 * 4; i += 4)
    data.set([0, 1, 2].map(() => THREE.DataUtils.toHalfFloat(0.4)), i)
  uploadProbeAtlas(renderer, grid, data)
  scene.add(grid)
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20)
  camera.position.z = 4
  const target = new THREE.RenderTarget(32, 32, { type: THREE.HalfFloatType })
  const render = async (diffuse, specular, probe, metalness, coat = 0) => {
    environment.update(diffuse, specular)
    grid.intensity = probe
    material.metalness = metalness
    material.clearcoat = coat
    await new Promise(requestAnimationFrame)
    renderer.setRenderTarget(target)
    renderer.render(scene, camera)
    const value = await renderer.readRenderTargetPixelsAsync(target, 16, 16, 1, 1)
    return Array.from(value, THREE.DataUtils.fromHalfFloat).slice(0, 3)
  }
  try {
    const dielectric = await render(1, 0, 0, 0)
    const dielectricOff = await render(0, 0, 0, 0)
    const probe = await render(0, 0, 1, 0)
    const metal = await render(1, 1, 0, 1)
    const metalNoSkyDiffuse = await render(0, 1, 0, 1)
    const metalOff = await render(1, 0, 0, 1)
    const coated = await render(0, 1, 0, 0, 1)
    const coatedOff = await render(0, 0, 0, 0, 1)
    check(dielectric[0] > 0.05 && dielectricOff[0] < 0.001, `Sky diffuse control failed: ${JSON.stringify({ dielectric, dielectricOff })}`)
    check(probe[0] > 0.05, 'Sky diffuse slider also removed the probe irradiance')
    check(metal[0] > 0.05 && Math.abs(metal[0] - metalNoSkyDiffuse[0]) < 0.001, 'Sky diffuse changed metallic reflection')
    check(metalOff[0] < 0.001 && coated[0] > 0.01 && coatedOff[0] < 0.001, 'Specular slider failed to isolate metal/clearcoat IBL')
    return {
      dielectric,
      dielectricOff,
      probe,
      metal,
      metalNoSkyDiffuse,
      metalOff,
      coated,
      coatedOff,
    }
  }
  finally {
    renderer.setRenderTarget(null)
    environment.dispose()
    mesh.geometry.dispose()
    material.dispose()
    grid.dispose()
    sky.dispose()
    target.dispose()
    renderer.dispose()
  }
}
