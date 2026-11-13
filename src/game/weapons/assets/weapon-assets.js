import * as THREE from 'three/webgpu'
import { AnimationPlayer } from '../../../engine/runtime/function/animation/animation-player.js'
import { ClipLibrary } from '../../../engine/runtime/function/animation/clip-library.js'
import { validateAmmoDisplay } from './weapon-control-profile.js'
import { applyWeaponMaterialProfile } from './weapon-materials.js'

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
  if (!skin.materials.weapon || Object.keys(skin.materials).some(role => !['weapon', 'scope'].includes(role)))
    throw new Error('[WeaponAssets] Skins may only replace weapon/scope materials, never character arms')
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
  #instanceRecords = new WeakMap()
  #audio
  #audioTasks = new Map()
  #audioCues = new Map()
  #manifests = new Map()
  // The first validated package owns the map; all contract-compatible weapons borrow it.
  #armMaps = new Map()

  constructor({ resources, scopeId, baseUrl = '/weapons/', signal, audio = null } = {}) {
    identifier(scopeId, 'scopeId')
    if (!resources || !['load', 'get', 'instantiate', 'unload'].every(key => typeof resources[key] === 'function'))
      throw new TypeError('[WeaponAssets] Expected a ResourceManager')
    identifier(baseUrl, 'baseUrl')
    this.#resources = resources
    this.#audio = audio
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

  get audioScope() { return this.#prefix }

  audioCue(id) { return this.#audioCues.get(id) ?? null }

  manifest(weaponId, assetVersion) { return this.#manifests.get(`${weaponId}:${assetVersion}`) ?? null }

  /** Audio is optional and cannot block VisualPrepared. Successful siblings remain cached. */
  async preloadAudio(profile) {
    this.#assertOpen()
    if (!this.#audio || !profile)
      return []
    return Promise.allSettled(Object.values(profile.cues).map((cue) => {
      let task = this.#audioTasks.get(cue.id)
      if (!task) {
        task = (async () => {
          const bytes = await this.#loadEntry({
            name: `${this.#prefix}:audio:${cue.id}`,
            type: 'binary',
            url: cue.url,
            options: { sha256: cue.sha256 },
          })
          const buffer = await this.#audio.decode(bytes)
          this.#assertOpen()
          this.#audioCues.set(cue.id, Object.freeze({ ...cue, buffer }))
        })().catch((error) => {
          if (this.#audioTasks.get(cue.id) === task)
            this.#audioTasks.delete(cue.id)
          if (!this.#closed)
            this.#audio.reportOnce(`load:${cue.id}`, error)
          throw error
        })
        this.#audioTasks.set(cue.id, task)
      }
      return task
    }))
  }

  audioSnapshot() {
    return {
      cues: this.#audioCues.size,
      decodedBytes: Array.from(this.#audioCues.values()).reduce((sum, cue) => sum + cue.buffer.length * cue.buffer.numberOfChannels * 4, 0),
    }
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
    const controls = manifest.runtimeControls
    // Validates all referenced clips and their actual template bindings without creating a mixer.
    const library = new ClipLibrary({
      root: gltf.scene,
      clips: gltf.animations,
      actions,
      controls,
    })
    for (const role of manifest.requiredActions) library.get(role)
    validateAmmoDisplay(manifest, library)
    const bindings = new Map()
    const materialRoles = new Map()
    for (const [role, names] of Object.entries(manifest.materials ?? {})) {
      if (!Array.isArray(names))
        throw new TypeError(`[WeaponAssets] Invalid material bindings for role: ${role}`)
      for (const name of names) {
        if (materialRoles.has(name))
          throw new Error(`[WeaponAssets] Material has multiple roles: ${name}`)
        materialRoles.set(name, role)
      }
    }
    const sourceMaterials = new Map()
    gltf.scene.traverse((object) => {
      for (const material of Array.isArray(object.material)
        ? object.material
        : [object.material]) {
        if (material)
          sourceMaterials.set(material.name, material)
      }
    })
    let sharedArmMap = null
    const armMaterialNames = new Set()
    if (manifest.armContract) {
      const { version, textureSha256 } = manifest.armContract
      if (version !== 1 || typeof textureSha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(textureSha256))
        throw new Error('[WeaponAssets] Unsupported arm UV contract')
      for (const role of ['armsLeft', 'armsRight']) {
        const names = manifest.materials?.[role]
        if (!Array.isArray(names) || !names.length)
          throw new Error(`[WeaponAssets] Missing arm material binding: ${role}`)
        for (const name of names) {
          if (!sourceMaterials.get(name)?.map)
            throw new Error(`[WeaponAssets] Missing arm atlas: ${name}`)
          armMaterialNames.add(name)
        }
      }
      const key = `${version}:${textureSha256}`
      sharedArmMap = this.#armMaps.get(key)
      if (!sharedArmMap) {
        sharedArmMap = sourceMaterials.get(armMaterialNames.values().next().value).map
        sharedArmMap.colorSpace = THREE.SRGBColorSpace
        sharedArmMap.flipY = false
        sharedArmMap.magFilter = THREE.NearestFilter
        sharedArmMap.minFilter = THREE.NearestFilter
        sharedArmMap.generateMipmaps = false
        sharedArmMap.needsUpdate = true
        this.#armMaps.set(key, sharedArmMap)
      }
    }
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
      controls,
      bindings,
      materialRoles,
      sharedArmMap,
      armMaterialNames,
    })
    this.#manifests.set(`${request.weaponId}:${request.assetVersion}`, manifest)
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
            applyWeaponMaterialProfile(material, record.materialRoles.get(source.name))
            if (record.armMaterialNames.has(source.name)) {
              material.map = record.sharedArmMap
              material.needsUpdate = true
            }
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
      player = new AnimationPlayer({
        root,
        clips: record.clips,
        actions: record.actions,
        controls: record.controls,
      })
      const state = { handle, materials }
      instance = Object.freeze({
        root,
        player,
        dispose,
        get skinId() {
          return state.handle.skinId
        },
      })
      this.#instances.add(instance)
      this.#instanceRecords.set(instance, state)
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

  /** Atomic compatible material swap. No nodes, skeleton, mixer, actions or shared maps are rebuilt. */
  applySkin(instance, handle) {
    this.#assertOpen()
    const state = this.#instanceRecords.get(instance)
    const next = this.#handles.get(handle)
    if (!state || !this.#instances.has(instance) || !next)
      throw new Error('[WeaponAssets] Expected a live instance and AssetReady handle from this scope')
    const previous = this.#handles.get(state.handle)
    if (previous.modelKey !== next.modelKey)
      throw new Error('[WeaponAssets] A skin swap requires the same model version')
    // Resolve every assignment before touching any material; failure must leave the old skin intact.
    const updates = []
    const names = new Set([
      ...previous.bindings.keys(),
      ...next.bindings.keys(),
    ])
    for (const name of names) {
      const matches = [...state.materials].filter(([source]) => source.name === name)
      if (!matches.length)
        throw new Error(`[WeaponAssets] Missing instance material: ${name}`)
      for (const [source, material] of matches)
        updates.push([material, next.bindings.get(name) ?? source.map])
    }
    for (const [material, map] of updates) {
      if (material.map !== map) {
        material.map = map
        material.needsUpdate = true
      }
    }
    state.handle = handle
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
    this.#audio?.invalidate({ scope: this.#prefix })
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
    this.#audioTasks.clear()
    this.#audioCues.clear()
    this.#manifests.clear()
    this.#armMaps.clear()
    this.#handles = new WeakMap()
    this.#instanceRecords = new WeakMap()
    if (errors.length)
      throw new AggregateError(errors, '[WeaponAssets] Scope disposal failed')
  }
}
