import * as THREE from 'three/webgpu'
import { createColorGrading } from './color-grading.js'
import { renderConfig, validateEffects } from './config.js'
import { buildPipeline } from './pipeline.js'
import { FrameStatistics, PipelineProfiler } from './profiling.js'

export async function createRenderSystem({ engine, canvas, scene, camera, config = {} }) {
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
  let disposed = false
  const resize = ({ width, height, pixelRatio, aspect }) => {
    camera.aspect = aspect
    camera.updateProjectionMatrix()
    renderer.setPixelRatio(Math.min(pixelRatio, settings.maxPixelRatio))
    renderer.setSize(width, height)
    cpuTimes.reset()
    profiler.invalidate()
  }
  const offResize = engine.size.on('resize', resize)
  const system = {
    name: 'render',
    renderer,
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
        const replacement = buildPipeline(renderer, scene, camera, next, grading)
        pipeline.dispose()
        pipeline = replacement
        pipelineGeneration++
      }
      else {
        pipeline.updateConfig(next)
      }
      renderer.toneMappingExposure = next.toneMappingExposure
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
    measureGpu() {
      if (!pipeline || disposed)
        throw new Error('[Render] Pipeline is not ready')
      return profiler.resolve()
    },
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
      grading.dispose()
      renderer.dispose()
    },
  }
  try {
    resize(engine.size)
    pipeline = buildPipeline(renderer, scene, camera, settings, grading)
    pipelineGeneration++
    return system
  }
  catch (error) {
    system.dispose()
    throw error
  }
}
