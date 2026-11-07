import { dFdx, dFdy, Fn, materialReference, texture, textureSize, uv, vec2 } from 'three/tsl'

/** Texel-sharp magnification with continuous gradients for mip/aniso minification. */
export function pixelArtAlbedo(map) {
  return Fn(() => {
    const source = texture(map)
    const coordinates = source.getTransformedUV(uv(map.channel)).toVar()
    const dx = dFdx(coordinates).toVar()
    const dy = dFdy(coordinates).toVar()
    const size = vec2(textureSize(source, 0))
    const footprint = dx.abs().add(dy.abs()).mul(size).clamp(0.00001, 1).toVar()
    const texel = coordinates.mul(size).sub(footprint.mul(0.5)).toVar()
    const edge = texel.fract().sub(footprint.oneMinus()).div(footprint).clamp(0, 1)
    const filteredUV = texel.floor().add(0.5).add(edge).div(size)
    // Differentiating snapped UVs loses the true pixel footprint and reintroduces
    // moire. Use the original transformed UV gradients for mip and anisotropy.
    return texture(map, filteredUV).grad(dx, dy).rgb.mul(materialReference('color', 'color'))
  })()
}
