// @ts-check
/**
 * Mini engine foundation API. Feature APIs live in function/<feature>/index.js.
 *
 * Layers:
 * - core/       lifecycle, time, size, update order, events, cleanup (no rendering pipeline)
 * - resources/  asset loading, cache, GPU release; depends only on core
 * - function/   reusable runtime features; depends on core/resources, never world or app UI
 *
 * Systems and phases describe scheduling, not directory layers. The application
 * composes features and registers their systems; the kernel never imports them.
 */
export { disposeObject3D, Disposer } from './core/disposer.js'
export { Engine } from './core/engine.js'
export { EventEmitter } from './core/events.js'
export { PHASES, Scheduler } from './core/scheduler.js'
export { Size } from './core/size.js'
export { Time } from './core/time.js'
export { ResourceManager } from './resources/resources.js'

/** @typedef {import('./core/disposer.js').Disposable} Disposable */
/** @typedef {import('./core/engine.js').EngineOptions} EngineOptions */
/** @typedef {import('./core/engine.js').EngineState} EngineState */
/** @typedef {import('./core/scheduler.js').Phase} Phase */
/** @typedef {import('./core/scheduler.js').System} System */
/** @typedef {import('./resources/loaders.js').AssetEntry} AssetEntry */
/** @typedef {import('./resources/loaders.js').AssetType} AssetType */
