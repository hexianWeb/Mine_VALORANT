// @ts-check
/**
 * Mini engine public API. Import from here, not from inner files.
 *
 * Layers:
 * - core/       lifecycle, time, size, update order, events, cleanup (no three.js rendering logic)
 * - resources/  asset loading, cache, GPU release
 * - systems/    feature modules plugged into Scheduler phases (input, physics, animation, render)
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
