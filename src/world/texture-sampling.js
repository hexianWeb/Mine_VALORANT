import * as THREE from 'three/webgpu'
import { buildAtlasMips } from '../engine/resources/atlas-mips.js'
import { pixelArtAlbedo } from './pixel-art-sampling.js'

export { buildAtlasMips } from '../engine/resources/atlas-mips.js'

/** Separate baked radiance and pixel-art albedo filtering; preserve color-space decoding. */
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
        const minifiedAlbedo = property === 'map' && material.userData.roomMode === 'lightmap'
        const key = `map:${source.uuid}:${minifiedAlbedo ? 'pixel-aa' : 'nearest'}`
        if (!owned.has(key)) {
          const texture = source.clone()
          texture.magFilter = minifiedAlbedo ? THREE.LinearFilter : THREE.NearestFilter
          texture.minFilter = minifiedAlbedo ? THREE.LinearMipmapLinearFilter : THREE.NearestFilter
          texture.generateMipmaps = minifiedAlbedo
          texture.mipmaps = []
          // Linear hardware filtering enables WebGPU anisotropy. The albedo node
          // reconstructs sharp pixel-art texels when magnified.
          texture.anisotropy = minifiedAlbedo
            ? Math.max(1, Math.min(16, anisotropy))
            : 1
          texture.userData.sampling = minifiedAlbedo ? 'pixel-art-mip-anisotropic' : 'nearest'
          texture.needsUpdate = true
          owned.set(key, texture)
        }
        material[property] = owned.get(key)
        if (minifiedAlbedo)
          material.colorNode = pixelArtAlbedo(material[property])
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
        mipLevels: texture.generateMipmaps
          ? 1 + Math.floor(Math.log2(Math.max(texture.image.width, texture.image.height)))
          : texture.mipmaps.length || 1,
        sampling: texture.userData.sampling,
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
