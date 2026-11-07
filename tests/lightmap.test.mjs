import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js'
import * as THREE from 'three/webgpu'
import { validateManifest } from '../src/world/manifest.js'
import { createRoomMaterial } from '../src/world/materials.js'
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

test('lightmaps cover precisely the existing prebaked receivers and preserve old assets', () => {
  const current = validateRoomFiles('public/lighting/range-room-lightmap/manifest.json')
  const old = validateRoomFiles('public/lighting/range-room/manifest.json')
  assert.equal(current.primitives, old.primitives)
  assert.equal(current.triangles, old.triangles)
  assert.equal(current.counts.lightmap, 18)
  assert.equal(current.counts.realtime, old.counts.realtime)
  assert.equal(current.alphaModes.MASK, old.alphaModes.MASK)
  assert.equal(current.alphaModes.BLEND, old.alphaModes.BLEND)
  const receivers = (m, mode) => m.bindings.filter(b => b.mode === mode).map(b => `${b.sourceObject}/${b.sourceMaterial}/${b.uvChannel}`).sort()
  assert.deepEqual(receivers(manifest, 'lightmap'), receivers(previous, 'baked-appearance'))
  assert.equal(manifest.bake.objects.length, 11)
  assert.equal(manifest.bake.collection, '预烘焙')
  assert.equal(manifest.bake.geometryAndUVUnchanged, true)
  assert.equal(manifest.bake.uvOwnership.overlappingTexels, 0)
  for (const object of ['Double_Stone_Slab', 'Stone_Slab.001']) {
    const bindings = manifest.bindings.filter(b => b.sourceObject === object)
    assert.equal(bindings.length, 2)
    assert.ok(bindings.every(b => b.atlasId === 'B05'), `${object}: albedo reassignment must not change the packed atlas page`)
  }
  const oldGLB = readGLB('range-room')
  const newGLB = readGLB('range-room-lightmap')
  for (const binding of manifest.bindings.filter(b => b.mode === 'lightmap')) {
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

test('all rebaked pages contain finite nonempty half-float HDR lighting and original albedo remains in GLB', () => {
  for (const page of manifest.atlases) {
    const bytes = fs.readFileSync(new URL(`../public/lighting/range-room-lightmap/atlases/${page.id}.exr`, import.meta.url))
    const parsed = new EXRLoader().setDataType(THREE.HalfFloatType).parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    assert.equal(parsed.width, 2048)
    assert.equal(parsed.height, 2048)
    assert.equal(parsed.colorSpace, THREE.LinearSRGBColorSpace)
    let lit = 0
    for (let i = 0; i < parsed.data.length; i += 4096) {
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
