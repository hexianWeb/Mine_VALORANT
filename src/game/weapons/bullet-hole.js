import { DataTexture, SRGBColorSpace } from 'three/webgpu'

/** Small shared cutout; per-shot rotation and scale live on decal instances. */
export function createBulletHoleTexture() {
  const size = 64
  const pixels = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size * 2 - 1
      const v = (y + 0.5) / size * 2 - 1
      const radius = Math.hypot(u, v)
      const angle = Math.atan2(v, u)
      const edge = 0.72 + 0.055 * Math.sin(angle * 9) + 0.035 * Math.sin(angle * 17 + 1)
      const grain = ((x * 13 + y * 37) % 17) / 17
      const core = radius < 0.32 + 0.025 * Math.sin(angle * 7)
      const shade = core
        ? 18 + grain * 10
        : 75 + grain * 35
      const offset = (y * size + x) * 4
      pixels[offset] = shade
      pixels[offset + 1] = shade * 0.93
      pixels[offset + 2] = shade * 0.85
      pixels[offset + 3] = Math.round(Math.max(0, Math.min(1, (edge - radius) * 20)) * (core ? 255 : 210))
    }
  }
  const texture = new DataTexture(pixels, size, size)
  texture.name = 'Bullet hole cutout'
  texture.colorSpace = SRGBColorSpace
  texture.needsUpdate = true
  return texture
}
