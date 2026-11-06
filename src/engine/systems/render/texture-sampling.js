import * as THREE from 'three/webgpu'

let halfValues

/** Limited mip chain: no original pixels/UVs change, and unused transparent texels don't darken chart edges. */
export function buildAtlasMips(image, maxLevel = 2) {
  if (!halfValues) {
    halfValues = Float32Array.from({ length: 65536 }, (_, index) => THREE.DataUtils.fromHalfFloat(index))
  }
  const levels = [image]
  let { data, width, height } = image
  for (let level = 1; level <= maxLevel && width > 1 && height > 1; level++) {
    const nextWidth = Math.max(1, Math.floor(width / 2))
    const nextHeight = Math.max(1, Math.floor(height / 2))
    const next = new Uint16Array(nextWidth * nextHeight * 4)
    for (let y = 0; y < nextHeight; y++) {
      for (let x = 0; x < nextWidth; x++) {
        const a = ((y * 2) * width + x * 2) * 4
        const b = a + 4
        const c = a + width * 4
        const d = c + 4
        const alphaA = halfValues[data[a + 3]]
        const alphaB = halfValues[data[b + 3]]
        const alphaC = halfValues[data[c + 3]]
        const alphaD = halfValues[data[d + 3]]
        const weight = alphaA + alphaB + alphaC + alphaD
        const offset = (y * nextWidth + x) * 4
        for (let channel = 0; channel < 3; channel++) {
          const value = weight > 0
            ? (halfValues[data[a + channel]] * alphaA + halfValues[data[b + channel]] * alphaB + halfValues[data[c + channel]] * alphaC + halfValues[data[d + channel]] * alphaD) / weight
            : 0
          next[offset + channel] = THREE.DataUtils.toHalfFloat(value)
        }
        next[offset + 3] = THREE.DataUtils.toHalfFloat(weight / 4)
      }
    }
    data = next
    width = nextWidth
    height = nextHeight
    levels.push({ data, width, height })
  }
  return levels
}

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
        texture.mipmaps = buildAtlasMips(source.image, atlasMaxMipLevel)
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
      }))
    },
    dispose() {
      for (const texture of owned.values())
        texture.dispose()
      owned.clear()
    },
  }
}
