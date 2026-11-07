import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three/webgpu'
import { createFloatingTeapot } from '../src/world/floating-teapot.js'
import { createRoomShadows } from '../src/world/room-shadows.js'

test('teapot starts centrally, stays in its interior orbit and resumes without a time jump', () => {
  const center = new THREE.Vector3(0.5, 11.8, 5.5)
  const teapot = createFloatingTeapot({ center })
  assert.deepEqual(teapot.mesh.position.toArray(), center.toArray())
  const startRotation = teapot.mesh.quaternion.clone()
  for (let frame = 0; frame < 3600; frame++) {
    teapot.update(1 / 60)
    const offset = teapot.mesh.position.clone().sub(center)
    assert.ok(Math.abs(offset.x) <= 6.5 && Math.abs(offset.z) <= 4.5)
    assert.ok(Math.abs(offset.y) <= 0.55 + 1e-10)
  }
  assert.ok(startRotation.angleTo(teapot.mesh.quaternion) > 0.1)
  const before = teapot.snapshot()
  teapot.setPaused(true)
  teapot.update(10)
  assert.deepEqual(teapot.snapshot().position, before.position)
  assert.equal(teapot.snapshot().elapsed, before.elapsed)
  teapot.setPaused(false)
  teapot.update(1 / 60)
  assert.ok(teapot.mesh.position.distanceTo(new THREE.Vector3().fromArray(before.position)) < 0.1)
  teapot.dispose()
})

test('teapot motion is frame-rate independent', () => {
  const a = createFloatingTeapot()
  const b = createFloatingTeapot()
  for (let frame = 0; frame < 30 * 8; frame++) a.update(1 / 30)
  for (let frame = 0; frame < 120 * 8; frame++) b.update(1 / 120)
  assert.ok(a.mesh.position.distanceTo(b.mesh.position) < 1e-10)
  assert.ok(a.mesh.quaternion.angleTo(b.mesh.quaternion) < 1e-6)
  a.dispose()
  b.dispose()
})

test('shadow rig restores shared materials and renderer state without disposing room resources', () => {
  const scene = new THREE.Scene()
  const renderer = {
    shadowMap: { enabled: false, type: THREE.BasicShadowMap },
  }
  const geometry = new THREE.PlaneGeometry()
  const baked = new THREE.MeshLambertNodeMaterial()
  baked.userData.roomMode = 'lightmap'
  const realtime = new THREE.MeshStandardNodeMaterial({ alphaTest: 0.5 })
  const fixture = new THREE.MeshBasicNodeMaterial()
  fixture.userData.roomMode = 'fixture-emissive'
  const a = new THREE.Mesh(geometry, baked)
  const b = new THREE.Mesh(geometry, [baked, realtime])
  const c = new THREE.Mesh(geometry, fixture)
  scene.add(a, b, c)
  const rig = createRoomShadows({
    scene,
    renderer,
    roots: [scene],
    position: new THREE.Vector3(0, 10, 0),
    target: new THREE.Vector3(),
  })
  assert.notEqual(a.material, baked)
  assert.equal(b.material[0], a.material)
  assert.equal(b.material[1], realtime)
  assert.equal(b.material[1].alphaTest, 0.5)
  assert.equal(baked.outputNode, null)
  assert.equal(c.castShadow, false)
  assert.equal(c.receiveShadow, false)
  assert.equal(rig.snapshot().casters, 2)
  let cloneDisposals = 0
  let sourceDisposals = 0
  a.material.addEventListener('dispose', () => cloneDisposals++)
  baked.addEventListener('dispose', () => sourceDisposals++)
  rig.setEnabled(false)
  rig.dispose()
  rig.dispose()
  assert.equal(cloneDisposals, 1)
  assert.equal(sourceDisposals, 0)
  assert.equal(a.material, baked)
  assert.deepEqual(b.material, [baked, realtime])
  assert.equal(a.castShadow, false)
  assert.equal(a.receiveShadow, false)
  assert.deepEqual(renderer.shadowMap, { enabled: false, type: THREE.BasicShadowMap })
  assert.equal(scene.children.length, 3)
  geometry.dispose()
  baked.dispose()
  realtime.dispose()
  fixture.dispose()
})
