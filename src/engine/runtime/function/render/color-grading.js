import { LUTCubeLoader } from 'three/addons/loaders/LUTCubeLoader.js'
import * as THREE from 'three/webgpu'

export const gradingDefaults = Object.freeze({
  preset: 'cool',
  contrast: 1.03,
  saturation: 1.07,
  temperature: 0,
  tint: 0,
})
export const gradingPresets = Object.freeze({
  中性: 'neutral',
  暖色: 'warm',
  冷色: 'cool',
  柔和电影: 'soft-film',
  导入文件: 'custom',
})
const clamp = value => Math.min(1, Math.max(0, value))

/** RGB 显示域 3D LUT，在线性 SMAA 和 sRGB 编码之后采样。 */
export function createColorGrading() {
  const params = { ...gradingDefaults }
  let custom = null
  let size = 33
  let texture = null
  let disposed = false
  const rebuild = () => {
    if (disposed)
      throw new Error('Color grading has been disposed')
    size = params.preset === 'custom'
      ? custom.size
      : 33
    if (!texture || texture.image.width !== size) {
      texture?.dispose()
      texture = new THREE.Data3DTexture(new Uint16Array(size ** 3 * 4), size, size, size)
      texture.type = THREE.HalfFloatType
      texture.format = THREE.RGBAFormat
      texture.colorSpace = THREE.NoColorSpace
      texture.minFilter = THREE.LinearFilter
      texture.magFilter = THREE.LinearFilter
      texture.generateMipmaps = false
      texture.unpackAlignment = 1
      texture.name = 'Display-domain grading LUT'
    }
    const data = texture.image.data
    const presetTemperature = params.preset === 'warm'
      ? 0.45
      : params.preset === 'cool'
        ? -0.45
        : 0
    const temperature = params.temperature + presetTemperature
    const redGain = 2 ** (temperature * 0.2 + params.tint * 0.08)
    const blueGain = 2 ** (-temperature * 0.2 + params.tint * 0.08)
    const greenGain = 2 ** (-params.tint * 0.16)
    for (let b = 0; b < size; b++) {
      for (let g = 0; g < size; g++) {
        for (let r = 0; r < size; r++) {
          const index = ((b * size + g) * size + r) * 4
          let red = custom && params.preset === 'custom'
            ? custom.data[index]
            : r / (size - 1)
          let green = custom && params.preset === 'custom'
            ? custom.data[index + 1]
            : g / (size - 1)
          let blue = custom && params.preset === 'custom'
            ? custom.data[index + 2]
            : b / (size - 1)
          const luma = red * 0.2126 + green * 0.7152 + blue * 0.0722
          const saturation = params.saturation * (params.preset === 'soft-film'
            ? 0.85
            : 1)
          const contrast = params.contrast * (params.preset === 'soft-film'
            ? 0.9
            : 1)
          red = ((luma + (red - luma) * saturation) * redGain - 0.5) * contrast + 0.5
          green = ((luma + (green - luma) * saturation) * greenGain - 0.5) * contrast + 0.5
          blue = ((luma + (blue - luma) * saturation) * blueGain - 0.5) * contrast + 0.5
          data[index] = THREE.DataUtils.toHalfFloat(clamp(red))
          data[index + 1] = THREE.DataUtils.toHalfFloat(clamp(green))
          data[index + 2] = THREE.DataUtils.toHalfFloat(clamp(blue))
          data[index + 3] = THREE.DataUtils.toHalfFloat(1)
        }
      }
    }
    texture.needsUpdate = true
  }
  rebuild()
  return {
    params,
    get texture() { return texture },
    get size() { return size },
    get customTitle() { return custom?.title ?? '' },
    get isIdentity() {
      return params.preset === 'neutral' && params.contrast === 1 && params.saturation === 1 && params.temperature === 0 && params.tint === 0
    },
    update(changes) {
      if (changes.preset === 'custom' && !custom)
        throw new Error('请先导入 .cube LUT 文件')
      if (changes.preset && !Object.values(gradingPresets).includes(changes.preset))
        throw new Error('未知 LUT 预设')
      const ranges = {
        contrast: [0.5, 1.5],
        saturation: [0, 2],
        temperature: [-1, 1],
        tint: [-1, 1],
      }
      for (const [key, value] of Object.entries(changes)) {
        if (ranges[key] && (!Number.isFinite(value) || value < ranges[key][0] || value > ranges[key][1]))
          throw new Error(`无效调色参数：${key}`)
      }
      Object.assign(params, changes)
      rebuild()
    },
    importCube(text, filename = 'Custom LUT') {
      const sizeMatch = text.match(/^\s*LUT_3D_SIZE\s+(\d+)/m)
      const count = Number(sizeMatch?.[1])
      if (!Number.isInteger(count) || count < 2 || count > 64)
        throw new Error('仅支持 2–64³ 的 3D .cube LUT')
      const lines = text.split(/\r?\n/).map(line => line.split('#')[0].trim()).filter(line => /^[+\-.\d]/.test(line))
      if (lines.length !== count ** 3 || lines.some(line => line.split(/\s+/).length !== 3 || !line.split(/\s+/).every(value => Number.isFinite(Number(value)))))
        throw new Error('LUT 数据行数不匹配或包含无效数值')
      const normalized = text.split(/\r?\n/).map((line) => {
        const value = line.split('#')[0].trim().replace(/\s+/g, ' ')
        return /^[+\-.\d]/.test(value)
          ? value.toLowerCase()
          : value
      }).join('\n')
      const parsed = new LUTCubeLoader().setType(THREE.FloatType).parse(normalized)
      const validDomain = parsed.domainMin.toArray().every(value => value === 0) && parsed.domainMax.toArray().every(value => value === 1)
      if (!validDomain) {
        parsed.texture3D.dispose()
        throw new Error('当前调试管线要求 sRGB 显示域 DOMAIN_MIN 0 / DOMAIN_MAX 1，不直接接受 Log LUT')
      }
      custom = { size: parsed.size, data: parsed.texture3D.image.data, title: parsed.title ?? filename }
      parsed.texture3D.dispose()
      Object.assign(params, gradingDefaults, { preset: 'custom' })
      rebuild()
    },
    reset() {
      Object.assign(params, gradingDefaults)
      rebuild()
    },
    dispose() {
      disposed = true
      texture?.dispose()
    },
  }
}
