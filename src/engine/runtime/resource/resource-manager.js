// @ts-check
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import * as THREE from 'three/webgpu'
import { EventEmitter } from '../core/events.js'
import { disposeObject3D } from './dispose-object3d.js'
import { loaders } from './loader/loaders.js'

/** @typedef {import('./loader/loaders.js').AssetType} AssetType */
/** @typedef {import('./loader/loaders.js').AssetTypeMap} AssetTypeMap */
/** @typedef {import('./loader/loaders.js').AssetEntry} AssetEntry */

/**
 * @typedef {object} ResourceEvents
 * @property {{ name: string, loaded: number, total: number }} progress 每次 load() 的一个条目完成后触发
 * @property {{ name: string, error: unknown }} error 真正的加载失败（取消的加载不触发）
 */

/** @typedef {{ entry: AssetEntry, promise: Promise<any>, cancelled: boolean }} LoadTask */

/**
 * 按名称加载、缓存并释放资源。
 *
 * 所有权
 * - Manager 拥有模板：已加载的纹理、gltf.scene，以及它共享的 Geometry/Material/Texture。
 * - 实例（来自 `instantiate()`）拥有克隆出的 Object3D 节点、自己的 AnimationMixer、行为状态，
 *   以及它自己创建的材质或纹理（例如 `mesh.material = mesh.material.clone()`）。
 *   把这些登记到该实例自己的 Disposer。
 * - 销毁实例：`object.removeFromParent()` 加上实例的 Disposer。不要对实例调用 `disposeObject3D(instance)`，
 *   那会释放共享的模板数据。
 *
 * 卸载规则（v1，无引用计数）：资源按关卡加载，在关卡结束时卸载，
 * 且必须在该关卡的全部实例销毁之后。全关卡共享的资源在游戏开始时加载一次，
 * 由 `dispose()` 释放。
 *
 * 异步边界
 * - 加载中再次请求同一名称：复用同一个任务（一次网络请求）。
 * - 加载失败：不写入缓存，下一次 `load()` 会重试。
 * - 加载过程中调用 `unload(name)` 或 `dispose()`：迟到的结果在到达时被释放，
 *   `load()` 以名为 'AbortError' 的 DOMException 拒绝（不发 'error' 事件）。
 *   因此 `await load()` 之后的代码不会对着已销毁的关卡继续执行。
 *
 * @extends {EventEmitter<ResourceEvents>}
 * @example
 * // 关卡开始
 * const manifest = [{ name: 'enemy', type: 'gltf', url: '/models/enemy.glb' }]
 * try { await resources.load(manifest) }
 * catch (error) { if (error.name === 'AbortError') return; throw error }
 * const enemy = resources.instantiate('enemy')
 * scene.add(enemy)
 *
 * // 关卡结束：先销毁实例，再
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
   * 并行加载条目。已加载或正在加载的名称会复用，不会重新加载。
   * 第一次失败即拒绝（其余条目继续加载并仍会缓存）。
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
   * 取已加载资源（共享模板）。缺失或类型不符时抛出。
   * 要放进世界的 gltf 模型请用 `instantiate()`，不要直接添加 `.scene`。
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
   * 为世界中的一个实例克隆 gltf 场景。蒙皮网格会得到自己的骨架。
   * 克隆体与模板共享 geometry/material/texture（见上文所有权）。
   * 动画片段在 `get(name, 'gltf').animations`；每个实例各自创建一个 AnimationMixer。
   * @param {string} name gltf 资源名
   * @returns {THREE.Object3D} 新实例根节点
   */
  instantiate(name) {
    return cloneSkinned(this.get(name, 'gltf').scene)
  }

  /** @param {string} name */
  has(name) {
    return this.#cache.has(name)
  }

  /**
   * 释放一项资源（含 GPU 内存）。若仍在加载，则取消该次加载。
   * 调用方保证已没有实例在使用它（见卸载规则）。
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

  /** 释放全部资源并取消未完成的加载。之后不能再使用该管理器。 */
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
      const reason = error instanceof Error
        ? error.message
        : String(error)
      throw new Error(`[Resources] failed to load "${entry.name}" (${entry.url}): ${reason}`, { cause: error })
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
    case 'exr':
      asset.dispose()
      break
    case 'gltf':
      disposeObject3D(asset.scene)
      break
    case 'json':
      break
  }
}
