// @ts-check
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'
import * as THREE from 'three/webgpu'
import { decodeEXR } from './decode-exr.js'

/**
 * @typedef {object} GLTF
 * @property {THREE.Group} scene 共享的模型模板
 * @property {THREE.AnimationClip[]} animations 模型动画片段
 * @property {THREE.Camera[]} cameras 导出的参考相机
 * @property {Record<string, any>} userData 导出的元数据
 * @property {any} parser GLTFLoader 的图元关联，用于稳定的房间绑定
 */

/**
 * 资源类型，以及 `ResourceManager.get()` 对它的返回值。
 *
 * @typedef {object} AssetTypeMap
 * @property {THREE.Texture} texture 颜色纹理默认 sRGB
 * @property {THREE.CubeTexture} cubeTexture url 为 6 个地址 [px, nx, py, ny, pz, nz]
 * @property {THREE.DataTexture} hdr 等距柱状，mapping 已设为 scene.environment 可用
 * @property {THREE.DataTexture} exr 场景线性半精度表面纹理（不是环境贴图）
 * @property {GLTF} gltf 解析后的模型及其关联
 * @property {any} json 解析后的 JSON
 */

/** @typedef {keyof AssetTypeMap} AssetType */

/**
 * @typedef {object} AssetEntry
 * @property {string} name `get(name)` 使用的唯一键
 * @property {AssetType} type 已注册的加载器类型
 * @property {string | string[]} url 相对 `public/`（从站点根提供）
 * @property {{ colorSpace?: string, sha256?: string, atlasMaxMipLevel?: number, signal?: AbortSignal }} [options] 完整性、采样与取消
 */

/**
 * 每种资源类型一个加载函数。要支持新类型，在这里和 AssetTypeMap 各加一个键，
 * 并在 `disposeAsset`（resources.js）里处理它的 GPU 清理。
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
    const parsed = await decodeEXR(data, { maxMipLevel: entry.options?.atlasMaxMipLevel ?? 0, signal: entry.options?.signal })
    const texture = new THREE.DataTexture(parsed.data, parsed.width, parsed.height, parsed.format, parsed.type)
    texture.colorSpace = parsed.colorSpace
    texture.flipY = false
    texture.generateMipmaps = false
    texture.mipmaps = parsed.mipmaps
    texture.userData.decode = { worker: parsed.worker, milliseconds: parsed.decodeMs }
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
