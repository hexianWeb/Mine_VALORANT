import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js'
import * as THREE from 'three/webgpu'
import { validateManifest } from '../src/game/range-room/assets/manifest.js'
import { createRoomMaterial } from '../src/game/range-room/assets/materials.js'
import { validateRoomFiles } from '../tools/validate-room-assets.mjs'

const previous = JSON.parse(fs.readFileSync(new URL('../public/lighting/range-room/manifest.json', import.meta.url)))
const manifest = JSON.parse(fs.readFileSync(new URL('../public/lighting/range-room-lightmap/manifest.json', import.meta.url)))

function readGLB(name) {
  const bytes = fs.readFileSync(new URL(`../public/model/${name}.glb`, import.meta.url))
  const length = bytes.readUInt32LE(12)
  return {
    document: JSON.parse(bytes.toString('utf8', 20, 20 + length)),
    binary: bytes.subarray(28 + length),
  }
}

function attributeBytes(glb, binding, name) {
  const primitive = glb.document.meshes[binding.meshIndex].primitives[binding.primitiveIndex]
  const accessor = glb.document.accessors[primitive.attributes[name]]
  const view = glb.document.bufferViews[accessor.bufferView]
  assert.equal(accessor.componentType, 5126)
  assert.equal(view.byteStride, undefined)
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
  const components = accessor.type === 'VEC3'
    ? 3
    : 2
  return glb.binary.subarray(start, start + accessor.count * components * 4)
}

test('lightmaps cover the prebaked receivers and preserve unaffected geometry from the original assets', () => {
  const current = validateRoomFiles('public/lighting/range-room-lightmap/manifest.json')
  const old = validateRoomFiles('public/lighting/range-room/manifest.json')
  const removed = new Set(manifest.verification.modelOnlyUpdate?.removedSinceBake ?? [])
  const retained = {
    ...previous,
    bindings: previous.bindings.filter(b => !removed.has(b.sourceObject)),
  }
  const supplemental = manifest.bake.supplemental ?? []
  const supplementalObjects = new Set(supplemental.flatMap(plan => plan.objects.map(object => object.name)))
  const originalObjects = new Set(previous.bindings.map(binding => binding.sourceObject))
  const additionalBindings = manifest.bindings.filter(binding => !originalObjects.has(binding.sourceObject))
  const additionalObjects = new Set(additionalBindings.map(binding => binding.sourceObject))
  for (const name of removed) {
    assert.ok(previous.verification.exportedObjects.includes(name))
    assert.ok(!manifest.verification.exportedObjects.includes(name))
    assert.ok(!manifest.bindings.some(b => b.sourceObject === name))
  }
  assert.equal(current.primitives, old.primitives - (previous.bindings.length - retained.bindings.length) + additionalBindings.length)
  assert.equal(current.triangles, manifest.verification.sourceTriangles)
  assert.equal(current.counts.lightmap, retained.bindings.filter(b => b.mode === 'baked-appearance').length + additionalBindings.filter(b => b.mode === 'lightmap').length)
  assert.equal(current.counts.realtime, retained.bindings.filter(b => b.mode === 'realtime').length + additionalBindings.filter(b => b.mode === 'realtime').length)
  assert.equal(current.alphaModes.MASK, old.alphaModes.MASK)
  assert.equal(current.alphaModes.BLEND, old.alphaModes.BLEND)
  const receivers = (m, mode) => m.bindings.filter(b => b.mode === mode && !additionalObjects.has(b.sourceObject)).map(b => `${b.sourceObject}/${b.sourceMaterial}/${b.uvChannel}`).sort()
  assert.deepEqual(receivers(manifest, 'lightmap'), receivers(retained, 'baked-appearance'))
  assert.deepEqual(manifest.bake.objects.slice().sort(), Array.from(new Set(manifest.bindings.filter(b => b.mode === 'lightmap').map(b => b.sourceObject))).sort())
  assert.equal(manifest.bake.collection, '预烘焙')
  assert.equal(manifest.bake.geometryAndUVUnchanged, true)
  assert.equal(manifest.bake.uvOwnership.overlappingTexels, 0)
  const translatedObjects = Array.from(new Set((manifest.bake.uvTranslations ?? []).map(entry => entry.object))).sort()
  const sourceGeometry = manifest.bake.sourceGeometryUVHashes ?? manifest.bake.geometryUVHashes
  const uvChanges = Object.entries(manifest.bake.geometryUVHashes)
    .filter(([name, hash]) => hash !== sourceGeometry[name])
    .map(([name]) => name)
    .sort()
  assert.deepEqual(uvChanges, Array.from(new Set([
    ...translatedObjects,
    ...supplementalObjects,
  ])).sort(), 'Only recorded BakeUV repairs or supplemental objects may change during preparation')
  for (const object of ['Double_Stone_Slab', 'Stone_Slab.001']) {
    const bindings = manifest.bindings.filter(b => b.sourceObject === object)
    assert.equal(bindings.length, removed.has(object)
      ? 0
      : 2)
    const page = supplemental.find(plan => plan.objects.some(entry => entry.name === object))?.atlasId ?? 'B05'
    assert.ok(bindings.every(b => b.atlasId === page), `${object}: unexpected atlas page`)
  }
  const oldGLB = readGLB('range-room')
  const newGLB = readGLB('range-room-lightmap')
  const updatedReceivers = new Set([
    ...(manifest.verification.modelUpdate?.changedLightmapReceivers ?? []),
    ...supplementalObjects,
  ])
  for (const binding of manifest.bindings.filter(b => b.mode === 'lightmap')) {
    if (updatedReceivers.has(binding.sourceObject))
      continue
    const oldBinding = previous.bindings.find(b => b.sourceObject === binding.sourceObject && b.sourceMaterial === binding.sourceMaterial)
    for (const attribute of [
      'POSITION',
      'NORMAL',
      'TEXCOORD_0',
      'TEXCOORD_1',
    ])
      assert.ok(attributeBytes(oldGLB, oldBinding, attribute).equals(attributeBytes(newGLB, binding, attribute)), `${binding.sourceObject}: changed ${attribute}`)
  }
})

test('all lightmap pages contain finite nonempty half-float HDR lighting and original albedo remains in GLB', () => {
  for (const page of manifest.atlases) {
    const bytes = fs.readFileSync(new URL(`../public/lighting/range-room-lightmap/atlases/${page.id}.exr`, import.meta.url))
    const parsed = new EXRLoader().setDataType(THREE.HalfFloatType).parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    assert.equal(parsed.width, page.width)
    assert.equal(parsed.height, page.height)
    assert.equal(parsed.colorSpace, THREE.LinearSRGBColorSpace)
    let lit = 0
    // Avoid sampling the same border column on power-of-two atlases of different sizes.
    for (let i = 0; i < parsed.data.length; i += 4092) {
      const value = THREE.DataUtils.fromHalfFloat(parsed.data[i])
      assert.ok(Number.isFinite(value))
      if (value > 0)
        lit++
    }
    assert.ok(lit > 10, page.id)
  }
  const gltf = readGLB('range-room-lightmap').document
  for (const binding of manifest.bindings.filter(b => b.mode === 'lightmap')) {
    const material = gltf.materials[binding.materialIndex]
    assert.ok(material.pbrMetallicRoughness.baseColorTexture, binding.sourceMaterial)
    assert.equal(material.pbrMetallicRoughness.baseColorTexture.texCoord ?? 0, 0)
    assert.ok(!material.extensions?.KHR_materials_unlit)
  }
})

test('supplemental lightmap keeps two tightly packed receivers separate from the original pages', () => {
  const plan = manifest.bake.supplemental?.find(entry => entry.atlasId === 'B06')
  assert.ok(plan)
  assert.deepEqual(plan.objects.map(object => object.name).sort(), ['Stone_Slab.001', 'wall'])
  assert.equal(plan.width, 1024)
  assert.equal(plan.height, 1024)
  assert.equal(plan.margin, 12)
  const page = manifest.atlases.find(entry => entry.id === 'B06')
  assert.equal(page.width, plan.width)
  assert.equal(page.height, plan.height)
  assert.deepEqual(manifest.bake.reusedPages, ['B01', 'B02', 'B03', 'B04', 'B05'])
  assert.deepEqual(manifest.bake.rebakedPages, ['B06'])
  assert.equal(manifest.bake.supplementalBake.padding.overlappingPaddedTexels, 0)
  for (const object of plan.objects) {
    const bindings = manifest.bindings.filter(binding => binding.sourceObject === object.name)
    assert.ok(bindings.length > 0)
    assert.ok(bindings.every(binding => binding.mode === 'lightmap' && binding.atlasId === 'B06' && binding.uvChannel === 1))
    assert.ok(object.uv.length > 0)
  }
  assert.ok(manifest.bindings.filter(binding => binding.atlasId === 'B06').every(binding => ['Stone_Slab.001', 'wall'].includes(binding.sourceObject)))
})

test('a model-only wall resize records that the reused lightmap and probe capture are stale', () => {
  const update = manifest.verification.modelOnlyUpdate
  const cache = JSON.parse(fs.readFileSync(new URL('../public/lighting/range-room-probes/cache.json', import.meta.url)))
  assert.equal(manifest.verification.rebake, false)
  assert.deepEqual(update.changedGeometryUV, ['wall'])
  assert.deepEqual(update.staleLightmapReceivers, ['wall'])
  assert.deepEqual(manifest.verification.explicitStaleLightmapOverride.receivers, ['wall'])
  assert.notEqual(manifest.verification.sourceGeometryUVHashes.wall, manifest.bake.sourceGeometryUVHashes.wall)
  assert.notEqual(manifest.verification.geometryUVHashes.wall, manifest.bake.geometryUVHashes.wall)
  assert.deepEqual(cache.reuse.staleLightmapReceivers, ['wall'])
  assert.notEqual(cache.sourceKey, cache.capturedSourceKey)
})

test('lightmap manifests accept an additional mixed-size page but require it to be referenced', () => {
  const extra = structuredClone(manifest)
  const template = extra.atlases[0]
  extra.atlases.push({
    ...template,
    id: 'B99',
    width: 512,
    height: 512,
  })
  const binding = extra.bindings.find(entry => entry.mode === 'lightmap')
  extra.bindings.push({ ...binding, receiverId: 'supplemental-test', atlasId: 'B99' })
  assert.doesNotThrow(() => validateManifest(extra))
  extra.bindings.pop()
  assert.throws(() => validateManifest(extra), /each atlas must have receivers/)
})

test('reject mixed baked-color/light-only encodings and incorrect irradiance scale', () => {
  for (const change of [
    (m) => { m.bake.color = true },
    (m) => { m.atlases[0].content = 'baked-appearance' },
    (m) => { m.bindings.find(b => b.mode === 'lightmap').lightMapIntensity = 1 },
    (m) => { m.bindings.find(b => b.mode === 'lightmap').mode = 'baked-appearance' },
  ]) {
    const invalid = structuredClone(manifest)
    change(invalid)
    assert.throws(() => validateManifest(invalid), /Room manifest/)
  }
})

test('lightmapped walls retain albedo and built-in AO while excluding already baked scene lights', () => {
  const source = new THREE.MeshStandardMaterial({
    color: 0xAABBCC,
    map: new THREE.Texture(),
  })
  const binding = manifest.bindings.find(b => b.mode === 'lightmap')
  const atlas = new THREE.DataTexture()
  const material = createRoomMaterial(source, binding, new Map([
    [binding.atlasId, atlas],
  ]))
  assert.equal(material.isMeshLambertNodeMaterial, true)
  assert.equal(material.lights, true)
  assert.equal(material.lightMap, atlas)
  assert.equal(material.lightMapIntensity, Math.PI)
  assert.equal(material.map, source.map)
  assert.notEqual(material.color, source.color)
  assert.equal(material.color.getHex(), source.color.getHex())
  assert.ok(material.lightsNode)
  assert.equal(material.emissiveNode, null)
  assert.equal(material.depthWrite, true)
  material.dispose()
  source.map.dispose()
  source.dispose()
  atlas.dispose()
})
