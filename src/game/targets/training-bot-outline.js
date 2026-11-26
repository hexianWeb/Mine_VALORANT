import { cameraProjectionMatrix, color, float, Fn, mix, modelNormalMatrix, modelViewProjection, normalLocal, texture, uniform, vec3, vec4, viewportSize } from 'three/tsl'
import { BackSide, LessDepth, MeshBasicNodeMaterial, SkinnedMesh, Vector3 } from 'three/webgpu'
import { flowForegroundMRT } from '../../engine/runtime/function/render/passes/flow-effect.js'

const maxOutlineWidth = 0.035 // World units, narrow enough for the rig's smallest parts.
const maxOutlinePixels = 4

// Weld only the outline normals, including skin weights in the key so joints
// remain independent. The original cuboid shading, UVs and topology stay intact.
function outlineGeometry(source) {
  const geometry = source.clone()
  const { position, normal, skinIndex, skinWeight } = geometry.attributes
  const groups = new Map()
  const keys = []
  const vector = new Vector3()
  for (let i = 0; i < position.count; i++) {
    const key = [
      ...[0, 1, 2].map(axis => Math.round(position.getComponent(i, axis) * 1e5)),
      ...[0, 1, 2, 3].map(axis => skinIndex.getComponent(i, axis)),
      ...[0, 1, 2, 3].map(axis => skinWeight.getComponent(i, axis)),
    ].join(':')
    keys.push(key)
    if (!groups.has(key))
      groups.set(key, new Vector3())
    groups.get(key).add(vector.fromBufferAttribute(normal, i))
  }
  for (let i = 0; i < normal.count; i++) {
    vector.copy(groups.get(keys[i]))
    if (vector.lengthSq() > 1e-10) {
      vector.normalize()
      normal.setXYZ(i, vector.x, vector.y, vector.z)
    }
  }
  return geometry
}

/** Level-owned shared GPU data; shells reuse each instance's animated skeleton. */
export function createTrainingBotOutline() {
  const geometries = new Map()
  const materials = new Map()
  const flowGlow = uniform(0)
  const vertexNode = Fn(() => {
    const clip = modelViewProjection.toVar()
    const viewNormal = modelNormalMatrix.mul(normalLocal).normalize()
    const projectionScale = cameraProjectionMatrix.element(1).y.mul(viewportSize.y).mul(0.5)
    const glow = flowGlow.clamp(0, 1)
    const pixels = float(maxOutlinePixels).add(flowGlow.mul(3.5))
    const maxWorld = float(maxOutlineWidth).add(flowGlow.mul(0.032))
    const width = clip.w.max(0).mul(pixels).div(projectionScale).min(maxWorld)
    // During Flow glow, keep XY silhouette expansion slightly behind the bot body (-Z in view space)
    // so wider outlines form a clean unbroken halo without poking through cuboid limb seams.
    const viewOffset = vec3(
      viewNormal.x.mul(width),
      viewNormal.y.mul(width),
      mix(viewNormal.z.mul(width), float(-0.035), glow),
    )
    return clip.add(cameraProjectionMatrix.mul(vec4(viewOffset, 0)))
  })()
  const materialFor = (source, outlineColor) => {
    const key = `${source.uuid}:${outlineColor}`
    if (!materials.has(key)) {
      const material = new MeshBasicNodeMaterial({
        name: 'Training bot outline',
        color: outlineColor,
        side: BackSide,
        depthFunc: LessDepth,
        depthWrite: false,
        fog: false,
        alphaTest: source.alphaTest,
        alphaMap: source.alphaMap,
        opacity: source.opacity,
      })
      material.vertexNode = vertexNode
      material.mrtNode = flowForegroundMRT
      // Preserve texture cutouts without tinting the outline with the albedo.
      const baseColor = color(outlineColor)
      material.colorNode = source.map
        ? vec4(baseColor, texture(source.map).a)
        : baseColor
      materials.set(key, material)
    }
    return materials.get(key)
  }
  const outlineMaterials = (source, outlineColor) => Array.isArray(source)
    ? source.map(material => materialFor(material, outlineColor))
    : materialFor(source, outlineColor)
  return {
    setFlowGlow(value) {
      flowGlow.value = Number.isFinite(value)
        ? Math.max(0, Math.min(1.5, value))
        : 0
    },
    attach(mesh, outlineColor = 0x7A56A0) {
      if (!geometries.has(mesh.geometry))
        geometries.set(mesh.geometry, outlineGeometry(mesh.geometry))
      const shell = new SkinnedMesh(geometries.get(mesh.geometry), outlineMaterials(mesh.material, outlineColor))
      shell.name = `${mesh.name}:outline`
      shell.bindMode = mesh.bindMode
      shell.bind(mesh.skeleton, mesh.bindMatrix)
      shell.renderOrder = mesh.renderOrder + 1
      // Expanded screen-space bounds must not use the unexpanded mesh bounds.
      shell.frustumCulled = false
      shell.raycast = () => {}
      mesh.add(shell)
      return (nextColor) => {
        shell.material = outlineMaterials(mesh.material, nextColor)
      }
    },
    dispose() {
      for (const geometry of geometries.values()) geometry.dispose()
      for (const material of materials.values()) material.dispose()
      geometries.clear()
      materials.clear()
    },
  }
}
