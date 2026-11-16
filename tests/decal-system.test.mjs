import assert from 'node:assert/strict'
import test from 'node:test'
import { DataTexture, Matrix4, Quaternion, Scene, Vector3 } from 'three/webgpu'
import { createDecalSystem } from '../src/engine/runtime/index.js'

function decal(x = 0, born = 1) {
  return {
    position: [x, 2, 3],
    normal: [0, 0, 1],
    size: 0.1,
    rotation: 0.7,
    born,
  }
}

test('decal quads follow all six box normals with a small outward offset and local spin', (t) => {
  const scene = new Scene()
  const decals = createDecalSystem({ scene })
  t.after(() => decals.dispose())
  const mesh = scene.children[0]
  const normals = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ]
  decals.emit(normals.map(normal => ({
    ...decal(),
    normal,
  })))
  for (const [index, normal] of normals.entries()) {
    const matrix = new Matrix4()
    mesh.getMatrixAt(index, matrix)
    const position = new Vector3()
    const orientation = new Quaternion()
    const scale = new Vector3()
    matrix.decompose(position, orientation, scale)
    assert.ok(position.distanceTo(new Vector3(0, 2, 3).addScaledVector(new Vector3(...normal), 0.002)) < 1e-6)
    assert.ok(new Vector3(0, 0, 1).applyQuaternion(orientation).distanceTo(new Vector3(...normal)) < 1e-6)
    assert.ok(scale.distanceTo(new Vector3(0.1, 0.1, 1)) < 1e-6)
  }
  assert.equal(mesh.material.depthWrite, false)
  assert.equal(mesh.material.depthTest, true)
  assert.equal(mesh.frustumCulled, false)
  assert.equal(mesh.material.transparent, true)
  assert.equal(mesh.material.positionNode, null, 'birth gating must not overwrite the instance transform')
  assert.ok(mesh.material.maskNode, 'future decals must be hidden without replacing vertex positions')
  assert.deepEqual(decals.snapshot(), {
    capacity: 256,
    written: 6,
    count: 6,
    visible: 0,
  })
})

test('decal capacity is fixed and wraparound uploads only the overwritten slots', (t) => {
  const scene = new Scene()
  const decals = createDecalSystem({ scene, capacity: 3 })
  t.after(() => decals.dispose())
  const mesh = scene.children[0]
  const born = mesh.geometry.getAttribute('decalBorn')
  const attributes = [mesh.instanceMatrix, mesh.instanceColor, born]
  decals.emit([
    decal(1),
    decal(2),
  ])
  for (const attribute of attributes)
    attribute.clearUpdateRanges()
  decals.emit([
    decal(3),
    decal(4),
  ])
  assert.equal(mesh.count, 3)
  const matrix = new Matrix4()
  const xs = Array.from({ length: 3 }, (_, index) => {
    mesh.getMatrixAt(index, matrix)
    return matrix.elements[12]
  })
  assert.deepEqual(xs, [4, 2, 3])
  for (const attribute of attributes) {
    assert.deepEqual(attribute.updateRanges, [
      { start: 2 * attribute.itemSize, count: attribute.itemSize },
      { start: 0, count: attribute.itemSize },
    ])
  }
  for (const attribute of attributes)
    attribute.clearUpdateRanges()
  decals.emit([5, 6, 7, 8, 9].map(x => decal(x, x)))
  assert.equal(mesh.count, 3)
  assert.deepEqual([...born.array], [7, 8, 9])
  for (const attribute of attributes)
    assert.equal(attribute.updateRanges.reduce((sum, range) => sum + range.count, 0), attribute.array.length)
})

test('decals wait for event time, persist indefinitely and release only owned resources', () => {
  const scene = new Scene()
  const map = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
  const decals = createDecalSystem({ scene, map, capacity: 2 })
  const mesh = scene.children[0]
  let textureDisposals = 0
  map.addEventListener('dispose', () => textureDisposals++)
  const resources = [mesh, mesh.geometry, mesh.material]
  const released = []
  for (const resource of resources)
    resource.addEventListener('dispose', () => released.push(resource))
  decals.emit([
    decal(0, 2),
    decal(1, 3),
  ])
  for (const [presentationTime, visible] of [
    [1, 0],
    [2, 1],
    [3, 2],
    [10000, 2],
  ]) {
    decals.flush({ presentationTime })
    assert.equal(decals.snapshot().visible, visible)
  }
  decals.clear()
  assert.equal(mesh.visible, false)
  assert.deepEqual(decals.snapshot(), {
    capacity: 2,
    written: 0,
    count: 0,
    visible: 0,
  })
  decals.emit([
    decal(2, 4),
  ])
  assert.equal(decals.snapshot().count, 1)
  decals.dispose()
  decals.dispose()
  decals.emit([
    decal(),
  ])
  decals.flush({ presentationTime: 10000 })
  assert.equal(mesh.visible, false)
  assert.deepEqual(scene.children, [])
  assert.equal(released.length, resources.length)
  assert.equal(textureDisposals, 0, 'a supplied texture remains caller-owned')
  map.dispose()
})

test('decal systems reject invalid capacities and offsets', () => {
  for (const capacity of [0, -1, 1.5, Infinity]) {
    assert.throws(() => createDecalSystem({
      scene: new Scene(),
      capacity,
    }), RangeError)
  }
  for (const normalOffset of [-1, NaN, Infinity]) {
    assert.throws(() => createDecalSystem({
      scene: new Scene(),
      normalOffset,
    }), RangeError)
  }
})
