// @ts-check
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import * as THREE from 'three/webgpu'
import { disposeObject3D } from '../core/disposer.js'
import { EventEmitter } from '../core/events.js'
import { loaders } from './loaders.js'

/** @typedef {import('./loaders.js').AssetType} AssetType */
/** @typedef {import('./loaders.js').AssetTypeMap} AssetTypeMap */
/** @typedef {import('./loaders.js').AssetEntry} AssetEntry */

/**
 * @typedef {object} ResourceEvents
 * @property {{ name: string, loaded: number, total: number }} progress fired after each entry of a load() call
 * @property {{ name: string, error: unknown }} error real load failure (not fired for cancelled loads)
 */

/** @typedef {{ entry: AssetEntry, promise: Promise<any>, cancelled: boolean }} LoadTask */

/**
 * Loads, caches and releases assets by name.
 *
 * Ownership
 * - Manager owns the TEMPLATE: loaded textures, gltf.scene and the Geometry/Material/Texture it shares.
 * - An INSTANCE (from `instantiate()`) owns its cloned Object3D nodes, its AnimationMixer, its behavior state,
 *   and any material/texture it creates itself (e.g. `mesh.material = mesh.material.clone()`).
 *   Register those on the instance's own Disposer.
 * - Destroying an instance: `object.removeFromParent()` + instance Disposer. Never `disposeObject3D(instance)`,
 *   that would free the shared template data.
 *
 * Unload rule (v1, no ref counting): assets are loaded per level and unloaded at level end,
 * AFTER all instances of that level are destroyed. Assets shared by all levels are loaded once
 * at game start and released by `dispose()`.
 *
 * Async boundaries
 * - Same name requested while loading: reuses the same task (one network request).
 * - Failed load: nothing is cached, the next `load()` retries.
 * - `unload(name)` / `dispose()` while loading: the late result is disposed on arrival and
 *   `load()` rejects with a DOMException named 'AbortError' (no 'error' event).
 *   Code after `await load()` therefore never runs against a destroyed level.
 *
 * @extends {EventEmitter<ResourceEvents>}
 * @example
 * // level start
 * const manifest = [{ name: 'enemy', type: 'gltf', url: '/models/enemy.glb' }]
 * try { await resources.load(manifest) }
 * catch (error) { if (error.name === 'AbortError') return; throw error }
 * const enemy = resources.instantiate('enemy')
 * scene.add(enemy)
 *
 * // level end: destroy instances first, then
 * for (const { name } of manifest) resources.unload(name)
 */
export class ResourceManager extends EventEmitter {
  /** @type {Map<string, { entry: AssetEntry, asset: any }>} */
  #cache = new Map()
  /** @type {Map<string, LoadTask>} */
  #pending = new Map()
  #manager = new THREE.LoadingManager()
  #disposed = false

  /**
   * Load entries in parallel. Already loaded / loading names are reused, not reloaded.
   * Rejects on the first failure (other entries keep loading and are still cached).
   * @param {AssetEntry[]} entries
   * @returns {Promise<void>}
   */
  async load(entries) {
    const total = entries.length
    let loaded = 0
    await Promise.all(entries.map(async (entry) => {
      await this.#loadOne(entry)
      loaded++
      this.emit('progress', { name: entry.name, loaded, total })
    }))
  }

  /**
   * Get a loaded asset (the shared template). Throws if missing or type mismatches.
   * For gltf models placed in the world, use `instantiate()` instead of adding `.scene` directly.
   * @template {AssetType} K
   * @param {string} name
   * @param {K} type
   * @returns {AssetTypeMap[K]} asset
   */
  get(name, type) {
    const item = this.#cache.get(name)
    if (!item)
      throw new Error(`[Resources] "${name}" is not loaded`)
    if (item.entry.type !== type)
      throw new Error(`[Resources] "${name}" is "${item.entry.type}", not "${type}"`)
    return item.asset
  }

  /**
   * Clone a gltf scene for one world instance. Skinned meshes get their own skeleton.
   * The clone SHARES geometry/material/texture with the template (see Ownership above).
   * Animation clips are on `get(name, 'gltf').animations`; create one AnimationMixer per instance.
   * @param {string} name gltf asset name
   * @returns {THREE.Object3D} new instance root
   */
  instantiate(name) {
    return cloneSkinned(this.get(name, 'gltf').scene)
  }

  /** @param {string} name */
  has(name) {
    return this.#cache.has(name)
  }

  /**
   * Release one asset (GPU memory included). If it is still loading, the load is cancelled.
   * Caller guarantees no instance still uses it (see Unload rule).
   * @param {string} name
   */
  unload(name) {
    const task = this.#pending.get(name)
    if (task) {
      task.cancelled = true
      this.#pending.delete(name)
    }
    const item = this.#cache.get(name)
    if (item) {
      this.#cache.delete(name)
      disposeAsset(item.entry.type, item.asset)
    }
  }

  /** Release all assets and cancel pending loads. The manager cannot be used afterwards. */
  dispose() {
    this.#disposed = true
    for (const name of [
      ...this.#pending.keys(),
      ...this.#cache.keys(),
    ]) this.unload(name)
    this.clear()
  }

  /**
   * @param {AssetEntry} entry
   * @returns {Promise<any>} asset
   */
  async #loadOne(entry) {
    if (this.#disposed)
      throw new Error(`[Resources] load "${entry.name}" after dispose`)

    const known = this.#cache.get(entry.name) ?? this.#pending.get(entry.name)
    if (known && String(known.entry.url) !== String(entry.url))
      throw new Error(`[Resources] name "${entry.name}" already used by ${known.entry.url}`)

    const cached = this.#cache.get(entry.name)
    if (cached)
      return cached.asset
    const pending = this.#pending.get(entry.name)
    if (pending)
      return pending.promise

    const loader = loaders[entry.type]
    if (!loader)
      throw new Error(`[Resources] unknown type "${entry.type}" for "${entry.name}"`)

    /** @type {LoadTask} */
    const task = {
      entry,
      cancelled: false,
      promise: Promise.resolve(),
    }
    task.promise = this.#runTask(task, loader)
    this.#pending.set(entry.name, task)
    return task.promise
  }

  /**
   * @param {LoadTask} task
   * @param {(entry: AssetEntry, manager: THREE.LoadingManager) => Promise<any>} loader
   */
  async #runTask(task, loader) {
    const { entry } = task
    let asset
    try {
      asset = await loader(entry, this.#manager)
    }
    catch (error) {
      if (task.cancelled)
        throw abortError(entry)
      this.emit('error', { name: entry.name, error })
      throw new Error(`[Resources] failed to load "${entry.name}" (${entry.url})`, { cause: error })
    }
    finally {
      if (this.#pending.get(entry.name) === task)
        this.#pending.delete(entry.name)
    }

    if (task.cancelled) {
      disposeAsset(entry.type, asset)
      throw abortError(entry)
    }
    this.#cache.set(entry.name, { entry, asset })
    return asset
  }
}

/** @param {AssetEntry} entry */
function abortError(entry) {
  return new DOMException(`[Resources] "${entry.name}" was unloaded while loading`, 'AbortError')
}

/**
 * @param {AssetType} type
 * @param {any} asset
 */
function disposeAsset(type, asset) {
  switch (type) {
    case 'texture':
    case 'cubeTexture':
    case 'hdr':
      asset.dispose()
      break
    case 'gltf':
      disposeObject3D(asset.scene)
      break
    case 'json':
      break
  }
}
