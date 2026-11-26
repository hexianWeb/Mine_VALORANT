import { lut3D } from 'three/addons/tsl/display/Lut3DNode.js'
import { clamp, convertToTexture, exp, float, Fn, If, mix, mrt, output, smoothstep, texture3D, textureSize, uniform, uv, vec2, vec3, vec4 } from 'three/tsl'

// Keep the ordinary color output when this material is rendered without the Flow attachment.
export const flowForegroundMRT = mrt({
  output,
  keepColor: float(1),
})

// 13-tap 2-ring Gaussian disk (center + 4 inner @ 0.48r + 8 outer @ 1.0r, sigma = 0.62r).
const blurCenterWeight = 0.16288
const blurInnerWeight = 0.12066
const blurOuterWeight = 0.04431
const blurInnerTaps = Object.freeze([
  [0.48, 0],
  [0, 0.48],
  [-0.48, 0],
  [0, -0.48],
])
const blurOuterTaps = Object.freeze(Array.from({ length: 8 }, (_, index) => {
  const angle = (index + 0.5) * Math.PI / 4
  return [
    Math.cos(angle),
    Math.sin(angle),
  ]
}))

const neutralState = Object.freeze({
  active: 0,
  sweepStart: 0,
  sweepEnd: 0,
  edgeX: -1,
  edgeIntensity: 0,
  tintStrength: 0,
  vignette: 0,
  blurPx: 0,
})

/** The display LUT and the animation uniforms are shared across pipeline rebuilds. */
export function createFlowEffectState(lutTexture) {
  const uniforms = Object.fromEntries(
    Object.entries(neutralState).map(([key, value]) => [
      key,
      uniform(value),
    ]),
  )
  return {
    lutTexture,
    uniforms,
    set(changes) {
      if (!changes)
        return
      for (const [key, value] of Object.entries(changes)) {
        if (!Object.hasOwn(uniforms, key))
          continue
        if (!Number.isFinite(value))
          throw new RangeError(`[FlowEffect] ${key} must be finite`)
        uniforms[key].value = value
      }
    },
    reset() {
      for (const [key, value] of Object.entries(neutralState))
        uniforms[key].value = value
    },
    snapshot() {
      return Object.fromEntries(
        Object.entries(uniforms).map(([key, node]) => [key, node.value]),
      )
    },
  }
}

/** Sweep the authored sRGB LUT across the background, with a leading edge, vignette and exit blur. */
export function applyFlowEffect(inputNode, state, backgroundAt) {
  const source = convertToTexture(inputNode, null, null, { depthBuffer: false })
  source.name = 'Flow effect input'
  const lut = state.lutTexture
    ? texture3D(state.lutTexture)
    : null
  const { active, sweepStart, sweepEnd, edgeX, edgeIntensity, tintStrength, vignette, blurPx } = state.uniforms
  const targetUV = source.uvNode || uv()
  const pixelStep = vec2(1).div(textureSize(source))
  const uvMin = vec2(0.0005)
  const uvMax = vec2(0.9995)

  const node = Fn(() => {
    const display = source.sample(targetUV).toVar()
    const rgb = display.rgb.toVar()
    const background = backgroundAt(targetUV)

    If(active.greaterThan(0).and(background.greaterThan(0)), () => {
      // Smooth continuous blur up to ~3.4px during exit; zero extra taps when sharp.
      If(blurPx.greaterThan(0.01), () => {
        const radius = pixelStep.mul(blurPx)
        const sum = display.rgb.mul(blurCenterWeight).toVar()
        const addTap = (ox, oy, weight) => {
          const tapUV = clamp(targetUV.add(radius.mul(vec2(ox, oy))), uvMin, uvMax)
          // Replace foreground taps with the center so the bot and viewmodel cannot bleed into the wall.
          const tap = mix(display.rgb, source.sample(tapUV).rgb, backgroundAt(tapUV))
          sum.addAssign(tap.mul(weight))
        }
        for (const [ox, oy] of blurInnerTaps)
          addTap(ox, oy, blurInnerWeight)
        for (const [ox, oy] of blurOuterTaps)
          addTap(ox, oy, blurOuterWeight)
        rgb.assign(sum)
      })

      // WGSL-safe smoothstep (low < high) for [sweepStart, sweepEnd] horizontal curtain.
      const feather = float(0.022)
      const leftMask = smoothstep(sweepStart.sub(feather), sweepStart.add(feather), targetUV.x)
      const rightMask = smoothstep(sweepEnd.sub(feather), sweepEnd.add(feather), targetUV.x).oneMinus()
      const tintMask = leftMask.mul(rightMask).mul(tintStrength).clamp(0, 1)

      if (lut)
        rgb.assign(lut3D(vec4(rgb, display.a), lut, state.lutTexture.image.width, tintMask).rgb)

      // Luminous ice-blue-white leading edge sweeping across the screen.
      If(edgeIntensity.greaterThan(0.001), () => {
        const dx = targetUV.x.sub(edgeX)
        const coreCoord = dx.div(0.0085)
        const core = exp(coreCoord.mul(coreCoord).negate())
        const trailDx = targetUV.x.sub(edgeX.sub(0.018))
        const trailCoord = trailDx.div(0.036)
        const halo = exp(trailCoord.mul(trailCoord).negate())
        const edgeColor = vec3(0.88, 0.97, 1.0).mul(core.mul(0.88)).add(vec3(0.24, 0.74, 0.98).mul(halo.mul(0.36)))
        rgb.addAssign(edgeColor.mul(edgeIntensity))
      })

      // Breathing dark four-corner vignette with subtle deep-slate tone.
      If(vignette.greaterThan(0.001), () => {
        const centered = targetUV.sub(0.5)
        const dist = centered.mul(vec2(1.16, 1.0)).length()
        const mask = smoothstep(0.28, 0.86, dist)
        const darkFactor = mask.mul(vignette).clamp(0, 0.92)
        rgb.assign(mix(rgb, vec3(0.015, 0.028, 0.048), darkFactor))
      })

      rgb.assign(mix(display.rgb, rgb.clamp(0, 1), background))
    })

    return vec4(rgb, display.a)
  })()

  return { node, source }
}
