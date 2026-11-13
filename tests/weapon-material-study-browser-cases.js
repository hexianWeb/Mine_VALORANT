import { context, cubeTexture, vec3 } from 'three/tsl'
import * as THREE from 'three/webgpu'
import { reflectionCubeFromBytes, roomReflectionDefinition } from '../src/game/range-room/lighting/reflection-data.js'

function check(value, message) {
  if (!value)
    throw new Error(message)
}
const delta = (a, b) => Math.max(...a.flatMap((pixel, i) => pixel.slice(0, 3).map((n, c) => Math.abs(n - b[i][c]))))

/** Check saved layer directions on the real backend before any PMREM filtering. */
export async function checkReflectionDirections(app) {
  const manifestURL = '/lighting/range-room-reflections/v1/manifest.json'
  const manifest = await (await fetch(manifestURL)).json()
  const bytes = await (await fetch(new URL(manifest.url, new URL(manifestURL, location.href)))).arrayBuffer()
  const cube = reflectionCubeFromBytes(bytes)
  const renderer = app.render.renderer
  const old = { toneMapping: renderer.toneMapping, outputColorSpace: renderer.outputColorSpace, contextNode: renderer.contextNode }
  const oldTarget = renderer.getRenderTarget()
  const oldMRT = renderer.getMRT()
  const target = new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false })
  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1)
  const geometry = new THREE.PlaneGeometry(2, 2)
  const mesh = new THREE.Mesh(geometry)
  mesh.position.z = -0.5
  scene.add(mesh)
  const materials = []
  const samples = []
  const directions = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ]
  const faces = [1, 0, 2, 3, 4, 5] // CubeCamera's WebGPU X cameras follow the native cube convention.
  try {
    renderer.toneMapping = THREE.NoToneMapping
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace
    renderer.contextNode = context({
      getAO: () => null,
    })
    renderer.setMRT(null)
    for (const [i, direction] of directions.entries()) {
      const material = new THREE.MeshBasicNodeMaterial()
      materials.push(material)
      material.colorNode = cubeTexture(cube, vec3(...direction)).rgb
      mesh.material = material
      renderer.setRenderTarget(target)
      renderer.render(scene, camera)
      const actual = Array.from(await renderer.readRenderTargetPixelsAsync(target, 0, 0, 1, 1), THREE.DataUtils.fromHalfFloat).slice(0, 3)
      const data = cube.images[faces[i]].image.data
      const size = roomReflectionDefinition.size
      const expected = [0, 1, 2].map((channel) => {
        let total = 0
        for (const y of [size / 2 - 1, size / 2]) {
          for (const x of [size / 2 - 1, size / 2]) total += THREE.DataUtils.fromHalfFloat(data[(y * size + x) * 4 + channel])
        }
        return total / 4
      })
      check(delta([actual], [expected]) < 0.002, `HDR cube direction mismatch: ${direction}`)
      samples.push({ direction, actual, expected })
    }
    return samples
  }
  finally {
    Object.assign(renderer, old)
    renderer.setMRT(oldMRT)
    renderer.setRenderTarget(oldTarget)
    for (const material of materials) material.dispose()
    geometry.dispose()
    target.dispose()
    cube.dispose()
    for (const face of cube.images) face.dispose()
  }
}

/** Hold one skinned pose, isolate the gun HDR mask, then switch lighting sources in place. */
export async function checkWeaponMaterialStudy(app) {
  const { render, scene, camera, world } = app
  const study = world.weaponStudy
  check(study?.getDebugState().reflection.ready, 'Static indoor reflection is not loaded')
  const arms = []
  const weapons = new Set()
  render.viewmodel.scene.traverse((object) => {
    if (object.material?.name?.startsWith('Character_')) {
      arms.push({
        object,
        visible: object.visible,
        material: object.material.toJSON(),
      })
    }
    if (object.material?.name === 'Weapon_Skin')
      weapons.add(object.material)
  })
  const effects = render.getDebugState()
  const settings = study.getDebugState()
  const lights = []
  scene.traverseVisible((object) => {
    if (object.isLight)
      lights.push({ object, intensity: object.intensity })
  })
  const position = camera.position.clone()
  const quaternion = camera.quaternion.clone()
  const width = render.renderer.domElement.width
  const height = render.renderer.domElement.height
  try {
    for (const { object } of arms) object.visible = false
    render.update()
    const points = []
    for (let y = 0.54; y < 0.82; y += 0.035) {
      for (let x = 0.58; x < 0.79; x += 0.035) {
        const point = [
          Math.floor(x * width),
          Math.floor(y * height),
        ]
        if ((await render.readViewModelPixel(...point))[3] > 0.99)
          points.push(point)
      }
    }
    check(points.length >= 6, 'Too few gun HDR samples')
    const sample = async () => {
      // Analytic light uniforms are frame-updated, not refreshed by GPU readback alone.
      await new Promise(requestAnimationFrame)
      render.update()
      return Promise.all(points.map(point => render.readViewModelPixel(...point)))
    }
    const indoorFull = await sample()
    for (const material of weapons) {
      check(material.flatShading && material.metalness === 1, 'Flat/metal profile missing')
      check(material.emissiveIntensity === 0.4 && material.emissiveMap !== null, 'Gun color-map emission missing')
    }
    for (const { object } of lights) object.intensity = 0
    render.setEffects({ viewmodelLightIntensity: 0 })
    const indoorOnly = await sample()
    study.setLighting({ source: 'off' })
    const dark = await sample()
    study.setLighting({ source: 'sky' })
    const skyOnly = await sample()
    study.setLighting({ source: 'indoor' })
    const restored = await sample()
    check(delta(indoorOnly, dark) > 0.001, 'Indoor mirror lighting does not reach the gun')
    check(delta(indoorOnly, skyOnly) > 0.001, 'Indoor and sky reflections are indistinguishable')
    check(delta(indoorOnly, restored) < 0.0001, `Reflection restore mismatch ${delta(indoorOnly, restored)}`)
    render.setEffects({ aoStrength: 5 })
    const ao = await sample()
    check(delta(restored, ao) < 0.0001, 'World AO leaked into the gun')
    camera.rotateY(Math.PI / 2)
    const turned = await sample()
    check(delta(restored, turned) > 0.001, 'Indoor reflection does not follow the world-space view direction')
    check(Math.max(...restored.map((p, i) => Math.abs(p[3] - turned[i][3]))) < 0.001, 'Turning moved the camera-local silhouette')
    camera.quaternion.copy(quaternion)
    await sample()
    const versions = [...weapons].map(material => material.version)
    for (let i = 0; i < 20; i++) render.update()
    check([...weapons].every((material, i) => material.version === versions[i]), 'Per-frame material compilation invalidation')
    for (const arm of arms) check(JSON.stringify(arm.material) === JSON.stringify(arm.object.material.toJSON()), 'Study changed an arm material')
    return {
      samples: points.length,
      indoorDelta: delta(indoorOnly, dark),
      skyDelta: delta(indoorOnly, skyOnly),
      emissionFloor: Math.max(...dark.flatMap(pixel => pixel.slice(0, 3))),
      directDelta: delta(indoorFull, indoorOnly),
      turnDelta: delta(restored, turned),
      worldAODelta: delta(restored, ao),
      restoredDelta: delta(indoorOnly, restored),
      materialVersionsStable: true,
    }
  }
  finally {
    camera.position.copy(position)
    camera.quaternion.copy(quaternion)
    for (const { object, intensity } of lights) object.intensity = intensity
    for (const { object, visible } of arms) object.visible = visible
    render.setEffects({ viewmodelLightIntensity: effects.viewmodelLightIntensity, aoStrength: effects.aoStrength })
    study.setLighting({
      source: settings.source,
      enabled: settings.enabled,
      roughness: settings.roughness,
      flatShading: settings.flatShading,
      intensity: settings.intensity,
    })
    render.update()
  }
}
