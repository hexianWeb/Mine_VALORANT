import { renderGroup, uniform, vec3 } from 'three/tsl'
import { PhysicalLightingModel } from 'three/webgpu'

/**
 * Split the native IBL outputs, including clearcoat/sheen and specular multiscattering.
 * Scaling iblIrradiance alone would also change metallic specular multiscattering.
 */
class SplitEnvironmentLightingModel extends PhysicalLightingModel {
  constructor(controls, material) {
    super(material.useClearcoat, material.useSheen, material.useIridescence, material.useAnisotropy, material.useTransmission, material.useDispersion, material.useRetroreflection, material.useDiffuseRoughness)
    this.controls = controls
  }

  indirectSpecular(builder) {
    const reflected = builder.context.reflectedLight
    const isolated = {
      ...reflected,
      indirectDiffuse: vec3(0).toVar(),
      indirectSpecular: vec3(0).toVar(),
    }
    const sheen = this.sheenSpecularIndirect
    const clearcoat = this.clearcoatSpecularIndirect
    builder.context.reflectedLight = isolated
    if (this.sheen)
      this.sheenSpecularIndirect = vec3(0).toVar()
    if (this.clearcoat)
      this.clearcoatSpecularIndirect = vec3(0).toVar()
    try {
      super.indirectSpecular(builder)
      reflected.indirectDiffuse.addAssign(isolated.indirectDiffuse.mul(this.controls.diffuse))
      reflected.indirectSpecular.addAssign(isolated.indirectSpecular.mul(this.controls.specular))
      if (this.sheen)
        sheen.addAssign(this.sheenSpecularIndirect.mul(this.controls.specular))
      if (this.clearcoat)
        clearcoat.addAssign(this.clearcoatSpecularIndirect.mul(this.controls.specular))
    }
    finally {
      builder.context.reflectedLight = reflected
      this.sheenSpecularIndirect = sheen
      this.clearcoatSpecularIndirect = clearcoat
    }
  }
}

export function createProbeEnvironment() {
  // Shared lighting-model uniforms must update per render, rather than being
  // captured in a material's object-uniform bindings during shader compilation.
  const controls = {
    diffuse: uniform(1).setGroup(renderGroup),
    specular: uniform(1).setGroup(renderGroup),
  }
  const originals = new Map()
  return {
    update(diffuse, specular) {
      controls.diffuse.value = diffuse
      controls.specular.value = specular
    },
    bindRoot(root) {
      root.traverse((object) => {
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material]
        for (const material of materials) {
          if (!material?.isMeshStandardNodeMaterial || originals.has(material))
            continue
          originals.set(material, { setupLightingModel: material.setupLightingModel, customProgramCacheKey: material.customProgramCacheKey })
          const originalKey = material.customProgramCacheKey
          material.customProgramCacheKey = function () {
            return `${originalKey.call(this)}:split-room-ibl-v1:${controls.diffuse.id}:${controls.specular.id}`
          }
          material.setupLightingModel = function () {
            return new SplitEnvironmentLightingModel(controls, this)
          }
          material.needsUpdate = true
        }
      })
    },
    dispose() {
      for (const [material, original] of originals) {
        Object.assign(material, original)
        material.needsUpdate = true
      }
      originals.clear()
    },
  }
}
