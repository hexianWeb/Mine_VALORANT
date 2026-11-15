import { Matrix3, Matrix4, Quaternion, Vector3 } from 'three/webgpu'
import { intersectRayBox } from '../../engine/runtime/function/physics/ray-box.js'

const isVector = (value, size = 3) => Array.isArray(value) && value.length === size && value.every(Number.isFinite)

/** Queries the animated pose in the GO's authoritative transform, in world ray units. */
export class BoneHitboxes {
  #root
  #broadphase
  #parts
  #modelToWorld = new Matrix4()
  #worldToModel = new Matrix4()
  #renderToModel = new Matrix4()
  #worldToBox = new Matrix4()
  #linear = new Matrix3()
  #vector = new Vector3()
  #origin = []
  #direction = []

  constructor(root, profile) {
    const broadphase = profile?.broadphase
    if (profile?.schemaVersion !== 1 || profile.hitOrder !== 'nearest' || profile.partSpace !== 'bone-local'
      || profile.units !== 'metres' || profile.up !== 'Y' || profile.rotationOrder !== 'xyzw'
      || broadphase?.space !== 'model-root' || !isVector(broadphase.min) || !isVector(broadphase.max)
      || broadphase.min.some((value, axis) => value >= broadphase.max[axis]) || !profile.parts?.length) {
      throw new Error('[BoneHitboxes] Invalid target profile')
    }
    const bones = new Map()
    root.traverse((node) => {
      if (!node.isBone)
        return
      if (bones.has(node.name))
        throw new Error(`[BoneHitboxes] Ambiguous bone: ${node.name}`)
      bones.set(node.name, node)
    })
    this.#root = root
    this.#broadphase = broadphase
    this.#parts = profile.parts.map(({ bone, region, center, rotation, halfExtents }) => {
      const node = bones.get(bone)
      if (!node || !Object.hasOwn(profile.regions ?? {}, region) || !isVector(center) || !isVector(rotation, 4)
        || Math.abs(Math.hypot(...rotation) - 1) > 1e-3 || !isVector(halfExtents) || halfExtents.some(value => value <= 0)) {
        throw new Error(`[BoneHitboxes] Invalid part: ${bone}`)
      }
      return {
        node,
        region,
        min: halfExtents.map(value => -value),
        max: halfExtents,
        matrix: new Matrix4().compose(new Vector3(...center), new Quaternion(...rotation).normalize(), new Vector3(1, 1, 1)),
      }
    })
  }

  #transformRay(origin, direction, inverse) {
    this.#vector.fromArray(origin).applyMatrix4(inverse).toArray(this.#origin)
    this.#linear.setFromMatrix4(inverse)
    // Keep the original ray parameter when a target is scaled.
    this.#vector.fromArray(direction).applyMatrix3(this.#linear).toArray(this.#direction)
  }

  trace(origin, direction, transform, limit) {
    this.#modelToWorld.compose(transform.position, transform.quaternion, transform.scale)
    this.#worldToModel.copy(this.#modelToWorld).invert()
    this.#transformRay(origin, direction, this.#worldToModel)
    if (!intersectRayBox(this.#origin, this.#direction, this.#broadphase, limit))
      return null

    this.#root.updateWorldMatrix(true, true)
    this.#renderToModel.copy(this.#root.matrixWorld).invert()
    let nearest = limit
    let hit = null
    for (const part of this.#parts) {
      this.#worldToBox.multiplyMatrices(this.#renderToModel, part.node.matrixWorld)
        .multiply(part.matrix)
        .premultiply(this.#modelToWorld)
        .invert()
      this.#transformRay(origin, direction, this.#worldToBox)
      const entry = intersectRayBox(this.#origin, this.#direction, part, nearest)
      if (!entry || entry.distance >= nearest)
        continue
      nearest = entry.distance
      const normal = entry.axis === -1
        ? direction.map(value => -value || 0)
        : this.#vector.set(0, 0, 0).setComponent(entry.axis, -Math.sign(this.#direction[entry.axis])).applyMatrix3(this.#linear.transpose()).normalize().toArray()
      hit = { distance: nearest, region: part.region, normal }
    }
    return hit
  }
}
