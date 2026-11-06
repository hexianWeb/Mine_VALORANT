import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js'
import * as THREE from 'three/webgpu'
import { loaders } from '../src/engine/resources/loaders.js'
import { ResourceManager } from '../src/engine/resources/resources.js'
import { validateManifest } from '../src/engine/systems/render/manifest.js'
import { createRoomMaterial } from '../src/engine/systems/render/materials.js'
import { createRoomLights } from '../src/engine/systems/render/room-lights.js'
import { validateRoomFiles } from '../tools/validate-room-assets.mjs'

const manifest = JSON.parse(fs.readFileSync(new URL('../public/lighting/range-room/manifest.json', import.meta.url)))
const copy = () => structuredClone(manifest)

test('actual exported room: hashes, five pages and every primitive/UV binding match', () => {
  const report = validateRoomFiles('public/lighting/range-room/manifest.json')
  assert.equal(report.atlases, 5)
  assert.equal(report.primitives, 199)
  assert.equal(report.meshNodes, 135) // Seven source objects are empty meshes; no renderable faces are omitted.
  assert.ok(report.counts.realtime > 0 && report.counts['baked-appearance'] > 0)
})

test('all five EXRs decode as half-float scene-linear textures without hidden display conversion', () => {
  for (const page of manifest.atlases) {
    const file = new URL(`../public/lighting/range-room/atlases/${page.id}.exr`, import.meta.url)
    const bytes = fs.readFileSync(file)
    const parsed = new EXRLoader().setDataType(THREE.HalfFloatType).parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    assert.equal(parsed.width, page.width)
    assert.equal(parsed.height, page.height)
    assert.equal(parsed.colorSpace, THREE.LinearSRGBColorSpace)
    assert.equal(parsed.type, THREE.HalfFloatType)
    assert.equal(parsed.flipY, false)
    for (let i = 0; i < parsed.data.length; i += 4096)
      assert.ok(Number.isFinite(THREE.DataUtils.fromHalfFloat(parsed.data[i])))
  }
})

test('reject missing pages, duplicate bindings, unknown classifications and wrong encoding', () => {
  for (const mutate of [
    m => m.atlases.pop(),
    m => m.bindings.push(m.bindings[0]),
    (m) => { m.bindings[0].mode = 'guess-from-name' },
    (m) => { m.atlases[0].colorSpace = 'srgb' },
    (m) => { m.display.displayTransformBaked = true },
    (m) => { m.camera.near = -1 },
  ]) {
    const value = copy()
    mutate(value)
    assert.throws(() => validateManifest(value), /Room manifest/)
  }
})

test('baked appearance is unlit, uses explicit UV, never lightMap or original albedo', () => {
  const source = new THREE.MeshStandardMaterial({ color: 0x111111, transparent: true, depthWrite: false })
  const binding = manifest.bindings.find(b => b.mode === 'baked-appearance')
  const atlas = new THREE.DataTexture(new Uint16Array(16), 2, 2, THREE.RGBAFormat, THREE.HalfFloatType)
  const material = createRoomMaterial(source, binding, new Map([
    [binding.atlasId, atlas],
  ]))
  assert.equal(material.lights, false)
  assert.equal(material.colorNode.node.value, atlas)
  assert.equal(material.colorNode.node.uvNode.sourceNode.getAttributeName(), `uv${binding.uvChannel || ''}`)
  assert.equal(material.colorNode.node.uvNode.components, 'y')
  assert.equal(material.lightMap, null)
  assert.equal(material.toneMapped, true)
  assert.equal(material.transparent, false)
  assert.equal(material.depthWrite, true)
  material.dispose()
  source.dispose()
  atlas.dispose()
})

test('opaque baked appearance writes depth even when legacy glTF source was BLEND', () => {
  const source = new THREE.MeshStandardMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide })
  const binding = manifest.bindings.find(b => b.mode === 'baked-appearance')
  const atlas = new THREE.Texture()
  const material = createRoomMaterial(source, binding, new Map([
    [binding.atlasId, atlas],
  ]))
  assert.equal(material.transparent, false)
  assert.equal(material.depthWrite, true)
  assert.equal(material.side, THREE.DoubleSide)
  assert.equal(source.depthWrite, false)
  material.dispose()
  source.dispose()
  atlas.dispose()
})

test('exported alpha modes distinguish solid blocks, cutouts and real translucency', () => {
  const buffer = fs.readFileSync(new URL('../public/model/range-room.glb', import.meta.url))
  const gltf = JSON.parse(buffer.toString('utf8', 20, 20 + buffer.readUInt32LE(12)))
  const modes = {}
  const materials = new Map(gltf.materials.map(material => [material.name, material]))
  for (const material of gltf.materials) {
    const mode = material.alphaMode ?? 'OPAQUE'
    modes[mode] = (modes[mode] ?? 0) + 1
    assert.equal(material.doubleSided, true)
  }
  assert.deepEqual(modes, { OPAQUE: 109, MASK: 35, BLEND: 4 })
  for (const name of ['stone_bricks', 'barrel_side', 'TRIAL85_SOURCE__andesite'])
    assert.equal(materials.get(name).alphaMode ?? 'OPAQUE', 'OPAQUE', name)
  for (const name of ['iron_bars', 'oak_leaves', 'fern']) {
    assert.equal(materials.get(name).alphaMode, 'MASK', name)
    assert.equal(materials.get(name).alphaCutoff ?? 0.5, 0.5, name)
  }
  for (const name of ['black_stained_glass', 'white_stained_glass', 'tripwire'])
    assert.equal(materials.get(name).alphaMode, 'BLEND', name)
})

test('realtime PBR clones mutable state and retains shared texture/alpha semantics', () => {
  const texture = new THREE.Texture()
  const source = new THREE.MeshStandardMaterial({
    map: texture,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    roughness: 0.7,
  })
  const material = createRoomMaterial(source, { mode: 'realtime', sourceMaterial: 'test' }, new Map())
  assert.equal(material.lights, true)
  assert.equal(material.map, texture)
  assert.equal(material.alphaTest, 0.5)
  assert.equal(material.side, THREE.DoubleSide)
  assert.notEqual(material.uuid, source.uuid)
  assert.notEqual(material.color, source.color)
  material.color.set(0xFF0000)
  assert.notEqual(material.color.getHex(), source.color.getHex())
  material.dispose()
  source.dispose()
  texture.dispose()
})

test('measured ceiling lights preserve positions, downward normal and long-axis roll', () => {
  const { root, dispose } = createRoomLights(manifest)
  const lights = root.children.filter(l => l.isRectAreaLight)
  assert.equal(lights.length, 3)
  for (let i = 0; i < lights.length; i++) {
    const light = lights[i]
    assert.deepEqual(light.position.toArray(), manifest.lights[i].position)
    assert.ok(new THREE.Vector3(0, 0, -1).applyQuaternion(light.quaternion).distanceTo(new THREE.Vector3(0, -1, 0)) < 1e-6)
    assert.ok(new THREE.Vector3(0, 1, 0).applyQuaternion(light.quaternion).distanceTo(new THREE.Vector3(0, 0, -1)) < 1e-6)
    assert.equal(light.castShadow, false)
    assert.notEqual(light.intensity, manifest.lights[i].sourcePowerWatts)
  }
  dispose()
  dispose()
  assert.equal(root.children.length, 0)
})

test('unloading an in-flight atlas disposes the late result and rejects as cancellation', async () => {
  const originalLoader = loaders.exr
  const resources = new ResourceManager()
  let resolve
  const texture = new THREE.DataTexture()
  let disposals = 0
  texture.addEventListener('dispose', () => disposals++)
  loaders.exr = () => new Promise((done) => {
    resolve = done
  })
  try {
    const request = resources.load([
      { name: 'cancelled-atlas', type: 'exr', url: '/not-requested.exr' },
    ])
    resources.unload('cancelled-atlas')
    resolve(texture)
    await assert.rejects(request, { name: 'AbortError' })
    assert.equal(disposals, 1)
    assert.equal(resources.has('cancelled-atlas'), false)
  }
  finally {
    loaders.exr = originalLoader
    resources.dispose()
  }
})
