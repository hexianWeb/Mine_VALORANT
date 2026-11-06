// @ts-check
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'
import * as THREE from 'three/webgpu'

/**
 * @typedef {object} GLTF
 * @property {THREE.Group} scene shared model template
 * @property {THREE.AnimationClip[]} animations model animation clips
 * @property {THREE.Camera[]} cameras exported reference cameras
 * @property {Record<string, any>} userData exported metadata
 * @property {any} parser GLTFLoader primitive associations used for stable room bindings
 */

/**
 * Asset type -> what `ResourceManager.get()` returns for it.
 *
 * @typedef {object} AssetTypeMap
 * @property {THREE.Texture} texture color textures default to sRGB
 * @property {THREE.CubeTexture} cubeTexture url = 6 urls [px, nx, py, ny, pz, nz]
 * @property {THREE.DataTexture} hdr equirectangular, mapping already set for scene.environment
 * @property {THREE.DataTexture} exr scene-linear half-float surface texture (not an environment)
 * @property {GLTF} gltf parsed model and associations
 * @property {any} json parsed JSON
 */

/** @typedef {keyof AssetTypeMap} AssetType */

/**
 * @typedef {object} AssetEntry
 * @property {string} name unique key used by `get(name)`
 * @property {AssetType} type registered loader type
 * @property {string | string[]} url relative to `public/` (served at site root)
 * @property {{ colorSpace?: string, sha256?: string }} [options] optional integrity hash; explicit colorSpace for ordinary textures
 */

/**
 * One loader function per asset type. To support a new type, add a key here and in AssetTypeMap,
 * and handle its GPU cleanup in `disposeAsset` (resources.js).
 *
 * @type {{ [K in AssetType]: (entry: AssetEntry, manager: THREE.LoadingManager) => Promise<AssetTypeMap[K]> }}
 */
export const loaders = {
  async texture(entry, manager) {
    const texture = await new THREE.TextureLoader(manager).loadAsync(/** @type {string} */ (entry.url))
    texture.colorSpace = entry.options?.colorSpace ?? THREE.SRGBColorSpace
    return texture
  },

  async cubeTexture(entry, manager) {
    if (!Array.isArray(entry.url) || entry.url.length !== 6)
      throw new Error(`[Resources] cubeTexture "${entry.name}" needs 6 urls`)
    const texture = await new THREE.CubeTextureLoader(manager).loadAsync(/** @type {any} */ (entry.url))
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
  },

  async hdr(entry, manager) {
    const texture = await new HDRLoader(manager).loadAsync(/** @type {string} */ (entry.url))
    texture.mapping = THREE.EquirectangularReflectionMapping
    return texture
  },

  async gltf(entry, manager) {
    const loader = new GLTFLoader(manager)
    if (!entry.options?.sha256)
      return loader.loadAsync(/** @type {string} */ (entry.url))
    const data = await loadCheckedBuffer(entry, manager)
    const base = new URL('.', new URL(/** @type {string} */ (entry.url), globalThis.location.href)).href
    return loader.parseAsync(data, base)
  },

  async exr(entry, manager) {
    const data = await loadCheckedBuffer(entry, manager)
    const parsed = new EXRLoader(manager).setDataType(THREE.HalfFloatType).parse(data)
    const texture = new THREE.DataTexture(parsed.data, parsed.width, parsed.height, parsed.format, parsed.type)
    texture.colorSpace = parsed.colorSpace
    texture.flipY = false
    texture.generateMipmaps = false
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.needsUpdate = true
    return texture
  },

  async json(entry, manager) {
    const loader = new THREE.FileLoader(manager)
    loader.setResponseType('json')
    return loader.loadAsync(/** @type {string} */ (entry.url))
  },
}

/** @param {AssetEntry} entry @param {THREE.LoadingManager} manager */
async function loadCheckedBuffer(entry, manager) {
  const data = /** @type {ArrayBuffer} */ (await new THREE.FileLoader(manager)
    .setResponseType('arraybuffer')
    .loadAsync(/** @type {string} */ (entry.url)))
  if (entry.options?.sha256) {
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', data))
    const hash = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
    if (hash !== entry.options.sha256)
      throw new Error(`[Resources] SHA-256 mismatch for ${entry.url}: expected ${entry.options.sha256}, got ${hash}`)
  }
  return data
}
