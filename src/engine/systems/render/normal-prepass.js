import { context, normalView, vec4 } from 'three/tsl'
import * as THREE from 'three/webgpu'

// Keep visibility and geometry semantics, without copying any lighting/BRDF nodes.
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

/** Signed view normals + depth. OPAQUE/MASK only; source materials are never mutated. */
export class NormalPrepass extends THREE.PassNode {
  constructor(scene, camera) {
    super(THREE.PassNode.COLOR, scene, camera, { samples: 0 })
    this.name = 'Normals/depth'
    this.transparent = false
    // Nested same-scene renders must have a distinct render-list key in r187.
    this.lighting = new THREE.Lighting()
    this.lighting.enabled = false
    // The main pass may trigger us while its AO context is active. Never feed AO into its own inputs.
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
    // Background is identified by depth=1; no sky shading is needed for AO.
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
