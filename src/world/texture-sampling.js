import * as THREE from 'three/webgpu'
import { buildAtlasMips } from '../engine/resources/atlas-mips.js'

export { buildAtlasMips } from '../engine/resources/atlas-mips.js'

/** Separate smooth baked radiance from nearest-neighbor voxel surfaces; preserve color-space decoding. */
export function createTextureSampling({ anisotropy = 16, atlasMaxMipLevel = 2 } = {}) {
  const owned = new Map()
  return {
    atlas(source) {
      const key = `atlas:${source.uuid}`
      if (!owned.has(key)) {
        const texture = new THREE.DataTexture(source.image.data, source.image.width, source.image.height, source.format, source.type)
        texture.name = `${source.name}:linear-anisotropic`
        texture.colorSpace = source.colorSpace
        texture.flipY = false
        texture.mipmaps = source.mipmaps.length > atlasMaxMipLevel
          ? source.mipmaps.slice(0, atlasMaxMipLevel + 1)
          : buildAtlasMips(source.image, atlasMaxMipLevel)
        texture.userData.decode = source.userData.decode
        texture.generateMipmaps = false
        texture.minFilter = texture.mipmaps.length > 1
          ? THREE.LinearMipmapLinearFilter
          : THREE.LinearFilter
        texture.magFilter = THREE.LinearFilter
        texture.anisotropy = Math.max(1, Math.min(16, anisotropy))
        texture.needsUpdate = true
        owned.set(key, texture)
      }
      return owned.get(key)
    },
    material(material) {
      for (const [property, source] of Object.entries(material)) {
        if (!source?.isTexture || source.isDataTexture || source.isData3DTexture)
          continue
        const key = `map:${source.uuid}`
        if (!owned.has(key)) {
          const texture = source.clone()
          // Pixel-art source maps must not interpolate adjacent texels or averaged mip levels.
          texture.magFilter = THREE.NearestFilter
          texture.minFilter = THREE.NearestFilter
          texture.generateMipmaps = false
          texture.mipmaps = []
          // WebGPU anisotropic samplers require all three filter modes to be linear.
          texture.anisotropy = 1
          texture.needsUpdate = true
          owned.set(key, texture)
        }
        material[property] = owned.get(key)
      }
    },
    snapshot() {
      return Array.from(owned.values(), texture => ({
        name: texture.name,
        role: texture.isDataTexture ? 'baked-atlas' : 'voxel-surface',
        colorSpace: texture.colorSpace,
        anisotropy: texture.anisotropy,
        magFilter: texture.magFilter,
        minFilter: texture.minFilter,
        mipLevels: texture.mipmaps.length || 1,
        decode: texture.userData.decode,
      }))
    },
    dispose() {
      for (const texture of owned.values())
        texture.dispose()
      owned.clear()
    },
  }
}
