import { builtinAOContext, pass, uniform } from 'three/tsl'
import * as THREE from 'three/webgpu'
import { createRoomMaterial } from '../src/world/materials.js'
import { createTextureSampling } from '../src/world/texture-sampling.js'

/** Verify actual shader energy, independent UV1 + EXR V flip, AO and light isolation. */
export async function checkLightmapMaterial() {
  const renderer = new THREE.WebGPURenderer({
    canvas: new OffscreenCanvas(32, 32),
    antialias: false,
  })
  await renderer.init()
  renderer.setSize(32, 32, false)
  const atlas = new THREE.DataTexture(new Float32Array([
    [1, 0.2, 0.1, 1],
    [0.1, 1, 0.2, 1],
    [0.2, 0.1, 1, 1],
    [0.8, 0.6, 0.4, 1],
  ].flat()), 2, 2, THREE.RGBAFormat, THREE.FloatType)
  atlas.channel = 1
  atlas.repeat.y = -1
  atlas.offset.y = 1
  atlas.updateMatrix()
  atlas.needsUpdate = true
  const source = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.5, 0.25, 0.75),
  })
  const material = createRoomMaterial(source, {
    mode: 'lightmap',
    sourceMaterial: 'fixture',
    atlasId: 'test',
    uvChannel: 1,
    lightMapIntensity: Math.PI,
  }, new Map([
    ['test', atlas],
  ]))
  const geometry = new THREE.PlaneGeometry(2, 2)
  geometry.setAttribute('uv1', geometry.getAttribute('uv').clone())
  // Destroy UV0 deliberately: the lighting texture must exclusively use BakeUV/UV1.
  geometry.getAttribute('uv').array.fill(0.1)
  const scene = new THREE.Scene()
  scene.add(new THREE.Mesh(geometry, material))
  const light = new THREE.DirectionalLight(0xFF0000, 100)
  scene.add(light, new THREE.AmbientLight(0xFFFFFF, 100))
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10)
  camera.position.z = 2
  const occlusion = uniform(1)
  const scenePass = pass(scene, camera)
  scenePass.contextNode = builtinAOContext(occlusion)
  const pipeline = new THREE.RenderPipeline(renderer)
  pipeline.outputNode = scenePass
  pipeline.outputColorTransform = false
  const sample = async (ao) => {
    occlusion.value = ao
    await new Promise(requestAnimationFrame)
    pipeline.render()
    const pixels = []
    const points = [
      [8, 8],
      [24, 8],
      [8, 24],
      [24, 24],
    ]
    for (const [x, y] of points) {
      const data = await renderer.readRenderTargetPixelsAsync(scenePass.renderTarget, x, y, 1, 1)
      pixels.push(Array.from(data, THREE.DataUtils.fromHalfFloat).slice(0, 3))
    }
    return pixels
  }
  try {
    const unoccluded = await sample(1)
    const expected = [
      [0.5, 0.05, 0.075],
      [0.05, 0.25, 0.15],
      [0.1, 0.025, 0.75],
      [0.4, 0.15, 0.3],
    ]
    const maxError = (a, b) => Math.max(...a.flatMap((pixel, i) => pixel.map((value, c) => Math.abs(value - b[i][c]))))
    if (maxError(unoccluded, expected) > 0.002)
      throw new Error(`Lightmap UV/irradiance/light isolation mismatch: ${JSON.stringify(unoccluded)}`)
    const occluded = await sample(0.25)
    if (maxError(occluded, expected.map(pixel => pixel.map(value => value * 0.25))) > 0.002)
      throw new Error('Built-in AO must modulate the diffuse lightmap')
    return {
      unoccluded,
      expected,
      occluded,
      irradianceScale: Math.PI,
      sceneLightLeak: false,
      uv1AndFlipY: true,
      aoRatio: 0.25,
    }
  }
  finally {
    pipeline.dispose()
    scenePass.dispose()
    material.dispose()
    source.dispose()
    geometry.dispose()
    atlas.dispose()
    renderer.dispose()
  }
}

/** Magnified texels must match nearest; subpixel checkerboards must converge to their mean. */
export async function checkPixelArtMinification() {
  const renderer = new THREE.WebGPURenderer({
    canvas: new OffscreenCanvas(64, 64),
    antialias: false,
  })
  await renderer.init()
  renderer.setSize(64, 64, false)
  const canvas = new OffscreenCanvas(64, 64)
  const context = canvas.getContext('2d')
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      context.fillStyle = (x + y) % 2
        ? '#fff'
        : '#000'
      context.fillRect(x, y, 1, 1)
    }
  }
  const map = new THREE.CanvasTexture(canvas)
  map.colorSpace = THREE.SRGBColorSpace
  map.wrapS = map.wrapT = THREE.RepeatWrapping
  const source = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.8, 0.4, 0.2),
    map,
  })
  const atlas = new THREE.DataTexture(new Float32Array([1, 1, 1, 1]), 1, 1, THREE.RGBAFormat, THREE.FloatType)
  atlas.needsUpdate = true
  const material = createRoomMaterial(source, {
    mode: 'lightmap',
    sourceMaterial: 'minification-fixture',
    atlasId: 'test',
    uvChannel: 1,
    lightMapIntensity: Math.PI,
  }, new Map([
    ['test', atlas],
  ]))
  const samplers = createTextureSampling()
  samplers.material(material)
  const filteredNode = material.colorNode
  const geometry = new THREE.PlaneGeometry(2, 2)
  const scene = new THREE.Scene()
  scene.add(new THREE.Mesh(geometry, material))
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10)
  camera.position.z = 2
  const target = new THREE.RenderTarget(64, 64, { type: THREE.HalfFloatType })
  const render = async (repeat, filtered) => {
    material.map.repeat.set(...repeat)
    material.map.offset.set(2 / 64, 1 / 64)
    material.map.magFilter = filtered ? THREE.LinearFilter : THREE.NearestFilter
    material.map.minFilter = filtered ? THREE.LinearMipmapLinearFilter : THREE.NearestFilter
    material.map.anisotropy = filtered ? 16 : 1
    material.colorNode = filtered ? filteredNode : null
    material.needsUpdate = true
    await new Promise(requestAnimationFrame)
    renderer.setRenderTarget(target)
    renderer.render(scene, camera)
    const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 64, 64)
    return Array.from(pixels, THREE.DataUtils.fromHalfFloat)
  }
  const meanError = (pixels) => {
    const expected = [0.4, 0.2, 0.1]
    let error = 0
    for (let i = 0; i < pixels.length; i++) {
      if (i % 4 !== 3)
        error += Math.abs(pixels[i] - expected[i % 4])
    }
    return error / (64 * 64 * 3)
  }
  try {
    const nearNearest = await render([0.125, 0.125], false)
    const nearFiltered = await render([0.125, 0.125], true)
    const nearMaxError = Math.max(...nearNearest.map((value, i) => Math.abs(value - nearFiltered[i])))
    if (nearMaxError > 0.002)
      throw new Error(`Pixel-art magnification blurred texel interiors: ${nearMaxError}`)
    const farNearestError = meanError(await render([14.75, 14.75], false))
    const farFilteredError = meanError(await render([14.75, 14.75], true))
    const obliqueFilteredError = meanError(await render([0.25, 14.75], true))
    if (farNearestError < 0.1 || farFilteredError > 0.003 || obliqueFilteredError > 0.003)
      throw new Error(`Minification aliasing: ${JSON.stringify({ farNearestError, farFilteredError, obliqueFilteredError })}`)
    return {
      nearMaxError,
      farNearestError,
      farFilteredError,
      obliqueFilteredError,
    }
  }
  finally {
    renderer.setRenderTarget(null)
    target.dispose()
    samplers.dispose()
    material.dispose()
    source.dispose()
    geometry.dispose()
    atlas.dispose()
    map.dispose()
    renderer.dispose()
  }
}
