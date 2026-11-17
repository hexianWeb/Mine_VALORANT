import { attribute, uniform } from 'three/tsl'
import { Color, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshBasicNodeMaterial, PlaneGeometry, Quaternion, Vector3 } from 'three/webgpu'
import { Disposer } from '../../core/disposer.js'

function rotateToFront(array, offset) {
  const prefix = array.slice(0, offset)
  array.copyWithin(0, offset)
  array.set(prefix, array.length - offset)
}

/**
 * Surface quads in a bounded ring. Lifetime uses presentation seconds. Positions,
 * normals and sizes use world units. The optional texture is caller-owned.
 */
export function createDecalSystem({ scene, capacity = 256, map = null, normalOffset = 0.002, lifetime = Infinity }) {
  if (!Number.isSafeInteger(capacity) || capacity < 1)
    throw new RangeError('[Decals] Capacity must be a positive integer')
  if (!Number.isFinite(normalOffset) || normalOffset < 0)
    throw new RangeError('[Decals] Normal offset must be nonnegative and finite')
  if (typeof lifetime !== 'number' || !(lifetime > 0))
    throw new RangeError('[Decals] Lifetime must be positive')
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
  const attributes = [mesh.instanceMatrix, mesh.instanceColor, born]
  const deadlines = Number.isFinite(lifetime)
    ? new Float64Array(capacity)
    : null
  let written = 0
  let nextSlot = 0
  let nextExpiry = Infinity
  const upload = (first, count) => {
    const head = Math.min(count, capacity - first)
    for (const attribute of attributes) {
      const size = attribute.itemSize
      attribute.addUpdateRange(first * size, head * size)
      if (head < count)
        attribute.addUpdateRange(0, (count - head) * size)
      attribute.needsUpdate = true
    }
  }
  const expire = (at) => {
    const wrapped = mesh.count === capacity && nextSlot !== 0
    if (wrapped) {
      // Restart the ring at slot zero in insertion order before packing survivors.
      for (const attribute of attributes)
        rotateToFront(attribute.array, nextSlot * attribute.itemSize)
      rotateToFront(deadlines, nextSlot)
    }
    let live = 0
    let firstMoved = wrapped ? 0 : mesh.count
    nextExpiry = Infinity
    for (let slot = 0; slot < mesh.count; slot++) {
      const deadline = deadlines[slot]
      if (deadline <= at)
        continue
      if (live !== slot) {
        firstMoved = Math.min(firstMoved, live)
        for (const { array, itemSize } of attributes)
          array.copyWithin(live * itemSize, slot * itemSize, (slot + 1) * itemSize)
        deadlines[live] = deadline
      }
      nextExpiry = Math.min(nextExpiry, deadline)
      live++
    }
    if (firstMoved < live)
      upload(firstMoved, live - firstMoved)
    mesh.count = live
    nextSlot = live % capacity
  }
  const clear = () => {
    written = 0
    nextSlot = 0
    nextExpiry = Infinity
    mesh.count = 0
    mesh.visible = false
    for (const attribute of attributes)
      attribute.clearUpdateRanges()
  }
  return {
    emit(decals) {
      if (owned.disposed)
        return
      const previous = written
      for (const decal of decals) {
        const slot = nextSlot
        normal.fromArray(decal.normal).normalize()
        position.fromArray(decal.position).addScaledVector(normal, normalOffset)
        orientation.setFromUnitVectors(forward, normal)
          .multiply(spin.setFromAxisAngle(forward, decal.rotation ?? 0))
        scale.set(decal.size, decal.size, 1)
        mesh.setMatrixAt(slot, matrix.compose(position, orientation, scale))
        mesh.setColorAt(slot, new Color(decal.color ?? 0xFFFFFF))
        born.setX(slot, decal.born)
        if (deadlines) {
          const deadline = decal.born + lifetime
          deadlines[slot] = deadline
          nextExpiry = Math.min(nextExpiry, deadline)
        }
        nextSlot = (slot + 1) % capacity
        written++
      }
      const count = Math.min(written - previous, capacity)
      if (!count)
        return
      upload((nextSlot + capacity - count) % capacity, count)
      mesh.count = Math.min(mesh.count + count, capacity)
    },
    flush({ presentationTime }) {
      clock.value = presentationTime
      if (deadlines && presentationTime >= nextExpiry)
        expire(presentationTime)
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
