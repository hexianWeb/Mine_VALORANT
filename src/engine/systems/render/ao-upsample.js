import { float, Fn, getViewPosition, If, isBackgroundDepth, screenUV, textureSize, uniform, vec2 } from 'three/tsl'

/** Four-tap joint bilateral reconstruction, evaluated only by actual AO receivers. */
export function upsampleAO(aoTexture, depth, normals, camera, resolutionScale) {
  const inverseProjection = uniform(camera.projectionMatrixInverse)
  return Fn(() => {
    const result = float(1).toVar()
    const uv = screenUV
    const centerDepth = depth.sample(uv).r.toVar()
    If(isBackgroundDepth(centerDepth).not(), () => {
      If(resolutionScale.greaterThanEqual(1), () => {
        result.assign(aoTexture.sample(uv).r)
      }).Else(() => {
        const size = vec2(textureSize(aoTexture, 0)).toConst()
        const pixel = uv.mul(size).sub(0.5).toConst()
        const base = pixel.floor().add(0.5).toConst()
        const fraction = pixel.fract().toConst()
        const centerNormal = normals.sample(uv).rgb.normalize().toConst()
        const centerPosition = getViewPosition(uv, centerDepth, inverseProjection).toConst()
        const tolerance = centerPosition.z.abs().mul(0.002).max(0.02).toConst()
        const total = float(0).toVar()
        const weighted = float(0).toVar()
        for (const [x, y] of [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ]) {
          const sampleUV = base.add(vec2(x, y)).div(size).clamp(vec2(0.5).div(size), vec2(1).sub(vec2(0.5).div(size))).toConst()
          const sampleDepth = depth.sample(sampleUV).r.toVar()
          const position = getViewPosition(sampleUV, sampleDepth, inverseProjection).toConst()
          const normal = normals.sample(sampleUV).rgb.normalize().toConst()
          const spatialX = x
            ? fraction.x
            : fraction.x.oneMinus()
          const spatialY = y
            ? fraction.y
            : fraction.y.oneMinus()
          const spatial = spatialX.mul(spatialY)
          const planeDistance = centerPosition.sub(position).dot(centerNormal).abs()
          const edgeWeight = planeDistance.div(tolerance).negate().exp().mul(centerNormal.dot(normal).max(0).pow(8))
          const weight = isBackgroundDepth(sampleDepth).select(0, spatial.mul(edgeWeight)).toConst()
          weighted.addAssign(aoTexture.sample(sampleUV).r.mul(weight))
          total.addAssign(weight)
        }
        // No matching surface among the low-res taps: use neutral AO, not a neighbor's shadow.
        result.assign(total.greaterThan(0.00001).select(weighted.div(total.max(0.00001)), 1))
      })
    })
    return result
  })()
}
