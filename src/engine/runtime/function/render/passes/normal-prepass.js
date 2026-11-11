import { context, normalView, vec4 } from 'three/tsl'
import * as THREE from 'three/webgpu'

// 保留可见性与几何语义，不复制任何光照或 BRDF 节点。
const properties = [
  'side',
  'flatShading',
  'vertexColors',
  'opacity',
  'alphaTest',
  'alphaHash',
  'alphaMap',
  'normalMap',
  'normalMapType',
  'normalScale',
  'bumpMap',
  'bumpScale',
  'displacementMap',
  'displacementScale',
  'displacementBias',
  'depthTest',
  'depthFunc',
  'polygonOffset',
  'polygonOffsetFactor',
  'polygonOffsetUnits',
  'clippingPlanes',
  'clipIntersection',
  'positionNode',
  'vertexNode',
  'geometryNode',
  'normalNode',
  'depthNode',
  'maskNode',
  'opacityNode',
  'alphaTestNode',
]

export function syncNormalMaterial(material, source) {
  for (const key of properties) {
    if (source[key] !== undefined)
      material[key] = source[key]
  }
  const cutout = source.alphaTest > 0 || source.alphaHash || (source.alphaTestNode !== null && source.alphaTestNode !== undefined)
  material.map = cutout ? source.map : null
  material.colorNode = cutout
    ? source.colorNode ?? null
    : null
  material.color = source.color ?? material.color
}

/** 带符号的视图空间法线 + 深度。仅 OPAQUE/MASK；源材质从不被修改。 */
export class NormalPrepass extends THREE.PassNode {
  constructor(scene, camera) {
    super(THREE.PassNode.COLOR, scene, camera, { samples: 0 })
    this.name = 'Normals/depth'
    this.transparent = false
    // r187 中嵌套的同场景渲染必须有不同的渲染列表键。
    this.lighting = new THREE.Lighting()
    this.lighting.enabled = false
    // 主通道可能在自己的 AO 上下文仍激活时触发本通道。绝不能把 AO 喂回它自己的输入。
    this.contextNode = context({
      getAO: () => null,
    })
    this.materials = new Map()
  }

  materialFor(source) {
    let record = this.materials.get(source)
    if (!record) {
      const material = new THREE.NodeMaterial()
      material.name = `AO normals:${source.name}`
      material.color = new THREE.Color(1, 1, 1)
      material.lights = false
      material.fog = false
      material.toneMapped = false
      material.outputNode = vec4(normalView, 1)
      const dispose = () => {
        source.removeEventListener('dispose', dispose)
        material.dispose()
        this.materials.delete(source)
      }
      record = { material, version: source.version, dispose }
      this.materials.set(source, record)
      source.addEventListener('dispose', dispose)
    }
    syncNormalMaterial(record.material, source)
    if (record.version !== source.version) {
      record.material.needsUpdate = true
      record.version = source.version
    }
    return record.material
  }

  updateBefore(frame) {
    const { renderer } = frame
    const previous = renderer.getRenderObjectFunction()
    const background = this.scene.background
    // 背景由 depth=1 标识；AO 不需要天空着色。
    this.scene.background = null
    renderer.setRenderObjectFunction((object, scene, camera, geometry, source, ...rest) => {
      if (!object.isMesh || source.transparent || source.depthWrite === false)
        return
      renderer.renderObject(object, scene, camera, geometry, this.materialFor(source), ...rest)
    })
    try {
      super.updateBefore(frame)
    }
    finally {
      renderer.setRenderObjectFunction(previous)
      this.scene.background = background
    }
  }

  dispose() {
    const records = Array.from(this.materials.values())
    for (const record of records)
      record.dispose()
    this.lighting.dispose()
    super.dispose()
  }
}
