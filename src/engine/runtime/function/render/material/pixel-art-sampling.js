import { dFdx, dFdy, Fn, materialReference, texture, textureSize, uv, vec2 } from 'three/tsl'

/** 放大时纹素锐利，缩小的 mip 与各向异性仍用连续梯度。 */
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
    // 对吸附后的 UV 求导会丢掉真实像素足迹，并重新引入
    // 摩尔纹。mip 和各向异性使用原始变换后的 UV 梯度。
    return texture(map, filteredUV).grad(dx, dy).rgb.mul(materialReference('color', 'color'))
  })()
}
