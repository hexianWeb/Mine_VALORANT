import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import validator from 'gltf-validator'
import * as THREE from 'three/webgpu'
import { loaders } from '../src/engine/runtime/resource/loader/loaders.js'
import { ResourceManager } from '../src/engine/runtime/resource/resource-manager.js'
import { phoenixArmAppearance, remapPhoenixArmGeometry } from '../src/game/player/phoenix-arm-appearance.js'
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

test('Phoenix appearance shares its texture, preserves weapon skin swaps and owns only cloned arm geometry', async (t) => {
  const packages = {
    classic: makePackage('classic'),
    phantom: makePackage('phantom'),
  }
  for (const data of Object.values(packages)) {
    for (const [side, mesh] of [
      ['Left', data.left],
      ['Right', data.right],
    ]) {
      const geometry = new THREE.BufferGeometry()
      geometry.setIndex(contract.indices)
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(contract.sides[side].flatMap(([u, v]) => [u, 1 - v]), 2))
      mesh.geometry = geometry
      mesh.material.map.image = { width: 32, height: 32 }
    }
  }
  const originalUv = Array.from(packages.classic.left.geometry.attributes.uv.array)
  t.mock.method(loaders, 'json', async (entry) => {
    const data = packages[entry.url.includes('/classic/')
      ? 'classic'
      : 'phantom']
    return entry.url.endsWith('manifest.json')
      ? data.manifest
      : data.skin(entry.url.includes('alternate')
          ? 'alternate'
          : 'normal')
  })
  t.mock.method(loaders, 'gltf', async entry => packages[entry.url.includes('/classic/')
    ? 'classic'
    : 'phantom'].gltf)
  let appearanceLoads = 0
  t.mock.method(loaders, 'texture', async (entry) => {
    if (entry.url === phoenixArmAppearance.url) {
      appearanceLoads++
      return new THREE.Texture({ width: 1254, height: 1254 })
    }
    return new THREE.Texture()
  })
  const resources = new ResourceManager()
  const assets = new WeaponAssets({
    resources,
    scopeId: 'phoenix-arm-test',
    baseUrl: 'https://example.test/weapons/',
    armAppearance: phoenixArmAppearance,
  })
  t.after(() => assets.dispose())
  t.after(() => resources.dispose())
  const [a, b, alternate] = await Promise.all([
    assets.load({ weaponId: 'classic', assetVersion: 'v1', skinId: 'normal' }),
    assets.load({ weaponId: 'phantom', assetVersion: 'v1', skinId: 'normal' }),
    assets.load({ weaponId: 'classic', assetVersion: 'v1', skinId: 'alternate' }),
  ])
  const first = assets.instantiate(a)
  const second = assets.instantiate(b)
  const left = first.root.getObjectByName('Arms_Left')
  const map = left.material.map
  assert.equal(appearanceLoads, 1)
  assert.equal(first.root.getObjectByName('Arms_Right').material.map, map)
  assert.equal(second.root.getObjectByName('Arms_Left').material.map, map)
  assert.notEqual(left.geometry, packages.classic.left.geometry)
  assert.deepEqual(Array.from(packages.classic.left.geometry.attributes.uv.array), originalUv)
  assert.equal(map.flipY, false)
  assert.equal(map.magFilter, THREE.NearestFilter)
  let geometryDisposals = 0
  let textureDisposals = 0
  left.geometry.addEventListener('dispose', () => geometryDisposals++)
  map.addEventListener('dispose', () => textureDisposals++)
  assets.applySkin(first, alternate)
  assert.equal(left.material.map, map)
  first.dispose()
  assert.equal(geometryDisposals, 1)
  assert.equal(textureDisposals, 0)
  assert.equal(second.root.getObjectByName('Arms_Right').material.map, map)
  assets.dispose()
  assert.equal(textureDisposals, 1)
})

test('Phoenix arm UV adaptation accepts all current gun and karambit layouts without changing their source geometry', async () => {
  const versions = [
    ['bulldog', 'v4'],
    ['classic', 'v4'],
    ['ghost', 'v2'],
    ['judge', 'v2'],
    ['karambit', 'v3'],
    ['odin', 'v2'],
    ['operator', 'v3'],
    ['outlaw', 'v3'],
    ['phantom', 'v4'],
    ['sheriff', 'v2'],
    ['vandal', 'v1'],
  ]
  for (const [weapon, version] of versions) {
    const glb = readGlb(await readFile(`public/weapons/${weapon}/${version}/model.glb`))
    for (const mesh of glb.doc.meshes.filter(item => item.name === 'Arms_Left' || item.name === 'Arms_Right')) {
      const primitive = mesh.primitives[0]
      const uvAccessor = glb.doc.accessors[primitive.attributes.TEXCOORD_0]
      const uvBytes = accessorBytes(glb, primitive.attributes.TEXCOORD_0)
      const indexAccessor = glb.doc.accessors[primitive.indices]
      const indexBytes = accessorBytes(glb, primitive.indices)
      const geometry = new THREE.BufferGeometry()
      geometry.setIndex(Array.from({ length: indexAccessor.count }, (_, i) => indexAccessor.componentType === 5123
        ? indexBytes.readUInt16LE(i * 2)
        : indexBytes.readUInt32LE(i * 4)))
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(Array.from({ length: uvAccessor.count * 2 }, (_, i) => uvBytes.readFloatLE(i * 4)), 2))
      const original = Array.from(geometry.attributes.uv.array)
      const size = weapon === 'karambit'
        ? 256
        : 32
      const adapted = remapPhoenixArmGeometry(geometry, { width: size, height: size })
      assert.notEqual(adapted, geometry)
      assert.deepEqual(Array.from(geometry.attributes.uv.array), original)
      assert.deepEqual(Array.from(adapted.index.array), Array.from(geometry.index.array))
      assert.notDeepEqual(Array.from(adapted.attributes.uv.array.slice(0, 48)), original.slice(0, 48))
      geometry.attributes.uv.setX(0, 0.99)
      assert.throws(() => remapPhoenixArmGeometry(geometry, { width: size, height: size }), /Unsupported arm UV layout/)
      adapted.dispose()
      geometry.dispose()
    }
  }
})
