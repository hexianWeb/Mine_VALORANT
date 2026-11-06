import * as THREE from 'three/webgpu'
import { createColorGrading } from './color-grading.js'
import { renderConfig, validateEffects } from './config.js'
import { buildPipeline } from './pipeline.js'
import { loadRoomAssets } from './room-assets.js'
import { createRoomLights } from './room-lights.js'
import { createEnvironmentProxy } from './sky-environment.js'

export async function createRenderSystem({ engine, canvas, scene, camera, resources, config = {} }) {
  let settings = {
    ...renderConfig,
    ...config,
  }
  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: false,
    forceWebGL: false,
    trackTimestamp: settings.trackTimestamp,
  })
  try {
    await renderer.init()
  }
  catch (error) {
    renderer.dispose()
    throw error
  }
  if (!renderer.backend.isWebGPUBackend) {
    renderer.dispose()
    throw new Error('WebGPU adapter unavailable; WebGL fallback is not an accepted room baseline')
  }
  settings.textureAnisotropy = Math.min(settings.textureAnisotropy, renderer.getMaxAnisotropy())
  validateEffects(settings)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ReinhardToneMapping
  renderer.toneMappingExposure = settings.toneMappingExposure
  renderer.info.autoReset = false
  let pipeline = null
  let room = null
  let lights = null
  const grading = createColorGrading()
  const skyName = 'range-room:skybox-day'
  const previousEnvironment = scene.environment
  const previousBackground = scene.background
  const previousEnvironmentIntensity = scene.environmentIntensity
  let skyLoaded = false
  let environmentProxy = null
  let disposed = false
  let loading = false
  const controller = new AbortController()
  const cpuTimes = []
  const resize = ({ width, height, pixelRatio, aspect }) => {
    camera.aspect = aspect
    camera.updateProjectionMatrix()
    renderer.setPixelRatio(Math.min(pixelRatio, settings.maxPixelRatio))
    renderer.setSize(width, height)
  }
  const offResize = engine.size.on('resize', resize)
  resize(engine.size)
  const system = {
    name: 'range-room-render',
    renderer,
    async loadRoom({ manifestUrl = settings.manifestUrl } = {}) {
      if (loading || room || disposed)
        throw new Error('[Room render] Already loaded/loading or disposed; create a new level instance to reload')
      loading = true
      try {
        const result = await loadRoomAssets({
          resources,
          manifestUrl,
          signal: controller.signal,
          sampling: { anisotropy: settings.textureAnisotropy, atlasMaxMipLevel: settings.atlasMaxMipLevel },
        })
        if (disposed) {
          result.dispose()
          throw new DOMException('Room was disposed during loading', 'AbortError')
        }
        room = result
        scene.add(room.root)
        camera.position.fromArray(room.manifest.camera.position)
        camera.quaternion.fromArray(room.manifest.camera.quaternion)
        camera.fov = room.manifest.camera.fov
        camera.near = room.manifest.camera.near
        camera.far = room.manifest.camera.far
        camera.updateProjectionMatrix()
        await resources.load([
          {
            name: skyName,
            type: 'texture',
            url: settings.skyboxUrl,
          },
        ])
        controller.signal.throwIfAborted()
        const sky = resources.get(skyName, 'texture')
        sky.mapping = THREE.EquirectangularReflectionMapping
        sky.colorSpace = THREE.SRGBColorSpace
        scene.background = sky
        environmentProxy = createEnvironmentProxy(sky)
        scene.environment = environmentProxy
        scene.environmentIntensity = settings.environmentIntensity
        skyLoaded = true
        lights = createRoomLights(room.manifest, { corridorLighting: settings.corridorLighting, environmentLoaded: skyLoaded })
        scene.add(lights.root)
        if (lights.corridor.points.length)
          room.enableCorridorLighting(lights.corridor)
        pipeline = buildPipeline(renderer, scene, camera, settings, grading)
        return room
      }
      catch (error) {
        system.dispose()
        throw error
      }
      finally {
        loading = false
      }
    },
    setEffects(changes) {
      if (!room || disposed)
        throw new Error('[Room render] Room is not ready')
      const next = {
        ...settings,
        ...changes,
      }
      validateEffects(next)
      const structural = [
        'ao',
        'denoise',
        'aa',
        'aoView',
        'aoSamples',
      ]
      if (structural.some(key => next[key] !== settings[key])) {
        const replacement = buildPipeline(renderer, scene, camera, next, grading)
        pipeline.dispose()
        pipeline = replacement
      }
      else {
        pipeline.updateConfig(next)
      }
      renderer.toneMappingExposure = next.toneMappingExposure
      settings = next
    },
    getDebugState() {
      return {
        ...settings,
        grading: { ...grading.params },
        customLutTitle: grading.customTitle,
      }
    },
    setColorGrading(changes) {
      grading.update(changes)
      pipeline?.updateLut(grading)
    },
    importLut(text, filename) {
      grading.importCube(text, filename)
      pipeline?.updateLut(grading)
    },
    resetColorGrading() {
      grading.reset()
      pipeline?.updateLut(grading)
    },
    setCorridorLighting(enabled) {
      lights?.setCorridorEnabled(enabled)
    },
    readLinearPixel(x, y) {
      if (!pipeline || disposed)
        throw new Error('[Room render] Room is not ready')
      return pipeline.readLinearPixel(x, y)
    },
    setRuntimeLighting(enabled) {
      if (!lights || disposed)
        throw new Error('[Room render] Room is not ready')
      lights.setEnabled(enabled)
      scene.environmentIntensity = enabled ? settings.environmentIntensity : 0
    },
    update() {
      if (!pipeline || disposed)
        return
      renderer.info.reset()
      const started = performance.now()
      pipeline.render()
      cpuTimes.push(performance.now() - started)
      if (cpuTimes.length > 600)
        cpuTimes.shift()
    },
    snapshot() {
      const sorted = [...cpuTimes].sort((a, b) => a - b)
      return {
        ready: !!room && !disposed,
        room: room?.manifest.id,
        counts: room?.counts,
        atlasCount: room?.atlases.size,
        atlasBytes: room
          ? Array.from(room.atlases.values()).reduce((sum, atlas) => sum + atlas.mipmaps.reduce((bytes, mip) => bytes + mip.data.byteLength, 0), 0)
          : 0,
        bounds: room
          ? {
              min: room.bounds.min.toArray(),
              max: room.bounds.max.toArray(),
            }
          : null,
        lights: lights?.root.children.map(light => ({
          name: light.name,
          type: light.type,
          intensity: light.intensity,
        })),
        config: settings,
        toneMapping: renderer.toneMapping,
        exposure: renderer.toneMappingExposure,
        skybox: skyLoaded ? settings.skyboxUrl : null,
        environmentSize: environmentProxy
          ? [environmentProxy.image.width, environmentProxy.image.height]
          : null,
        colorGrading: { ...grading.params, size: grading.size },
        sampling: room
          ? {
              textureCount: room.samplers.snapshot().length,
              anisotropy: settings.textureAnisotropy,
              atlasMipLevels: Array.from(room.atlases.values(), atlas => atlas.mipmaps.length),
              atlasFilter: 'linear / trilinear',
              surfaceFilter: 'nearest (no interpolation)',
              surfaceAnisotropy: 1,
            }
          : null,
        viewport: {
          width: canvas.width,
          height: canvas.height,
          dpr: renderer.getPixelRatio(),
        },
        render: { ...renderer.info.render },
        memory: { ...renderer.info.memory },
        cpuSubmitMs: {
          samples: sorted.length,
          p50: sorted[Math.floor(sorted.length * 0.5)] ?? null,
          p95: sorted[Math.floor(sorted.length * 0.95)] ?? null,
          p99: sorted[Math.floor(sorted.length * 0.99)] ?? null,
        },
        gpuTiming: 'query via resolveTimestampsAsync; CPU submission is not GPU time',
        lightCalibration: 'initial fit; RectAreaLight shadows/Spread unavailable; visual acceptance required',
      }
    },
    dispose() {
      if (disposed)
        return
      disposed = true
      controller.abort()
      offResize()
      pipeline?.dispose()
      lights?.dispose()
      room?.dispose()
      scene.background = previousBackground
      scene.environment = previousEnvironment
      scene.environmentIntensity = previousEnvironmentIntensity
      resources.unload(skyName)
      environmentProxy?.dispose()
      grading.dispose()
      renderer.dispose()
    },
  }
  return system
}
