import * as THREE from 'three/webgpu'
import { createColorGrading } from './color-grading.js'
import { createViewModelLayer } from './passes/viewmodel-pass.js'
import { renderConfig, validateEffects } from './render-config.js'
import { buildPipeline } from './render-pipeline.js'
import { FrameStatistics, PipelineProfiler } from './render-profiler.js'

export async function createRenderSystem({ size, canvas, scene, camera, config = {} }) {
  let settings = {
    ...renderConfig,
    ...config,
  }
  validateEffects(settings)
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
    throw new Error('WebGPU adapter unavailable; WebGL fallback is not supported')
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ReinhardToneMapping
  renderer.toneMappingExposure = settings.toneMappingExposure
  renderer.info.autoReset = false
  const profiler = new PipelineProfiler(settings.trackTimestamp)
  renderer.inspector = profiler
  const cpuTimes = new FrameStatistics()
  let pipeline = null
  let pipelineGeneration = 0
  const grading = createColorGrading()
  const viewmodel = createViewModelLayer({ aspect: size.aspect, lightIntensity: settings.viewmodelLightIntensity })
  let disposed = false
  const resize = ({ width, height, pixelRatio, aspect }) => {
    camera.aspect = aspect
    camera.updateProjectionMatrix()
    viewmodel.resize(aspect)
    renderer.setPixelRatio(Math.min(pixelRatio, settings.maxPixelRatio))
    renderer.setSize(width, height)
    cpuTimes.reset()
    profiler.invalidate()
  }
  const offResize = size.on('resize', resize)
  const system = {
    name: 'render',
    renderer,
    viewmodel,
    setEffects(changes) {
      if (!pipeline || disposed)
        throw new Error('[Render] Pipeline is not ready')
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
      ]
      if (structural.some(key => next[key] !== settings[key])) {
        const replacement = buildPipeline(renderer, scene, camera, next, grading, viewmodel)
        pipeline.dispose()
        pipeline = replacement
        pipelineGeneration++
      }
      else {
        pipeline.updateConfig(next)
      }
      renderer.toneMappingExposure = next.toneMappingExposure
      viewmodel.setLightIntensity(next.viewmodelLightIntensity)
      settings = next
      cpuTimes.reset()
      profiler.invalidate()
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
    readLinearPixel(x, y) {
      if (!pipeline || disposed)
        throw new Error('[Render] Pipeline is not ready')
      return pipeline.readLinearPixel(x, y)
    },
    readViewModelPixel(x, y) {
      if (!pipeline || disposed)
        throw new Error('[Render] Pipeline is not ready')
      return pipeline.readViewModelPixel(x, y)
    },
    readCompositePixel(x, y) {
      if (!pipeline || disposed)
        throw new Error('[Render] Pipeline is not ready')
      return pipeline.readCompositePixel(x, y)
    },
    measureGpu() {
      if (!pipeline || disposed)
        throw new Error('[Render] Pipeline is not ready')
      return profiler.resolve()
    },
    /** 逻辑写完、绘制开始前的数据边界。当前仍共享同一 Scene / Camera。 */
    swapLogicRenderData() {},
    update() {
      if (!pipeline || disposed)
        return
      renderer.info.reset()
      profiler.beginFrame()
      const started = performance.now()
      pipeline.render()
      cpuTimes.add(performance.now() - started)
    },
    snapshot() {
      return {
        ready: !!pipeline && !disposed,
        config: settings,
        pipeline: {
          generation: pipelineGeneration,
          ...pipeline?.snapshot(),
        },
        toneMapping: renderer.toneMapping,
        exposure: renderer.toneMappingExposure,
        colorGrading: { ...grading.params, size: grading.size },
        viewport: {
          width: canvas.width,
          height: canvas.height,
          dpr: renderer.getPixelRatio(),
        },
        render: { ...renderer.info.render },
        viewmodel: {
          enabled: viewmodel.enabled,
          fov: viewmodel.camera.fov,
          aspect: viewmodel.camera.aspect,
          near: viewmodel.camera.near,
          far: viewmodel.camera.far,
        },
        memory: { ...renderer.info.memory },
        cpuSubmitMs: cpuTimes.snapshot(),
        gpuTiming: {
          enabled: settings.trackTimestamp,
          supported: !disposed && renderer.hasFeature('timestamp-query'),
          latest: profiler.latest,
          unit: 'GPU milliseconds; measureGpu() resolves the last submitted pipeline frame',
        },
      }
    },
    dispose() {
      if (disposed)
        return
      disposed = true
      offResize()
      pipeline?.dispose()
      viewmodel.dispose()
      grading.dispose()
      renderer.dispose()
    },
  }
  try {
    resize(size)
    pipeline = buildPipeline(renderer, scene, camera, settings, grading, viewmodel)
    pipelineGeneration++
    return system
  }
  catch (error) {
    system.dispose()
    throw error
  }
}
