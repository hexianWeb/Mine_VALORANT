import { InspectorBase } from 'three/webgpu'

/** Bounded steady-state window. Compilation/resize warmup is kept out of percentiles. */
export class FrameStatistics {
  constructor(capacity = 240, warmup = 30) {
    this.values = new Float64Array(capacity)
    this.warmup = warmup
    this.reset()
  }

  reset() {
    this.count = 0
    this.cursor = 0
    this.remainingWarmup = this.warmup
  }

  add(value) {
    if (this.remainingWarmup > 0) {
      this.remainingWarmup--
      return
    }
    if (!Number.isFinite(value) || value < 0)
      return
    this.values[this.cursor] = value
    this.cursor = (this.cursor + 1) % this.values.length
    this.count = Math.min(this.count + 1, this.values.length)
  }

  snapshot() {
    const sorted = this.values.slice(0, this.count).sort()
    const percentile = p => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? null
    return {
      samples: this.count,
      warmupRemaining: this.remainingWarmup,
      p50: percentile(0.5),
      p95: percentile(0.95),
      p99: percentile(0.99),
    }
  }
}

/** Uses r187's Inspector hooks to associate GPU timestamps with named render passes. */
export class PipelineProfiler extends InspectorBase {
  constructor(enabled) {
    super()
    this.enabled = enabled
    this.passes = []
    this.latest = null
    this.pending = null
    this.revision = 0
  }

  beginFrame() {
    this.passes = []
  }

  beginRender(uid, scene, camera, target) {
    if (this.enabled) {
      this.passes.push({
        uid,
        name: scene.name || target?.texture.name || 'screen',
        width: target?.width ?? this.getRenderer().domElement.width,
        height: target?.height ?? this.getRenderer().domElement.height,
      })
    }
  }

  invalidate() {
    this.revision++
    this.latest = null
    this.passes = []
  }

  async resolve() {
    if (this.pending)
      return this.pending
    const renderer = this.getRenderer()
    if (!this.enabled || !renderer?.hasFeature('timestamp-query'))
      return null
    const revision = this.revision
    const passes = [...this.passes]
    if (!passes.length)
      return null
    this.pending = (async () => {
      await renderer.resolveTimestampsAsync('render')
      if (revision !== this.revision || this.getRenderer() !== renderer)
        return null
      const pool = renderer.backend.timestampQueryPool.render
      // Auto-resolved/overwritten queries are not valid samples of this frame.
      if (!pool || passes.some(pass => !pool.hasTimestampQuery(pass.uid)))
        return null
      const timings = passes.map(pass => ({
        ...pass,
        gpuMs: renderer.backend.getTimestamp(pass.uid),
      }))
      this.latest = {
        totalMs: timings.reduce((sum, pass) => sum + pass.gpuMs, 0),
        passes: timings,
      }
      return this.latest
    })()
    try {
      return await this.pending
    }
    finally {
      this.pending = null
    }
  }

  dispose() {
    this.invalidate()
    super.dispose()
    this.setRenderer(null)
  }
}
