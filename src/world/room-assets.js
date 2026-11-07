import * as THREE from 'three/webgpu'
import { bindingKey, validateManifest } from './manifest.js'
import { createRoomMaterial } from './materials.js'
import { createTextureSampling } from './texture-sampling.js'

/** Load, integrity-check, bind, and instance one room. Cleans up partially failed loads. */
export async function loadRoomAssets({ resources, manifestUrl, signal, sampling = {} }) {
  const base = new URL(manifestUrl, globalThis.location.href)
  const response = await fetch(base, { signal })
  if (!response.ok)
    throw new Error(`[Room assets] Manifest HTTP ${response.status}: ${base}`)
  const manifest = await response.json()
  const { bindings } = validateManifest(manifest)
  const prefix = `room:${manifest.id}:${manifest.model.sha256}`
  const modelName = `${prefix}:model`
  const entries = [
    {
      name: modelName,
      type: 'gltf',
      url: new URL(manifest.model.url, base).href,
      options: { sha256: manifest.model.sha256 },
    },
    ...manifest.atlases.map(page => ({
      name: `${prefix}:${page.id}`,
      type: 'exr',
      url: new URL(page.url, base).href,
      options: { sha256: page.sha256, atlasMaxMipLevel: sampling.atlasMaxMipLevel ?? 2, signal },
    })),
  ]
  const materials = new Set()
  const samplers = createTextureSampling(sampling)
  let root
  let disposed = false
  const dispose = () => {
    if (disposed)
      return
    disposed = true
    root?.removeFromParent()
    for (const material of materials)
      material.dispose()
    samplers.dispose()
    for (const entry of entries)
      resources.unload(entry.name)
  }
  signal?.addEventListener('abort', dispose, { once: true })
  try {
    await resources.load(entries)
    signal?.throwIfAborted()
    const gltf = resources.get(modelName, 'gltf')
    // Stamp associations on the TEMPLATE before cloning: SkeletonUtils clones userData,
    // but GLTFLoader's association WeakMap is tied to the original objects.
    gltf.scene.traverse((object) => {
      if (!object.isMesh)
        return
      const association = gltf.parser.associations.get(object)
      let ancestor = object
      while (ancestor && !ancestor.userData.rangeRoomId)
        ancestor = ancestor.parent
      if (!ancestor || !Number.isInteger(association?.meshes) || !Number.isInteger(association?.primitives))
        throw new Error(`[Room assets] No stable glTF association for ${object.name}`)
      object.userData.roomBinding = { receiverId: ancestor.userData.rangeRoomId, meshIndex: association.meshes, primitiveIndex: association.primitives }
    })
    root = resources.instantiate(modelName)
    const atlases = new Map(manifest.atlases.map((page) => {
      const atlas = resources.get(`${prefix}:${page.id}`, 'exr')
      if (atlas.image.width !== page.width || atlas.image.height !== page.height)
        throw new Error(`[Room assets] ${page.id}: texture dimensions mismatch`)
      return [
        page.id,
        samplers.atlas(atlas),
      ]
    }))
    const consumed = new Set()
    const counts = { 'baked-appearance': 0, 'realtime': 0, 'fixture-emissive': 0 }
    const materialCache = new Map()
    const recipes = new Map()
    root.traverse((object) => {
      if (object.isLight) {
        object.visible = false
        return
      }
      if (!object.isMesh)
        return
      const key = bindingKey(object.userData.roomBinding ?? {})
      const binding = bindings.get(key)
      if (!binding || consumed.has(key))
        throw new Error(`[Room assets] Missing or duplicate receiver ${object.name}: ${key}`)
      if (Array.isArray(object.material))
        throw new TypeError(`[Room assets] Expected a glTF primitive material: ${key}`)
      if (binding.mode === 'baked-appearance') {
        const attribute = binding.uvChannel === 0
          ? 'uv'
          : `uv${binding.uvChannel}`
        if (!object.geometry.hasAttribute(attribute))
          throw new Error(`[Room assets] ${key}: missing ${attribute} for ${binding.atlasId}`)
      }
      const cacheKey = `${object.material.uuid}:${binding.mode}:${binding.atlasId ?? ''}:${binding.uvChannel ?? ''}`
      if (!materialCache.has(cacheKey)) {
        const replacement = createRoomMaterial(object.material, binding, atlases)
        samplers.material(replacement)
        materialCache.set(cacheKey, replacement)
        recipes.set(cacheKey, { source: object.material, binding })
        materials.add(replacement)
      }
      object.material = materialCache.get(cacheKey)
      object.castShadow = binding.mode !== 'fixture-emissive'
      object.receiveShadow = binding.mode === 'realtime'
      consumed.add(key)
      counts[binding.mode]++
    })
    if (consumed.size !== bindings.size)
      throw new Error(`[Room assets] ${bindings.size - consumed.size} manifest receivers absent from model`)
    root.updateMatrixWorld(true)
    const bounds = new THREE.Box3().setFromObject(root)
    return {
      root,
      manifest,
      counts,
      bounds,
      atlases,
      samplers,
      enableCorridorLighting(corridor) {
        const replacements = new Map()
        for (const [key, recipe] of recipes) {
          if (recipe.binding.mode !== 'baked-appearance')
            continue
          const old = materialCache.get(key)
          const material = createRoomMaterial(recipe.source, recipe.binding, atlases, corridor)
          samplers.material(material)
          materials.add(material)
          replacements.set(old, material)
          materialCache.set(key, material)
        }
        root.traverse((object) => {
          if (object.isMesh && replacements.has(object.material))
            object.material = replacements.get(object.material)
        })
        for (const old of replacements.keys()) {
          materials.delete(old)
          old.dispose()
        }
      },
      dispose() {
        signal?.removeEventListener('abort', dispose)
        dispose()
      },
    }
  }
  catch (error) {
    signal?.removeEventListener('abort', dispose)
    dispose()
    throw error
  }
}
