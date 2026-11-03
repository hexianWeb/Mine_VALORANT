// @ts-check
/**
 * Physics system (TODO). Phase: 'physics'.
 *
 * Contract:
 * - Step the simulation in `fixedUpdate()` with `engine.time.fixedDelta` (deterministic step).
 * - Sync body transforms to Object3D after stepping; use `engine.time.alpha` for interpolation if needed.
 * - Free the physics world in `dispose()`.
 */
export {}
