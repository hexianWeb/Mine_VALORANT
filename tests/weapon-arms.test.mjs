import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import validator from 'gltf-validator'
import * as THREE from 'three/webgpu'
import { loaders } from '../src/engine/runtime/resource/loader/loaders.js'
import { ResourceManager } from '../src/engine/runtime/resource/resource-manager.js'
import { WeaponAssets } from '../src/game/weapons/assets/weapon-assets.js'
import { accessorBytes, compatibilityFor, readGlb, sha256, validateArmContract, validateWeaponPackage } from '../tools/weapons/package-validation.mjs'
import { remapArms } from '../tools/weapons/publish-arms.mjs'

const contract = JSON.parse(await readFile('tools/weapons/arm-contract.json', 'utf8'))
const atlas = await readFile(contract.atlas)
const declaration = { version: contract.version, textureSha256: contract.textureSha256 }

test('arm-only releases preserve all non-UV geometry, rig, animation and weapon skin bytes', async () => {
  for (const [weapon, oldVersion, newVersion] of [
    ['classic', 'v2', 'v3'],
    ['phantom', 'v1', 'v2'],
  ]) {
    const oldDir = `public/weapons/${weapon}/${oldVersion}`
    const newDir = `public/weapons/${weapon}/${newVersion}`
    const oldManifest = JSON.parse(await readFile(`${oldDir}/manifest.json`, 'utf8'))
    const next = JSON.parse(await readFile(`${newDir}/manifest.json`, 'utf8'))
    const oldBytes = await readFile(`${oldDir}/model.glb`)
    const nextBytes = await readFile(`${newDir}/model.glb`)
    assert.deepEqual(remapArms(oldBytes, atlas, contract, oldManifest.model.sha256), nextBytes)
    const old = readGlb(oldBytes)
    const current = readGlb(nextBytes)
    validateArmContract(current, next.armContract, contract)
    assert.equal(next.compatibility.rig, oldManifest.compatibility.rig)
    assert.equal(next.compatibility.clipSet, oldManifest.compatibility.clipSet)
    assert.notEqual(next.compatibility.geometryUV, oldManifest.compatibility.geometryUV)
    assert.deepEqual(compatibilityFor(current), next.compatibility)
    for (const mesh of old.doc.meshes) {
      const newMesh = current.doc.meshes.find(item => item.name === mesh.name)
      for (const [index, primitive] of mesh.primitives.entries()) {
        const newPrimitive = newMesh.primitives[index]
        assert.deepEqual(accessorBytes(old, primitive.indices), accessorBytes(current, newPrimitive.indices))
        for (const [name, accessor] of Object.entries(primitive.attributes)) {
          if (name === 'TEXCOORD_0' && mesh.name.startsWith('Arms_'))
            continue
          assert.deepEqual(accessorBytes(old, accessor), accessorBytes(current, newPrimitive.attributes[name]), `${mesh.name}/${name}`)
        }
      }
    }
    assert.deepEqual(Object.keys(next.skins), Object.keys(oldManifest.skins))
    for (const skinId of Object.keys(next.skins)) {
      const a = JSON.parse(await readFile(`${oldDir}/${oldManifest.skins[skinId].url}`, 'utf8'))
      const b = JSON.parse(await readFile(`${newDir}/${next.skins[skinId].url}`, 'utf8'))
      const aTexture = await readFile(path.resolve(path.dirname(path.join(oldDir, oldManifest.skins[skinId].url)), a.materials.weapon.map.url))
      const bTexture = await readFile(path.resolve(path.dirname(path.join(newDir, next.skins[skinId].url)), b.materials.weapon.map.url))
      assert.equal(sha256(aTexture), sha256(bTexture), `${skinId}: weapon pixels changed`)
    }
    const audit = JSON.parse(await readFile(`${newDir}/source-audit.json`, 'utf8'))
    const report = await validateWeaponPackage(newDir, { validator, poseSamples: audit.poseSamples })
    assert.equal(report.poseSamples, 9)
    assert.equal(report.gltfIssues.numErrors, 0)
    assert.equal(report.gltfIssues.numWarnings, 0)
  }
})

test('arm validation rejects UV drift, atlas mismatch and unverified base models', async () => {
  const bytes = await readFile('public/weapons/classic/v3/model.glb')
  const glb = readGlb(bytes)
  const mesh = glb.doc.meshes.find(item => item.name === 'Arms_Left')
  const accessor = glb.doc.accessors[mesh.primitives[0].attributes.TEXCOORD_0]
  const view = glb.doc.bufferViews[accessor.bufferView]
  glb.binary.writeFloatLE(0.9, (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0))
  assert.throws(() => validateArmContract(glb, declaration, contract), /Arm UV mismatch/)
  assert.throws(() => validateArmContract(readGlb(bytes), {
    ...declaration,
    textureSha256: '0'.repeat(64),
  }, contract), /atlas contract mismatch/)
  assert.throws(() => remapArms(bytes, atlas, contract, '0'.repeat(64)), /Unexpected base GLB/)
})

function makePackage(id) {
  const scene = new THREE.Group()
  const bone = new THREE.Bone()
  bone.name = 'Bone'
  const geometry = new THREE.BufferGeometry()
  const material = (name, map = null) => {
    const result = new THREE.MeshStandardMaterial({ map })
    result.name = name
    return result
  }
  const weapon = new THREE.SkinnedMesh(geometry, material('Weapon_Skin'))
  weapon.bind(new THREE.Skeleton([bone]))
  weapon.name = 'Weapon'
  const left = new THREE.Mesh(geometry, material('Character_Left', new THREE.Texture()))
  left.name = 'Arms_Left'
  const right = new THREE.Mesh(geometry, material('Character_Right', new THREE.Texture()))
  right.name = 'Arms_Right'
  scene.add(bone, weapon, left, right)
  const gltf = {
    scene,
    animations: [
      new THREE.AnimationClip('idle', 1, [
        new THREE.NumberKeyframeTrack('Bone.position[x]', [0, 1], [0, 1]),
      ]),
    ],
  }
  const compatibility = { rig: 'rig', geometryUV: 'uv', clipSet: 'clips' }
  const manifest = {
    schemaVersion: 1,
    weaponId: id,
    assetVersion: 'v1',
    model: { url: 'model.glb', sha256: 'test' },
    compatibility,
    armContract: declaration,
    clips: [
      { name: 'idle', duration: 1, markers: [] },
    ],
    actions: { idle: 'idle' },
    requiredActions: ['idle'],
    materials: {
      weapon: ['Weapon_Skin'],
      armsLeft: ['Character_Left'],
      armsRight: ['Character_Right'],
    },
    skins: {
      normal: { url: 'skins/normal.json' },
      alternate: { url: 'skins/alternate.json' },
    },
  }
  const skin = skinId => ({
    schemaVersion: 1,
    weaponId: id,
    assetVersion: 'v1',
    skinId,
    compatibility,
    materials: {
      weapon: {
        map: {
          url: `../textures/${skinId}.png`,
          colorSpace: 'srgb',
          flipY: false,
          magFilter: 'nearest',
          minFilter: 'nearest',
          generateMipmaps: false,
        },
      },
    },
  })
  return { gltf, manifest, skin, left, right }
}

test('contract-compatible weapons and skin swaps share one scope-owned arm map', async (t) => {
  const packages = {
    classic: makePackage('classic'),
    phantom: makePackage('phantom'),
  }
  t.mock.method(loaders, 'json', async (entry) => {
    const id = entry.url.includes('/classic/')
      ? 'classic'
      : 'phantom'
    const data = packages[id]
    return entry.url.endsWith('manifest.json')
      ? data.manifest
      : data.skin(entry.url.includes('alternate')
          ? 'alternate'
          : 'normal')
  })
  t.mock.method(loaders, 'gltf', async entry => packages[entry.url.includes('/classic/')
    ? 'classic'
    : 'phantom'].gltf)
  t.mock.method(loaders, 'texture', async () => new THREE.Texture())
  const resources = new ResourceManager()
  const assets = new WeaponAssets({ resources, scopeId: 'shared-arm-test', baseUrl: 'https://example.test/weapons/' })
  t.after(() => assets.dispose())
  t.after(() => resources.dispose())
  const [a, b, alternate] = await Promise.all([
    assets.load({ weaponId: 'classic', assetVersion: 'v1', skinId: 'normal' }),
    assets.load({ weaponId: 'phantom', assetVersion: 'v1', skinId: 'normal' }),
    assets.load({ weaponId: 'classic', assetVersion: 'v1', skinId: 'alternate' }),
  ])
  const first = assets.instantiate(a)
  const second = assets.instantiate(b)
  const map = first.root.getObjectByName('Arms_Left').material.map
  assert.equal(first.root.getObjectByName('Arms_Right').material.map, map)
  assert.equal(second.root.getObjectByName('Arms_Left').material.map, map)
  assert.equal(second.root.getObjectByName('Arms_Right').material.map, map)
  assert.equal(map.flipY, false)
  assert.equal(map.minFilter, THREE.NearestFilter)
  assert.equal(map.generateMipmaps, false)
  let disposals = 0
  map.addEventListener('dispose', () => disposals++)
  assets.applySkin(first, alternate)
  assert.equal(first.root.getObjectByName('Arms_Left').material.map, map)
  first.dispose()
  assert.equal(disposals, 0)
  assert.equal(second.root.getObjectByName('Arms_Left').material.map, map)
  assets.dispose()
  assert.equal(disposals, 1)
})
