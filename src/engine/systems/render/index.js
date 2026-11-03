// @ts-check
/**
 * Render system (TODO). Phase: 'render'.
 *
 * Contract:
 * - Owns WebGPURenderer, THREE.Scene and the active camera.
 * - Subscribes to `engine.size` 'resize' to update renderer size and camera aspect.
 * - `update()`: `renderer.render(scene, camera)` only; never mutates simulation state.
 * - `dispose()`: renderer.dispose() and GPU objects it created itself (not ResourceManager assets).
 */
export {}
