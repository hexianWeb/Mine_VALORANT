import { DataUtils } from 'three'

let halfValues

/** 按 alpha 加权的场景线性 HDR mipmap；空白图集纹素不会把色块压暗。 */
export function buildAtlasMips(image, maxLevel = 2) {
  if (!Number.isInteger(maxLevel) || maxLevel < 0 || maxLevel > 16)
    throw new Error('Atlas mip level must be an integer between 0 and 16')
  if (!halfValues)
    halfValues = Float32Array.from({ length: 65536 }, (_, index) => DataUtils.fromHalfFloat(index))
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
          next[offset + channel] = DataUtils.toHalfFloat(value)
        }
        next[offset + 3] = DataUtils.toHalfFloat(weight / 4)
      }
    }
    data = next
    width = nextWidth
    height = nextHeight
    levels.push({ data, width, height })
  }
  return levels
}
