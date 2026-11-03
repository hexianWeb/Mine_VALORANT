// @ts-check
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'
import * as THREE from 'three/webgpu'

/**
 * @typedef {object} GLTF
 * @property {THREE.Group} scene
 * @property {THREE.AnimationClip[]} animations
 * @property {THREE.Camera[]} cameras
 * @property {Record<string, any>} userData
 */

/**
 * Asset type -> what `ResourceManager.get()` returns for it.
 *
 * @typedef {object} AssetTypeMap
 * @property {THREE.Texture} texture color textures default to sRGB
 * @property {THREE.CubeTexture} cubeTexture url = 6 urls [px, nx, py, ny, pz, nz]
 * @property {THREE.DataTexture} hdr equirectangular, mapping already set for scene.environment
 * @property {GLTF} gltf
 * @property {any} json parsed JSON
 */

/** @typedef {keyof AssetTypeMap} AssetType */

/**
 * @typedef {object} AssetEntry
 * @property {string} name unique key used by `get(name)`
 * @property {AssetType} type
 * @property {string | string[]} url relative to `public/` (served at site root)
 * @property {{ colorSpace?: string }} [options] texture only; use THREE.NoColorSpace for normal/roughness maps
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
    return new GLTFLoader(manager).loadAsync(/** @type {string} */ (entry.url))
  },

  async json(entry, manager) {
    const loader = new THREE.FileLoader(manager)
    loader.setResponseType('json')
    return loader.loadAsync(/** @type {string} */ (entry.url))
  },
}
