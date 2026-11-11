import * as THREE from 'three/webgpu'
import { AnimationPlayer } from '../../../engine/runtime/function/animation/animation-player.js'
import { ClipLibrary } from '../../../engine/runtime/function/animation/clip-library.js'

let nextScope = 0

function identifier(value, label) {
  if (typeof value !== 'string' || !value.length || value.trim() !== value)
    throw new TypeError(`[WeaponAssets] Invalid ${label}`)
  return value
}

function immutable(value) {
  if (Array.isArray(value))
    return Object.freeze(value.map(immutable))
  if (value && typeof value === 'object') {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      immutable(entry),
    ])))
  }
  return value
}

function resolveURL(path, base) {
  const fallback = 'https://weapon-assets.invalid/'
  const resolved = new URL(path, new URL(base, globalThis.location?.href ?? fallback))
  return resolved.origin === new URL(fallback).origin
    ? `${resolved.pathname}${resolved.search}${resolved.hash}`
    : resolved.href
}

function abortError() {
  return new DOMException('[WeaponAssets] Scope or request closed', 'AbortError')
}

/** A request stops waiting without cancelling the scope-owned shared download. */
function waitFor(task, signal) {
  if (!signal)
    return task
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    task.then((value) => {
      signal.removeEventListener('abort', onAbort)
      if (signal.aborted)
        reject(signal.reason ?? abortError())
      else
        resolve(value)
    }, (error) => {
      signal.removeEventListener('abort', onAbort)
      reject(error)
    })
    if (signal.aborted)
      onAbort()
  })
}

function validateIdentity(data, request, label) {
  if (!data || data.schemaVersion !== 1 || data.weaponId !== request.weaponId
    || data.assetVersion !== request.assetVersion) {
    throw new Error(`[WeaponAssets] ${label} identity/version mismatch`)
  }
}

function profileFrom(manifest) {
  if (!Array.isArray(manifest.clips) || !Array.isArray(manifest.requiredActions)
    || !manifest.actions || typeof manifest.actions !== 'object') {
    throw new Error('[WeaponAssets] Missing animation profile')
  }
  const metadata = new Map()
  for (const clip of manifest.clips) {
    identifier(clip.name, 'clip name')
    if (metadata.has(clip.name))
      throw new Error(`[WeaponAssets] Duplicate clip metadata: ${clip.name}`)
    metadata.set(clip.name, clip)
  }
  for (const role of manifest.requiredActions) {
    if (!Object.hasOwn(manifest.actions, role))
      throw new Error(`[WeaponAssets] Missing required action: ${role}`)
  }
  return immutable(Object.fromEntries(Object.entries(manifest.actions).map(([role, name]) => {
    const clip = metadata.get(name)
    if (!clip)
      throw new Error(`[WeaponAssets] Missing metadata for action ${role}: ${name}`)
    return [
      role,
      {
        clip: name,
        loop: clip.loop ?? false,
        markers: (clip.markers ?? []).map((marker, index) => ({
          id: `${name}:${index}`,
          time: marker.time,
          type: 'sound',
          payload: {
            cue: identifier(marker.cue, 'marker cue'),
          },
        })),
      },
    ]
  })))
}

function validateSkin(manifest, skin, request) {
  validateIdentity(skin, request, 'Skin')
  if (skin.skinId !== request.skinId)
    throw new Error('[WeaponAssets] Skin ID mismatch')
  for (const key of ['rig', 'geometryUV', 'clipSet']) {
    if (typeof manifest.compatibility?.[key] !== 'string'
      || manifest.compatibility[key] !== skin.compatibility?.[key]) {
      throw new Error(`[WeaponAssets] Incompatible skin ${key}`)
    }
  }
  if (!skin.materials || typeof skin.materials !== 'object')
    throw new Error('[WeaponAssets] Missing skin materials')
}

function textureSettings(map) {
  if (!map || typeof map.url !== 'string' || map.colorSpace !== 'srgb'
    || map.flipY !== false || map.magFilter !== 'nearest' || map.minFilter !== 'nearest'
    || map.generateMipmaps !== false) {
    throw new Error('[WeaponAssets] Unsupported skin map sampling profile')
  }
  return {
    colorSpace: THREE.SRGBColorSpace,
    flipY: false,
    magFilter: THREE.NearestFilter,
    minFilter: THREE.NearestFilter,
    generateMipmaps: false,
  }
}

/**
 * One level's shared weapon templates and detached instances. Only this scope's signal reaches
 * ResourceManager; an equipment request may stop waiting without aborting another request.
 * ViewModel owns active/staged slots and calls instantiate only after reserving an available slot.
 */
export class WeaponAssets {
  #resources
  #baseUrl
  #prefix
  #controller = new AbortController()
  #externalSignal
  #onAbort
  #closed = false
  #tasks = new Map()
  #handles = new WeakMap()
  #names = new Set()
  #instances = new Set()

  constructor({ resources, scopeId, baseUrl = '/weapons/', signal } = {}) {
    identifier(scopeId, 'scopeId')
    if (!resources || !['load', 'get', 'instantiate', 'unload'].every(key => typeof resources[key] === 'function'))
      throw new TypeError('[WeaponAssets] Expected a ResourceManager')
    identifier(baseUrl, 'baseUrl')
    this.#resources = resources
    this.#baseUrl = baseUrl.endsWith('/')
      ? baseUrl
      : `${baseUrl}/`
    this.#prefix = `weapons:${scopeId}:${++nextScope}`
    this.#externalSignal = signal
    this.#onAbort = () => this.dispose()
    signal?.addEventListener('abort', this.#onAbort, { once: true })
    if (signal?.aborted)
      this.dispose()
  }

  /** AssetReady only: no cloned model, mixer, gameplay ticket, or scene attachment is created. */
  async load({ weaponId, assetVersion, skinId }, { signal } = {}) {
    this.#assertOpen()
    signal?.throwIfAborted()
    const request = {
      weaponId: identifier(weaponId, 'weaponId'),
      assetVersion: identifier(assetVersion, 'assetVersion'),
      skinId: identifier(skinId, 'skinId'),
    }
    const key = JSON.stringify(request)
    let task = this.#tasks.get(key)
    if (!task) {
      task = this.#loadShared(request).catch((error) => {
        if (this.#tasks.get(key) === task)
          this.#tasks.delete(key)
        throw error
      })
      this.#tasks.set(key, task)
    }
    return waitFor(task, signal)
  }

  async #loadEntry(entry) {
    this.#assertOpen()
    this.#names.add(entry.name)
    await this.#resources.load([entry], { signal: this.#controller.signal })
    this.#assertOpen()
    return this.#resources.get(entry.name, entry.type)
  }

  async #loadShared(request) {
    const packageKey = `${this.#prefix}:${JSON.stringify([request.weaponId, request.assetVersion])}`
    const manifestURL = resolveURL(`${encodeURIComponent(request.weaponId)}/${encodeURIComponent(request.assetVersion)}/manifest.json`, this.#baseUrl)
    const manifest = immutable(await this.#loadEntry({ name: `${packageKey}:manifest`, type: 'json', url: manifestURL }))
    validateIdentity(manifest, request, 'Manifest')
    const skinEntry = manifest.skins?.[request.skinId]
    if (!skinEntry || typeof skinEntry.url !== 'string' || typeof manifest.model?.url !== 'string')
      throw new Error('[WeaponAssets] Missing model or requested skin')
    const skinURL = resolveURL(skinEntry.url, manifestURL)
    const modelKey = `${packageKey}:model`
    const [gltf, skin] = await Promise.all([
      this.#loadEntry({
        name: modelKey,
        type: 'gltf',
        url: resolveURL(manifest.model.url, manifestURL),
        options: { sha256: manifest.model.sha256 },
      }),
      this.#loadEntry({ name: `${packageKey}:skin:${request.skinId}`, type: 'json', url: skinURL }),
    ])
    validateSkin(manifest, skin, request)
    const actions = profileFrom(manifest)
    // Validates all referenced clips and their actual template bindings without creating a mixer.
    const library = new ClipLibrary({ root: gltf.scene, clips: gltf.animations, actions })
    for (const role of manifest.requiredActions) library.get(role)
    const bindings = new Map()
    const sourceMaterials = new Map()
    gltf.scene.traverse((object) => {
      for (const material of Array.isArray(object.material)
        ? object.material
        : [object.material]) {
        if (material)
          sourceMaterials.set(material.name, material)
      }
    })
    await Promise.all(Object.entries(skin.materials).map(async ([role, materialInput]) => {
      const names = manifest.materials?.[role]
      if (!Array.isArray(names) || !names.length || names.some(name => !sourceMaterials.has(name)))
        throw new Error(`[WeaponAssets] Missing material binding for role: ${role}`)
      if (!materialInput || Object.keys(materialInput).some(key => key !== 'map'))
        throw new Error(`[WeaponAssets] Unsupported material inputs for role: ${role}`)
      const settings = textureSettings(materialInput.map)
      const url = resolveURL(materialInput.map.url, skinURL)
      const name = `${packageKey}:texture:${JSON.stringify([request.skinId, role, url, settings])}`
      const texture = await this.#loadEntry({
        name,
        type: 'texture',
        url,
        options: { colorSpace: settings.colorSpace },
      })
      Object.assign(texture, settings)
      texture.needsUpdate = true
      for (const materialName of names) {
        if (bindings.has(materialName))
          throw new Error(`[WeaponAssets] Material has multiple skin roles: ${materialName}`)
        bindings.set(materialName, texture)
      }
    }))
    this.#assertOpen()
    const handle = Object.freeze({ ...request, manifest })
    this.#handles.set(handle, {
      modelKey,
      clips: gltf.animations,
      actions,
      bindings,
    })
    return handle
  }

  /** Creates an independently animated lease. Geometry and textures stay owned by the scope. */
  instantiate(handle) {
    this.#assertOpen()
    const record = this.#handles.get(handle)
    if (!record)
      throw new Error('[WeaponAssets] Expected this scope\'s AssetReady handle')
    const root = this.#resources.instantiate(record.modelKey)
    const skeletons = new Set()
    const materials = new Map()
    let player
    let released = false
    let instance
    const dispose = () => {
      if (released)
        return
      released = true
      this.#instances.delete(instance)
      const errors = []
      for (const release of [
        () => player?.dispose(),
        () => root.removeFromParent(),
        ...Array.from(skeletons, skeleton => () => skeleton.dispose()),
        ...Array.from(materials.values(), material => () => material.dispose()),
      ]) {
        try {
          release()
        }
        catch (error) {
          errors.push(error)
        }
      }
      if (errors.length)
        throw new AggregateError(errors, '[WeaponAssets] Instance disposal failed')
    }
    try {
      root.traverse((object) => {
        if (object.isSkinnedMesh)
          skeletons.add(object.skeleton)
      })
      root.traverse((object) => {
        if (!object.material)
          return
        const cloneMaterial = (source) => {
          if (!materials.has(source)) {
            const material = source.clone()
            materials.set(source, material)
            if (record.bindings.has(source.name)) {
              material.map = record.bindings.get(source.name)
              material.needsUpdate = true
            }
          }
          return materials.get(source)
        }
        object.material = Array.isArray(object.material)
          ? object.material.map(cloneMaterial)
          : cloneMaterial(object.material)
      })
      player = new AnimationPlayer({ root, clips: record.clips, actions: record.actions })
      instance = Object.freeze({ root, player, dispose })
      this.#instances.add(instance)
      return instance
    }
    catch (error) {
      try {
        dispose()
      }
      catch (cleanupError) {
        throw new AggregateError([error, cleanupError], '[WeaponAssets] Instance creation and rollback failed')
      }
      throw error
    }
  }

  #assertOpen() {
    if (this.#closed)
      throw abortError()
  }

  /** Stop all players and release unique instances before unloading any shared template. */
  dispose() {
    if (this.#closed)
      return
    this.#closed = true
    this.#externalSignal?.removeEventListener('abort', this.#onAbort)
    this.#controller.abort(abortError())
    const errors = []
    for (const instance of [...this.#instances]) {
      try {
        instance.dispose()
      }
      catch (error) {
        errors.push(error)
      }
    }
    for (const name of this.#names) {
      try {
        this.#resources.unload(name)
      }
      catch (error) {
        errors.push(error)
      }
    }
    this.#names.clear()
    this.#tasks.clear()
    this.#handles = new WeakMap()
    if (errors.length)
      throw new AggregateError(errors, '[WeaponAssets] Scope disposal failed')
  }
}
