// @ts-check

/** @typedef {{ fixedUpdate: (dt: number) => void }} Body */

/** Phase 'physics': steps registered bodies at `time.fixedDelta`. */
export function createPhysicsSystem() {
  /** @type {Set<Body>} */
  const bodies = new Set()
  let lastStepMs = 0
  return {
    name: 'physics',
    /** @param {Body} body */
    add(body) {
      bodies.add(body)
      return () => {
        bodies.delete(body)
      }
    },
    get lastStepMs() {
      return lastStepMs
    },
    /** @param {import('../../core/engine.js').Engine} engine */
    fixedUpdate(engine) {
      const start = performance.now()
      for (const body of bodies) body.fixedUpdate(engine.time.fixedDelta)
      lastStepMs = performance.now() - start
    },
    dispose() {
      bodies.clear()
    },
  }
}
