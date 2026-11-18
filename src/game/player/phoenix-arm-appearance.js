// The generated image is a character asset, independent of each weapon's published skin.
// Rectangles are inset from the generated islands' transparent edges, in image pixels.
const islands = new Map([
  [
    '0,0',
    [10, 8, 98, 380],
  ],
  [
    '4,0',
    [101, 8, 204, 380],
  ],
  [
    '8,0',
    [207, 8, 311, 380],
  ],
  [
    '0,12',
    [10, 384, 97, 736],
  ],
  [
    '16,0',
    [316, 8, 410, 114],
  ],
  [
    '16,4',
    [316, 127, 410, 225],
  ],
])
const indices = [
  0,
  1,
  2,
  1,
  3,
  2,
  4,
  5,
  6,
  5,
  7,
  6,
  8,
  9,
  10,
  9,
  11,
  10,
  12,
  13,
  14,
  13,
  15,
  14,
  16,
  17,
  18,
  17,
  19,
  18,
  20,
  21,
  22,
  21,
  23,
  22,
]
const imageSize = 1254

/** Adapt a cloned arm's UVs without modifying the published mesh or its shared geometry. */
export function remapPhoenixArmGeometry(geometry, sourceImage) {
  const sourceSize = sourceImage?.width
  const uv = geometry?.getAttribute('uv')
  const index = geometry?.getIndex()
  const matchesTriangles = () => {
    for (let i = 0; i < indices.length; i += 3) {
      const actual = [
        index.getX(i),
        index.getX(i + 1),
        index.getX(i + 2),
      ].sort((a, b) => a - b)
      const expected = indices.slice(i, i + 3).sort((a, b) => a - b)
      if (actual.some((value, j) => value !== expected[j]))
        return false
    }
    return true
  }
  if (![32, 256].includes(sourceSize) || sourceImage.height !== sourceSize || !uv || uv.count < 24
    || !index || index.count !== indices.length
    || !matchesTriangles()) {
    throw new Error('[PhoenixArms] Unsupported arm geometry or source atlas')
  }
  const mapped = []
  const seen = new Set()
  for (let face = 0; face < 6; face++) {
    const coordinates = Array.from({ length: 4 }, (_, i) => {
      const vertex = face * 4 + i
      return [uv.getX(vertex) * sourceSize, uv.getY(vertex) * sourceSize]
    })
    const minX = Math.round(Math.min(...coordinates.map(point => point[0])))
    const maxX = Math.round(Math.max(...coordinates.map(point => point[0])))
    const minY = Math.round(Math.min(...coordinates.map(point => point[1])))
    const maxY = Math.round(Math.max(...coordinates.map(point => point[1])))
    const key = `${minX},${minY}`
    const target = islands.get(key)
    const expectedHeight = minX === 16
      ? 4
      : 12
    if (!target || seen.has(key) || maxX - minX !== 4 || maxY - minY !== expectedHeight
      || coordinates.some(([x, y]) => (Math.abs(x - minX) > 1e-4 && Math.abs(x - maxX) > 1e-4)
        || (Math.abs(y - minY) > 1e-4 && Math.abs(y - maxY) > 1e-4))) {
      throw new Error('[PhoenixArms] Unsupported arm UV layout')
    }
    seen.add(key)
    for (const [x, y] of coordinates) {
      const u = (x - minX) / (maxX - minX)
      const v = (y - minY) / (maxY - minY)
      mapped.push([(target[0] + u * (target[2] - target[0])) / imageSize, (target[1] + v * (target[3] - target[1])) / imageSize])
    }
  }
  const result = geometry.clone()
  const resultUv = result.getAttribute('uv')
  mapped.forEach(([u, v], i) => resultUv.setXY(i, u, v))
  resultUv.needsUpdate = true
  return result
}

export const phoenixArmAppearance = Object.freeze({
  id: 'phoenix-v1',
  url: new URL('./assets/phoenix-arms-v1.png', import.meta.url).href,
  width: imageSize,
  height: imageSize,
  supports: (request, manifest) => manifest.armContract?.version === 1
    || (request.weaponId === 'karambit' && request.assetVersion === 'v3'),
  remapGeometry: remapPhoenixArmGeometry,
})
