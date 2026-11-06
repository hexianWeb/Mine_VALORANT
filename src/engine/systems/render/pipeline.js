import { denoise } from 'three/addons/tsl/display/DenoiseNode.js'
import { ao } from 'three/addons/tsl/display/GTAONode.js'
import { lut3D } from 'three/addons/tsl/display/Lut3DNode.js'
import { smaa } from 'three/addons/tsl/display/SMAANode.js'
import { builtinAOContext, convertToTexture, mrt, normalView, pass, renderOutput, screenUV, texture3D, uniform, vec4 } from 'three/tsl'
import * as THREE from 'three/webgpu'

/** An indirect-only AO context: never multiply AO into baked radiance or the final image. */
export function buildPipeline(renderer, scene, camera, config, grading = null) {
  if (!['smaa', 'none'].includes(config.aa))
    throw new Error(`[Room pipeline] Unsupported AA mode: ${config.aa}`)
  const owned = new Set()
  const own = (node) => {
    owned.add(node)
    return node
  }
  const pipeline = own(new THREE.RenderPipeline(renderer))
  const scenePass = own(pass(scene, camera, { samples: 0 }))
  let aoPass = null
  let filter = null
  let aoTexture = null
  if (config.ao) {
    const prePass = own(pass(scene, camera, { samples: 0 }))
    prePass.setMRT(mrt({ output: normalView }))
    const normals = prePass.getTextureNode()
    const depth = prePass.getTextureNode('depth')
    aoPass = own(ao(depth, normals, camera))
    aoPass.resolutionScale = config.aoResolutionScale
    aoPass.radius.value = config.aoRadius
    aoPass.thickness.value = config.aoThickness
    aoPass.scale.value = config.aoStrength
    aoPass.samples.value = config.aoSamples
    aoPass.useTemporalFiltering = false
    aoTexture = aoPass.getTextureNode()
    if (config.denoise) {
      filter = own(denoise(aoTexture, depth, normals, camera))
      filter.radius.value = config.denoiseRadius ?? 5
      aoTexture = own(convertToTexture(filter))
    }
    scenePass.contextNode = builtinAOContext(aoTexture.sample(screenUV).r)
  }
  let outputNode = renderOutput(scenePass)
  let lutNode = null
  let lutTexture = null
  const lutIntensity = uniform(config.lutEnabled ? config.lutIntensity : 0)
  if (grading) {
    lutTexture = texture3D(grading.texture)
    lutNode = own(lut3D(outputNode, lutTexture, grading.size, lutIntensity))
    outputNode = lutNode
  }
  if (config.aoView === 'ao') {
    outputNode = aoTexture
      ? vec4(aoTexture.sample(screenUV).rrr, 1)
      : vec4(1)
  }
  if (config.aa === 'smaa') {
    // Own the conversion RTT explicitly; SMAA does not dispose its input texture.
    const displayTexture = own(convertToTexture(outputNode))
    outputNode = own(smaa(displayTexture))
  }
  pipeline.outputColorTransform = false
  pipeline.outputNode = outputNode
  return {
    render: () => pipeline.render(),
    aoPass,
    updateConfig(next) {
      if (aoPass) {
        aoPass.radius.value = next.aoRadius
        aoPass.thickness.value = next.aoThickness
        aoPass.scale.value = next.aoStrength
        aoPass.resolutionScale = next.aoResolutionScale
      }
      if (filter)
        filter.radius.value = next.denoiseRadius
      lutIntensity.value = next.lutEnabled ? next.lutIntensity : 0
    },
    updateLut(next) {
      if (lutTexture) {
        lutTexture.value = next.texture
        lutNode.size.value = next.size
      }
    },
    async readLinearPixel(x, y) {
      if (config.aoView === 'ao')
        throw new Error('AO-only view does not render a scene HDR target')
      const values = await renderer.readRenderTargetPixelsAsync(scenePass.renderTarget, x, y, 1, 1)
      const result = Array.from(values, value => scenePass.renderTarget.texture.type === THREE.HalfFloatType
        ? THREE.DataUtils.fromHalfFloat(value)
        : value)
      if (!result.every(Number.isFinite))
        throw new Error('[Room pipeline] Non-finite HDR readback')
      return result
    },
    dispose() {
      for (const node of [...owned].reverse())
        node.dispose?.()
      owned.clear()
    },
  }
}
