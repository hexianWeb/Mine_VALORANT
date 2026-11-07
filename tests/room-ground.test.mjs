import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import test from 'node:test'
import * as THREE from 'three/webgpu'
import { createRoomGround } from '../src/world/room-ground.js'

function fixture(t) {
  const bounds = new THREE.Box3(new THREE.Vector3(-25, 7.875, -22), new THREE.Vector3(26, 30.125, 23))
  const quartzTexture = new THREE.Texture({ width: 16, height: 16 })
  const grassTexture = new THREE.Texture({ width: 16, height: 16 })
  const environment = new THREE.Texture()
  const ground = createRoomGround({
    bounds,
    quartzTexture,
    grassTexture,
    environment,
    anisotropy: 8,
  })
  ground.root.updateMatrixWorld(true)
  t.after(() => {
    ground.dispose()
    quartzTexture.dispose()
    grassTexture.dispose()
    environment.dispose()
  })
  return {
    ground,
    bounds,
    quartzTexture,
    grassTexture,
    environment,
  }
}

test('ground partitions the exact room footprint and outer grass without holes or overlapping surfaces', (t) => {
  const { ground, bounds } = fixture(t)
  const original = bounds.clone()
  const s = ground.snapshot()
  assert.deepEqual(s.footprint, {
    min: [-25, -22],
    max: [26, 23],
    size: [51, 45],
  })
  assert.equal(s.height, 7.865)
  assert.equal(s.meshes, 2)
  assert.equal(s.triangles, 10)
  const ray = new THREE.Raycaster()
  for (const [x, z, surface] of [
    [0, 0, 'Quartz'],
    [-24.999, -21.999, 'Quartz'],
    [25.999, 22.999, 'Quartz'],
    [-25.001, 0, 'Grass'],
    [26.001, 0, 'Grass'],
    [0, -22.001, 'Grass'],
    [0, 23.001, 'Grass'],
    [-100, -100, 'Grass'],
    [100, 100, 'Grass'],
    [-100, 100, 'Grass'],
    [100, -100, 'Grass'],
  ]) {
    ray.set(new THREE.Vector3(x, 40, z), new THREE.Vector3(0, -1, 0))
    const hits = ray.intersectObject(ground.root, true)
    assert.equal(hits.length, 1, `${x},${z}: uncovered or overlapping ground`)
    assert.equal(hits[0].object.userData.surface, surface)
    assert.ok(Math.abs(hits[0].point.y - s.height) < 1e-5)
    assert.equal(hits[0].face.normal.y, 1)
  }
  assert.ok(bounds.equals(original), 'Terrain must not expand the room bounds')
  for (const mesh of ground.root.children) {
    const position = mesh.geometry.getAttribute('position')
    const uv = mesh.geometry.getAttribute('uv')
    for (let i = 0; i < position.count; i++) {
      assert.equal(uv.getX(i), position.getX(i))
      assert.equal(uv.getY(i), -position.getZ(i))
    }
  }
})

test('ground keeps original pixel tiles, vanilla plains tint and independent outdoor sky lighting', (t) => {
  const { ground, quartzTexture, grassTexture, environment } = fixture(t)
  for (const mesh of ground.root.children) {
    const { material } = mesh
    const { map } = material
    assert.equal(material.isMeshStandardNodeMaterial, true)
    assert.equal(material.envMap, environment)
    assert.ok(material.lightsNode)
    assert.ok(material.colorNode)
    assert.equal(map.colorSpace, THREE.SRGBColorSpace)
    assert.equal(map.wrapS, THREE.RepeatWrapping)
    assert.equal(map.wrapT, THREE.RepeatWrapping)
    assert.equal(map.generateMipmaps, true)
    assert.equal(map.anisotropy, 8)
    assert.equal(map.minFilter, THREE.LinearMipmapLinearFilter)
    assert.equal(map.magFilter, THREE.LinearFilter)
    assert.notEqual(map, quartzTexture)
    assert.notEqual(map, grassTexture)
  }
  assert.equal(ground.root.getObjectByName('Ground_Grass').material.color.getHex(), 0x91BD59)
  assert.equal(ground.root.getObjectByName('Ground_Quartz').material.color.getHex(), 0xFFFFFF)
  ground.setLightingEnabled(false)
  assert.ok(ground.root.children.every(mesh => mesh.material.envMapIntensity === 0))
  ground.setLightingEnabled(true)
  assert.ok(ground.root.children.every(mesh => mesh.material.envMapIntensity === 1))
})

test('ground disposal is idempotent and leaves shared source textures and environment owned by the resource manager', (t) => {
  const { ground, quartzTexture, grassTexture, environment } = fixture(t)
  const scene = new THREE.Scene()
  scene.add(ground.root)
  let ownedDisposals = 0
  let sharedDisposals = 0
  for (const mesh of ground.root.children) {
    for (const resource of [mesh.geometry, mesh.material, mesh.material.map])
      resource.addEventListener('dispose', () => ownedDisposals++)
  }
  for (const resource of [quartzTexture, grassTexture, environment])
    resource.addEventListener('dispose', () => sharedDisposals++)
  ground.dispose()
  ground.dispose()
  assert.equal(ownedDisposals, 6)
  assert.equal(sharedDisposals, 0)
  assert.equal(scene.children.length, 0)
})

test('vendored terrain PNGs match the pinned vanilla asset hashes and remain 16 by 16', () => {
  const base = new URL('../public/textures/minecraft/', import.meta.url)
  const sources = JSON.parse(fs.readFileSync(new URL('sources.json', base)))
  assert.equal(sources.grassTint.srgb, '#91bd59')
  for (const asset of sources.files) {
    const bytes = fs.readFileSync(new URL(asset.file, base))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256)
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
    assert.equal(bytes.readUInt32BE(16), 16)
    assert.equal(bytes.readUInt32BE(20), 16)
  }
})
