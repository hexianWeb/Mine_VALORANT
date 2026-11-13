import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three/webgpu'
import { reflectionCubeFromBytes } from '../src/game/range-room/lighting/reflection-data.js'
import { createReflectionPreview } from '../src/game/range-room/lighting/reflection-preview.js'

function fixture() {
  const size = 2
  const bytes = new ArrayBuffer(6 * size * size * 8)
  const values = new DataView(bytes)
  for (let i = 0; i < bytes.byteLength / 2; i++)
    values.setUint16(i * 2, THREE.DataUtils.toHalfFloat(i / 16), true)
  return reflectionCubeFromBytes(bytes, size)
}

test('raw preview packs all six HDR faces without changing pixels or their row order', () => {
  const cube = fixture()
  const originals = cube.images.map(face => face.image.data.slice())
  const preview = createReflectionPreview(cube)
  const { data, width, height } = preview.texture.image
  assert.equal(width, 6)
  assert.equal(height, 4)
  assert.equal(preview.texture.type, THREE.HalfFloatType)
  assert.equal(preview.texture.colorSpace, THREE.LinearSRGBColorSpace)
  assert.equal(preview.texture.flipY, false)
  assert.equal(preview.texture.generateMipmaps, false)
  assert.equal(preview.texture.minFilter, THREE.NearestFilter)
  const order = [1, 2, 4, 0, 3, 5]
  for (const [tile, face] of order.entries()) {
    for (let y = 0; y < 2; y++) {
      const offset = ((Math.floor(tile / 3) * 2 + y) * width + (tile % 3) * 2) * 4
      assert.deepEqual(data.slice(offset, offset + 8), originals[face].slice(y * 8, y * 8 + 8))
    }
    assert.deepEqual(cube.images[face].image.data, originals[face])
  }
  assert.ok(Array.from(data).some(value => THREE.DataUtils.fromHalfFloat(value) > 1), 'HDR must not be clamped to display colors')
  const { root } = preview
  assert.equal(root.geometry.type, 'PlaneGeometry')
  assert.equal(root.material.isMeshBasicNodeMaterial, true)
  assert.equal(root.castShadow, false)
  assert.equal(root.receiveShadow, false)
  assert.deepEqual(root.position.toArray(), [0.5, 11.8, 5.5])
  assert.equal(root.rotation.y, Math.PI)
  assert.deepEqual(preview.getDebugState().layout, [
    ['+X', '+Y', '+Z'],
    ['-X', '-Y', '-Z'],
  ])
  assert.equal(preview.getDebugState().pmrem, false)
  assert.equal(preview.getDebugState().gain, 1)
  assert.equal(preview.getDebugState().captures, 0)
  preview.dispose()
  cube.dispose()
  for (const face of cube.images) face.dispose()
})

test('preview disposal removes only its own plane and resources, not the source cube', () => {
  const cube = fixture()
  const preview = createReflectionPreview(cube)
  const scene = new THREE.Scene()
  scene.add(preview.root)
  let ownedDisposals = 0
  let borrowedDisposals = 0
  for (const owned of [preview.texture, preview.root.geometry, preview.root.material])
    owned.addEventListener('dispose', () => ownedDisposals++)
  for (const borrowed of [cube, ...cube.images])
    borrowed.addEventListener('dispose', () => borrowedDisposals++)
  preview.dispose()
  preview.dispose()
  assert.equal(scene.children.length, 0)
  assert.equal(ownedDisposals, 3)
  assert.equal(borrowedDisposals, 0)
  assert.equal(preview.getDebugState().ready, false)
  cube.dispose()
  for (const face of cube.images) face.dispose()
})
