import { positionLocal, vec3 } from 'three/tsl'
import * as THREE from 'three/webgpu'
import { EventEmitter } from '../src/engine/runtime/core/events.js'
import { createRenderSystem } from '../src/engine/runtime/function/render/index.js'
import { NormalPrepass } from '../src/engine/runtime/function/render/passes/normal-prepass.js'

function check(condition, message) {
  if (!condition)
    throw new Error(message)
}

/** A content-free scene must support rendering and effect controls without loading a room. */
export async function checkStandaloneRenderSystem() {
  const size = Object.assign(new EventEmitter(), {
    width: 64,
    height: 64,
    aspect: 1,
    pixelRatio: 1,
  })
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0.2, 0.1, 0.05)
  const camera = new THREE.PerspectiveCamera()
  camera.position.set(1, 2, 3)
  const render = await createRenderSystem({
    size,
    canvas: document.createElement('canvas'),
    scene,
    camera,
    config: { ao: false, aa: 'none' },
  })
  try {
    check(render.snapshot().ready, 'Renderer must be ready before loading world content')
    check(camera.position.equals(new THREE.Vector3(1, 2, 3)), 'Renderer changed the content camera pose')
    render.setEffects({ toneMappingExposure: 1.5 })
    render.update()
    const pixel = await render.readLinearPixel(32, 32)
    check(pixel.every(Number.isFinite) && pixel[0] > 0, 'Empty-scene HDR readback failed')
    check(await render.measureGpu() === null, 'Disabled profiling should return null without requiring a room')
    render.setEffects({ ao: true, aa: 'smaa' })
    await new Promise(requestAnimationFrame)
    render.update()
    size.emit('resize', {
      width: 80,
      height: 40,
      aspect: 2,
      pixelRatio: 1,
    })
    check(camera.aspect === 2 && render.snapshot().viewport.width === 80, 'Standalone resize failed')
    render.dispose()
    check(!render.snapshot().ready, 'Disposed renderer is still ready')
    size.emit('resize', {
      width: 16,
      height: 16,
      aspect: 1,
      pixelRatio: 1,
    })
    check(camera.aspect === 2, 'Disposed renderer kept its resize subscription')
    for (const action of [
      () => render.setEffects({ ao: false }),
      () => render.readLinearPixel(0, 0),
      () => render.measureGpu(),
    ]) {
      let rejected = false
      try {
        action()
      }
      catch (error) {
        rejected = error.message.includes('Pipeline is not ready')
      }
      check(rejected, 'Disposed pipeline API must reject calls')
    }
    return {
      pixel,
      effectsWithoutWorld: true,
      resized: true,
      disposed: true,
    }
  }
  finally {
    render.dispose()
  }
}

/** Real GPU contract: independent depth, premultiplied HDR composition, and stable view ownership. */
export async function checkViewModelComposition() {
  const size = Object.assign(new EventEmitter(), {
    width: 64,
    height: 64,
    aspect: 1,
    pixelRatio: 1,
  })
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(70, 1, 0.005, 10)
  const geometry = new THREE.PlaneGeometry(2, 2)
  const blue = new THREE.MeshBasicNodeMaterial({ color: 0x0000FF })
  const red = new THREE.MeshBasicNodeMaterial({
    color: 0xFF0000,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  })
  const premultipliedRed = new THREE.MeshBasicNodeMaterial({
    color: 0xFF0000,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    premultipliedAlpha: true,
  })
  const green = new THREE.MeshBasicNodeMaterial({ color: 0x00FF00 })
  const backRed = new THREE.MeshBasicNodeMaterial({ color: 0xFF0000 })
  const world = new THREE.Mesh(geometry, blue)
  world.position.z = -0.1
  scene.add(world)
  const canvas = document.createElement('canvas')
  const render = await createRenderSystem({
    size,
    canvas,
    scene,
    camera,
    config: {
      ao: false,
      aa: 'none',
      toneMappingExposure: 1,
      lutEnabled: false,
    },
  })
  const layer = render.viewmodel
  const viewScene = layer.scene
  const viewCamera = layer.camera
  const view = new THREE.Mesh(geometry, red)
  view.position.z = -1
  const near = new THREE.Mesh(geometry, green)
  near.position.z = -0.5
  near.visible = false
  viewScene.add(near, view)
  layer.setEnabled(true)
  const closePixel = (actual, expected, label) => check(
    actual.length === expected.length && actual.every((value, index) => Math.abs(value - expected[index]) < 0.015),
    `${label}: expected ${expected}, got ${actual}`,
  )
  const frame = async () => {
    await new Promise(requestAnimationFrame)
    render.update()
  }
  try {
    await frame()
    const worldPixel = await render.readLinearPixel(32, 32)
    const viewPixel = await render.readViewModelPixel(32, 32)
    const compositePixel = await render.readCompositePixel(32, 32)
    closePixel(worldPixel, [0, 0, 1, 1], 'World HDR')
    closePixel(viewPixel, [0.5, 0, 0, 0.5], 'Straight-alpha material must accumulate premultiplied HDR')
    closePixel(compositePixel, [0.5, 0, 0.5, 1], 'View must composite once and ignore nearer world depth')
    const output = document.createElement('canvas')
    output.width = output.height = 64
    const context = output.getContext('2d')
    context.drawImage(canvas, 0, 0)
    const displayPixel = Array.from(context.getImageData(32, 32, 1, 1).data)
    const expectedDisplay = new THREE.Color(0.5 / 1.5, 0, 0.5 / 1.5).convertLinearToSRGB()
    check(Math.abs(displayPixel[0] - expectedDisplay.r * 255) <= 2
      && Math.abs(displayPixel[2] - expectedDisplay.b * 255) <= 2, `Tone mapping must run once after HDR composition: ${displayPixel}`)

    view.material = premultipliedRed
    await frame()
    closePixel(await render.readViewModelPixel(32, 32), viewPixel, 'Premultiplied-alpha material compatibility')

    near.visible = true
    view.material = backRed
    await frame()
    const depthPixel = await render.readViewModelPixel(32, 32)
    closePixel(depthPixel, [0, 1, 0, 1], 'View geometry must retain its own depth ordering')
    near.visible = false
    view.material = red

    layer.setEnabled(false)
    await frame()
    const disabledPixel = await render.readViewModelPixel(32, 32)
    closePixel(disabledPixel, [0, 0, 0, 0], 'Disabled view target must clear transparent')
    closePixel(await render.readCompositePixel(32, 32), worldPixel, 'Disabled view must leave world HDR intact')
    check(view.parent === viewScene, 'Disabling the view detached its visual root')
    layer.setEnabled(true)

    render.setEffects({ ao: true, aa: 'smaa' })
    await frame()
    closePixel(await render.readViewModelPixel(32, 32), viewPixel, 'World AO must not affect the view pass')
    closePixel(await render.readCompositePixel(32, 32), compositePixel, 'AO/SMAA pipeline replacement changed HDR composition')
    check(render.viewmodel === layer && layer.scene === viewScene && layer.camera === viewCamera && view.parent === viewScene, 'Pipeline replacement changed viewmodel ownership')
    layer.setFov(55)
    size.emit('resize', {
      width: 96,
      height: 48,
      aspect: 2,
      pixelRatio: 1,
    })
    await frame()
    const snapshot = render.snapshot()
    check(viewCamera.aspect === 2 && camera.aspect === 2 && viewCamera.fov === 55 && camera.fov === 70, 'Resize/FOV must update the independent projection without changing world FOV')
    for (const name of ['scene', 'viewmodel', 'composite']) {
      check(snapshot.pipeline[name].width === 96 && snapshot.pipeline[name].height === 48, `${name} target did not resize`)
    }
    check(snapshot.pipeline.scene.id !== snapshot.pipeline.viewmodel.id
      && snapshot.pipeline.viewmodel.depthBuffer && !snapshot.pipeline.composite.depthBuffer, 'World and view must have distinct depth targets; composite needs no depth')
    render.dispose()
    check(view.parent === null && !layer.enabled, 'Render disposal must detach visual roots and disable the layer')
    return {
      worldPixel,
      viewPixel,
      compositePixel,
      displayPixel,
      depthPixel,
      disabledPixel,
      stableOwnership: true,
      resized: [snapshot.pipeline.viewmodel.width, snapshot.pipeline.viewmodel.height],
    }
  }
  finally {
    render.dispose()
    geometry.dispose()
    for (const material of [
      blue,
      red,
      premultipliedRed,
      green,
      backRed,
    ])
      material.dispose()
  }
}

/** GPU readback fixture: a cutout with a distinct normal in front of an opaque surface and behind glass. */
export async function checkNormalPrepass() {
  const renderer = new THREE.WebGPURenderer({
    canvas: new OffscreenCanvas(64, 64),
    antialias: false,
  })
  await renderer.init()
  renderer.setSize(64, 64, false)
  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20)
  camera.position.z = 5
  const geometry = new THREE.PlaneGeometry(2, 2)
  const mask = new THREE.DataTexture(new Uint8Array([255, 255, 255, 0, 255, 255, 255, 255]), 2, 1)
  mask.magFilter = mask.minFilter = THREE.NearestFilter
  mask.needsUpdate = true
  const back = new THREE.MeshStandardNodeMaterial()
  back.normalNode = vec3(0, 0, 1)
  const cutout = new THREE.MeshStandardNodeMaterial({ map: mask, alphaTest: 0.5, side: THREE.DoubleSide })
  cutout.normalNode = vec3(1, 0, 0)
  const glass = new THREE.MeshStandardNodeMaterial({ transparent: true, opacity: 0.5, depthWrite: false })
  glass.normalNode = vec3(0, 1, 0)
  for (const [material, z] of [
    [back, -1],
    [cutout, 0],
    [glass, 1],
  ]) {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.z = z
    scene.add(mesh)
  }
  const prepass = new NormalPrepass(scene, camera)
  const previousFunction = renderer.getRenderObjectFunction()
  const read = async (x) => {
    const values = await renderer.readRenderTargetPixelsAsync(prepass.renderTarget, x, 32, 1, 1)
    return Array.from(values, THREE.DataUtils.fromHalfFloat).slice(0, 3)
  }
  try {
    prepass.updateBefore({ renderer })
    const hole = await read(16)
    const solid = await read(48)
    check(hole[2] > 0.99 && Math.abs(hole[0]) < 0.01, 'Cutout hole must reveal background normal')
    check(solid[0] > 0.99 && Math.abs(solid[1]) < 0.01, 'Cutout solid must retain its normal; BLEND must not overwrite it')
    check(renderer.getRenderObjectFunction() === previousFunction, 'Prepass failed to restore renderer callback')
    cutout.positionNode = positionLocal.add(vec3(3, 0, 0))
    cutout.needsUpdate = true
    await new Promise(requestAnimationFrame)
    prepass.updateBefore({ renderer })
    const deformed = await read(48)
    check(deformed[2] > 0.99, 'Prepass must follow custom vertex deformation')
    check(scene.children[1].material === cutout && cutout.map === mask, 'Prepass mutated source materials')
    return {
      hole,
      solid,
      deformed,
      callbackRestored: true,
      sourceUnchanged: true,
    }
  }
  finally {
    prepass.dispose()
    for (const material of [back, cutout, glass]) material.dispose()
    geometry.dispose()
    mask.dispose()
    renderer.dispose()
  }
}

export async function checkRuntimeUpdates(app) {
  const { render } = app
  const frame = async () => {
    await new Promise(requestAnimationFrame)
    render.update()
  }
  render.setEffects({
    ao: true,
    aa: 'smaa',
    denoise: true,
    aoView: 'scene',
    aoResolutionScale: 0.5,
    denoiseResolutionScale: null,
  })
  await frame()
  const initial = render.snapshot().pipeline
  for (const samples of [8, 32, 16]) {
    render.setEffects({ aoSamples: samples })
    await frame()
    const current = render.snapshot().pipeline
    check(current.generation === initial.generation && current.scene.id === initial.scene.id && current.normals.id === initial.normals.id && current.aaInput.id === initial.aaInput.id, 'AO samples rebuilt unrelated render targets')
    check(current.ao.samples === samples, 'AO sample update did not reach GTAONode')
  }
  const sizes = []
  for (const changes of [
    { aoResolutionScale: 0.5, denoiseResolutionScale: 1 },
    { aoResolutionScale: 0.75, denoiseResolutionScale: null },
    { aoResolutionScale: 1, denoiseResolutionScale: 0.5 },
    { aoResolutionScale: 0.5, denoiseResolutionScale: null },
  ]) {
    render.setEffects(changes)
    await frame()
    const state = render.snapshot()
    const current = state.pipeline
    const scale = changes.denoiseResolutionScale ?? changes.aoResolutionScale
    check(current.generation === initial.generation, 'Resolution change rebuilt pipeline')
    check(current.ao.width === Math.round(state.viewport.width * changes.aoResolutionScale), 'Wrong GTAO resolution')
    check(current.denoise.width === Math.floor(state.viewport.width * scale) && current.denoise.height === Math.floor(state.viewport.height * scale), 'Wrong denoise resolution')
    check(current.denoise.format === THREE.RedFormat && current.denoise.type === THREE.HalfFloatType && !current.denoise.depthBuffer, 'Denoise target must be R16F without depth')
    check(!current.aaInput.depthBuffer, 'SMAA input must not allocate depth')
    sizes.push({ ...changes, ao: current.ao, denoise: current.denoise })
  }
  render.setColorGrading({ preset: 'warm' })
  await frame()
  check(!render.snapshot().pipeline.lutBypassed, 'Warm LUT was bypassed')
  render.setEffects({ lutEnabled: false })
  await frame()
  check(render.snapshot().pipeline.lutBypassed, 'Disabled LUT still enabled')
  render.resetColorGrading()
  render.setEffects({ lutEnabled: true })
  await frame()
  check(!render.snapshot().pipeline.lutBypassed, 'Authored cool grade was bypassed')
  render.setColorGrading({
    preset: 'neutral',
    contrast: 1,
    saturation: 1,
    temperature: 0,
    tint: 0,
  })
  await frame()
  check(render.snapshot().pipeline.lutBypassed, 'Neutral identity LUT must be bypassed')
  const timing = await render.measureGpu()
  check(timing && timing.totalMs > 0 && timing.passes.length >= 8, 'Missing GPU pass timings')
  check(timing.passes.every(pass => Number.isFinite(pass.gpuMs) && pass.gpuMs >= 0), 'Invalid GPU pass timestamp')
  return {
    generation: initial.generation,
    samplesUpdatedInPlace: true,
    sizes,
    timing,
    identityBypassed: true,
  }
}

export async function checkResourceCycles(app) {
  const { render } = app
  const settle = async (effects) => {
    render.setEffects(effects)
    for (let i = 0; i < 3; i++) {
      await new Promise(requestAnimationFrame)
      render.update()
    }
  }
  await settle({ ao: false, aa: 'none', aoView: 'scene' })
  const before = render.snapshot().memory
  for (let i = 0; i < 6; i++) {
    await settle({ ao: true, denoise: true, aa: 'smaa' })
    await settle({ aoView: 'ao' })
    await settle({ aoView: 'scene', denoise: false })
    await settle({ ao: false, aa: 'none' })
  }
  const after = render.snapshot().memory
  check(after.renderTargets === before.renderTargets && after.textures === before.textures, 'Effect cycling leaked render targets/textures')
  await settle({ ao: true, denoise: true, aa: 'smaa' })
  return { cycles: 6, before, after }
}

/** Isolate resolution quality from display/AA changes by comparing linear scene pixels. */
export async function compareAOQuality(app) {
  const { render } = app
  const { width, height } = render.snapshot().viewport
  const points = []
  for (let y = 40; y < height; y += 80) {
    for (let x = 40; x < width; x += 100) {
      const hit = app.pickPixel(x, y)
      if (['realtime', 'baked-appearance', 'lightmap'].includes(hit?.mode))
        points.push({ x, y, mode: hit.mode })
    }
  }
  const sample = async (effects) => {
    render.setEffects(effects)
    await new Promise(requestAnimationFrame)
    render.update()
    const pixels = []
    for (const { x, y } of points)
      pixels.push((await render.readLinearPixel(x, y)).slice(0, 3))
    return pixels
  }
  const full = await sample({ aoResolutionScale: 1, denoiseResolutionScale: 1 })
  const half = await sample({ aoResolutionScale: 0.5, denoiseResolutionScale: null })
  let bakedMax = 0
  let realtimeMax = 0
  let realtimeSum = 0
  let realtimeCount = 0
  let lightmapMax = 0
  let lightmapSum = 0
  let lightmapCount = 0
  for (const [index, point] of points.entries()) {
    const delta = full[index].map((value, channel) => Math.abs(value - half[index][channel]))
    if (point.mode === 'baked-appearance') {
      bakedMax = Math.max(bakedMax, ...delta)
    }
    else if (point.mode === 'lightmap') {
      lightmapCount++
      lightmapMax = Math.max(lightmapMax, ...delta)
      lightmapSum += delta.reduce((sum, value) => sum + value, 0)
    }
    else {
      realtimeCount++
      realtimeMax = Math.max(realtimeMax, ...delta)
      realtimeSum += delta.reduce((sum, value) => sum + value, 0)
    }
  }
  check(realtimeCount >= 10, 'Insufficient visible realtime surfaces for AO quality comparison')
  check(bakedMax === 0, 'Changing AO resolution affected baked appearance')
  check(realtimeMax < 0.08, 'Half-resolution AO has excessive linear HDR error against full resolution')
  check(lightmapMax < 0.12, 'Half-resolution AO has excessive lightmap HDR error against full resolution')
  return {
    pixels: points.length,
    realtimePixels: realtimeCount,
    bakedMax,
    realtimeMax,
    realtimeMean: realtimeSum / (realtimeCount * 3),
    lightmapPixels: lightmapCount,
    lightmapMax,
    lightmapMean: lightmapCount
      ? lightmapSum / (lightmapCount * 3)
      : 0,
    domain: 'linear HDR, default reference camera, full AO/denoise versus half AO/denoise',
  }
}

export async function benchmarkPipeline(app, samples = 40) {
  const { render } = app
  const variants = []
  const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))]
  for (const effects of [
    {
      ao: true,
      aa: 'smaa',
      aoResolutionScale: 0.5,
      denoiseResolutionScale: null,
    },
    {
      ao: true,
      aa: 'smaa',
      aoResolutionScale: 1,
      denoiseResolutionScale: 1,
    },
    {
      ao: true,
      aa: 'smaa',
      aoResolutionScale: 0.5,
      denoiseResolutionScale: 1,
    },
    { ao: false, aa: 'smaa' },
    { ao: false, aa: 'none' },
  ]) {
    render.setEffects(effects)
    const gpu = []
    const cpu = []
    const passes = new Map()
    for (let i = 0; i < samples + 12; i++) {
      await new Promise(requestAnimationFrame)
      const started = performance.now()
      render.update()
      const cpuMs = performance.now() - started
      const timing = await render.measureGpu()
      check(timing !== null, 'Cannot benchmark stale or unsupported GPU timestamps')
      if (i < 12)
        continue
      gpu.push(timing.totalMs)
      cpu.push(cpuMs)
      for (const pass of timing.passes) {
        if (!passes.has(pass.name))
          passes.set(pass.name, [])
        passes.get(pass.name).push(pass.gpuMs)
      }
    }
    variants.push({
      effects,
      samples,
      gpuMs: {
        p50: percentile(gpu, 0.5),
        p95: percentile(gpu, 0.95),
      },
      cpuSubmitMs: {
        p50: percentile(cpu, 0.5),
        p95: percentile(cpu, 0.95),
      },
      passes: Array.from(passes, ([name, values]) => ({
        name,
        p50: percentile(values, 0.5),
        p95: percentile(values, 0.95),
      })),
      memory: render.snapshot().memory,
    })
  }
  render.setEffects({
    ao: true,
    aa: 'smaa',
    aoResolutionScale: 0.5,
    denoiseResolutionScale: null,
  })
  return variants
}
