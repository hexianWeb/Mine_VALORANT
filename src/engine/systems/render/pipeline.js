import { denoise } from 'three/addons/tsl/display/DenoiseNode.js'
import { ao } from 'three/addons/tsl/display/GTAONode.js'
import { lut3D } from 'three/addons/tsl/display/Lut3DNode.js'
import { smaa } from 'three/addons/tsl/display/SMAANode.js'
import { builtinAOContext, convertToTexture, Fn, If, pass, renderOutput, texture3D, uniform, vec4 } from 'three/tsl'
import * as THREE from 'three/webgpu'
import { upsampleAO } from './ao-upsample.js'
import { NormalPrepass } from './normal-prepass.js'

/** AO modulates material indirect lighting (including lightMap), never the final image. */
export function buildPipeline(renderer, scene, camera, config, grading = null) {
  if (!['smaa', 'none'].includes(config.aa))
    throw new Error(`[Render pipeline] Unsupported AA mode: ${config.aa}`)
  const owned = new Set()
  const own = (node) => {
    owned.add(node)
    return node
  }
  const pipeline = own(new THREE.RenderPipeline(renderer))
  const scenePass = own(pass(scene, camera, { samples: 0 }))
  scenePass.name = 'Scene HDR color'
  let settings = config
  let prePass = null
  let aoPass = null
  let filter = null
  let denoiseTexture = null
  let aaInput = null
  let aoTexture = null
  let aoNode = null
  const reconstructionScale = uniform(1)
  if (config.ao) {
    prePass = own(new NormalPrepass(scene, camera))
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
    aoTexture.value.name = 'GTAO'
    if (config.denoise) {
      filter = own(denoise(aoTexture, depth, normals, camera))
      filter.radius.value = config.denoiseRadius ?? 5
      denoiseTexture = own(convertToTexture(filter, null, null, {
        depthBuffer: false,
        format: THREE.RedFormat,
        type: THREE.HalfFloatType,
        resolutionScale: config.denoiseResolutionScale ?? config.aoResolutionScale,
      }))
      denoiseTexture.name = 'AO denoise'
      aoTexture = denoiseTexture
    }
    reconstructionScale.value = filter
      ? config.denoiseResolutionScale ?? config.aoResolutionScale
      : config.aoResolutionScale
    aoNode = upsampleAO(aoTexture, depth, normals, camera, reconstructionScale)
    scenePass.contextNode = builtinAOContext(aoNode)
  }
  // Tone mapping is linear. SMAA's neighborhood blending must precede sRGB encoding.
  let outputNode = renderOutput(scenePass, null, THREE.LinearSRGBColorSpace)
  if (config.aa === 'smaa' && config.aoView !== 'ao') {
    aaInput = own(convertToTexture(outputNode, null, null, { depthBuffer: false }))
    aaInput.name = 'Tone mapping (linear)'
    outputNode = own(smaa(aaInput))
  }
  outputNode = renderOutput(outputNode, THREE.NoToneMapping, THREE.SRGBColorSpace)
  let lutNode = null
  let lutTexture = null
  const lutIntensity = uniform(config.lutEnabled && !grading?.isIdentity
    ? config.lutIntensity
    : 0)
  if (grading) {
    lutTexture = texture3D(grading.texture)
    lutNode = own(lut3D(outputNode, lutTexture, grading.size, lutIntensity))
    const display = outputNode
    outputNode = Fn(() => {
      const result = vec4().toVar()
      // A zero mix alone still samples the 3D texture. This uniform branch truly bypasses it.
      If(lutIntensity.greaterThan(0), () => {
        result.assign(lutNode)
      }).Else(() => {
        result.assign(display)
      })
      return result
    })()
  }
  if (config.aoView === 'ao') {
    outputNode = aoNode
      ? vec4(aoNode, aoNode, aoNode, 1)
      : vec4(1)
  }
  pipeline.outputColorTransform = false
  pipeline.outputNode = outputNode
  return {
    render: () => pipeline.render(),
    aoPass,
    updateConfig(next) {
      settings = next
      if (aoPass) {
        aoPass.radius.value = next.aoRadius
        aoPass.thickness.value = next.aoThickness
        aoPass.scale.value = next.aoStrength
        aoPass.resolutionScale = next.aoResolutionScale
        aoPass.samples.value = next.aoSamples
      }
      if (filter) {
        filter.radius.value = next.denoiseRadius
        denoiseTexture.setResolutionScale(next.denoiseResolutionScale ?? next.aoResolutionScale)
      }
      reconstructionScale.value = filter
        ? next.denoiseResolutionScale ?? next.aoResolutionScale
        : next.aoResolutionScale
      lutIntensity.value = next.lutEnabled && !grading?.isIdentity
        ? next.lutIntensity
        : 0
    },
    updateLut(next) {
      if (lutTexture) {
        lutTexture.value = next.texture
        lutNode.size.value = next.size
        lutIntensity.value = settings.lutEnabled && !next.isIdentity
          ? settings.lutIntensity
          : 0
      }
    },
    snapshot() {
      const targetInfo = target => target
        ? {
            id: target.texture.uuid,
            width: target.width,
            height: target.height,
            format: target.texture.format,
            type: target.texture.type,
            depthBuffer: target.depthBuffer,
          }
        : null
      return {
        displayOrder: 'HDR → tone mapping (linear) → SMAA → sRGB → display LUT',
        normals: targetInfo(prePass?.renderTarget),
        normalMaterials: prePass?.materials.size ?? 0,
        scene: targetInfo(scenePass.renderTarget),
        ao: aoPass
          ? {
              width: aoPass.getTextureNode().value.image.width,
              height: aoPass.getTextureNode().value.image.height,
              samples: aoPass.samples.value,
            }
          : null,
        denoise: targetInfo(denoiseTexture?.renderTarget),
        aaInput: targetInfo(aaInput?.renderTarget),
        lutBypassed: lutIntensity.value === 0,
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
        throw new Error('[Render pipeline] Non-finite HDR readback')
      return result
    },
    dispose() {
      for (const node of [...owned].reverse())
        node.dispose?.()
      owned.clear()
    },
  }
}
