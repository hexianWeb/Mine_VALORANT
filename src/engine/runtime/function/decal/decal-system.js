import { attribute, uniform } from 'three/tsl'
import { Color, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshBasicNodeMaterial, PlaneGeometry, Quaternion, Vector3 } from 'three/webgpu'
import { Disposer } from '../../core/disposer.js'

/**
 * Persistent, unclipped surface quads in a bounded ring. Positions, normals and
 * sizes use world units; the optional texture is borrowed, never disposed here.
 */
export function createDecalSystem({ scene, capacity = 256, map = null, normalOffset = 0.002 }) {
  if (!Number.isSafeInteger(capacity) || capacity < 1)
    throw new RangeError('[Decals] Capacity must be a positive integer')
  if (!Number.isFinite(normalOffset) || normalOffset < 0)
    throw new RangeError('[Decals] Normal offset must be nonnegative and finite')
  const owned = new Disposer()
  const clock = uniform(0)
  const geometry = owned.add(new PlaneGeometry(1, 1))
  const born = new InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(DynamicDrawUsage)
  geometry.setAttribute('decalBorn', born)
  const material = owned.add(new MeshBasicNodeMaterial({
    map,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  }))
  // NodeMaterial applies instanceMatrix BEFORE positionNode. Mask future fragments
  // instead of replacing the instanced position with untransformed geometry.
  material.maskNode = clock.greaterThanEqual(attribute('decalBorn', 'float'))
  const mesh = owned.add(new InstancedMesh(geometry, material, capacity))
  mesh.name = 'Surface decals'
  mesh.instanceMatrix.setUsage(DynamicDrawUsage)
  mesh.setColorAt(0, new Color(0xFFFFFF))
  mesh.instanceColor.setUsage(DynamicDrawUsage)
  mesh.count = 0
  mesh.visible = false
  mesh.frustumCulled = false
  mesh.raycast = () => {}
  owned.add(() => mesh.removeFromParent())
  try {
    scene.add(mesh)
  }
  catch (error) {
    owned.dispose()
    throw error
  }
  const normal = new Vector3()
  const position = new Vector3()
  const scale = new Vector3()
  const forward = new Vector3(0, 0, 1)
  const orientation = new Quaternion()
  const spin = new Quaternion()
  const matrix = new Matrix4()
  let written = 0
  const clear = () => {
    written = 0
    mesh.count = 0
    mesh.visible = false
    for (const attribute of [mesh.instanceMatrix, mesh.instanceColor, born])
      attribute.clearUpdateRanges()
  }
  return {
    emit(decals) {
      if (owned.disposed)
        return
      const previous = written
      for (const decal of decals) {
        const slot = written % capacity
        normal.fromArray(decal.normal).normalize()
        position.fromArray(decal.position).addScaledVector(normal, normalOffset)
        orientation.setFromUnitVectors(forward, normal)
          .multiply(spin.setFromAxisAngle(forward, decal.rotation ?? 0))
        scale.set(decal.size, decal.size, 1)
        mesh.setMatrixAt(slot, matrix.compose(position, orientation, scale))
        mesh.setColorAt(slot, new Color(decal.color ?? 0xFFFFFF))
        born.setX(slot, decal.born)
        written++
      }
      const count = Math.min(written - previous, capacity)
      if (!count)
        return
      const first = (written - count) % capacity
      const firstCount = Math.min(count, capacity - first)
      for (const attribute of [mesh.instanceMatrix, mesh.instanceColor, born]) {
        attribute.addUpdateRange(first * attribute.itemSize, firstCount * attribute.itemSize)
        if (firstCount < count)
          attribute.addUpdateRange(0, (count - firstCount) * attribute.itemSize)
        attribute.needsUpdate = true
      }
      mesh.count = Math.min(written, capacity)
    },
    flush({ presentationTime }) {
      clock.value = presentationTime
      mesh.visible = !owned.disposed && mesh.count > 0
    },
    clear,
    snapshot() {
      let visible = 0
      for (let index = 0; index < mesh.count; index++) {
        if (born.getX(index) <= clock.value)
          visible++
      }
      return {
        capacity,
        written,
        count: mesh.count,
        visible,
      }
    },
    dispose() {
      clear()
      owned.dispose()
    },
  }
}
