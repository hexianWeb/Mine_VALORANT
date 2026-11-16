import { cameraProjectionMatrix, color, Fn, modelNormalMatrix, modelViewProjection, normalLocal, texture, vec4, viewportSize } from 'three/tsl'
import { BackSide, MeshBasicNodeMaterial, SkinnedMesh, Vector3 } from 'three/webgpu'

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
  const vertexNode = Fn(() => {
    const clip = modelViewProjection.toVar()
    const projectedNormal = cameraProjectionMatrix.mul(vec4(modelNormalMatrix.mul(normalLocal), 0))
      .xy
      .mul(viewportSize)
      .toVar()
    const direction = projectedNormal.div(projectedNormal.length().max(1e-6))
    // Twice the pixel width maps to NDC, independent of distance and target scale.
    clip.xy.addAssign(direction.mul(8).div(viewportSize).mul(clip.w))
    return clip
  })()
  const materialFor = (source) => {
    if (!materials.has(source)) {
      const material = new MeshBasicNodeMaterial({
        name: 'Training bot outline',
        color: 0x7A56A0,
        side: BackSide,
        depthWrite: false,
        fog: false,
        alphaTest: source.alphaTest,
        alphaMap: source.alphaMap,
        opacity: source.opacity,
      })
      material.vertexNode = vertexNode
      // Preserve texture cutouts without tinting the outline with the albedo.
      material.colorNode = source.map
        ? vec4(color(0x7A56A0), texture(source.map).a)
        : color(0x7A56A0)
      materials.set(source, material)
    }
    return materials.get(source)
  }
  return {
    attach(mesh) {
      if (!geometries.has(mesh.geometry))
        geometries.set(mesh.geometry, outlineGeometry(mesh.geometry))
      const material = Array.isArray(mesh.material)
        ? mesh.material.map(materialFor)
        : materialFor(mesh.material)
      const shell = new SkinnedMesh(geometries.get(mesh.geometry), material)
      shell.name = `${mesh.name}:outline`
      shell.bindMode = mesh.bindMode
      shell.bind(mesh.skeleton, mesh.bindMatrix)
      shell.renderOrder = mesh.renderOrder + 1
      // Expanded screen-space bounds must not use the unexpanded mesh bounds.
      shell.frustumCulled = false
      shell.raycast = () => {}
      mesh.add(shell)
    },
    dispose() {
      for (const geometry of geometries.values()) geometry.dispose()
      for (const material of materials.values()) material.dispose()
      geometries.clear()
      materials.clear()
    },
  }
}
