import { performance } from 'node:perf_hooks'

/** Timing is returned to the caller, never embedded in immutable release packages. */
export function createWorkflowTiming(onStage) {
  const started = performance.now()
  const stages = []
  return {
    async measure(name, task) {
      const start = performance.now()
      let passed = false
      try {
        const result = await task()
        passed = true
        return result
      }
      finally {
        const stage = { name, ms: Math.round((performance.now() - start) * 100) / 100, passed }
        stages.push(stage)
        onStage?.(stage)
      }
    },
    snapshot() {
      return {
        totalMs: Math.round((performance.now() - started) * 100) / 100,
        stages: [...stages],
      }
    },
  }
}
