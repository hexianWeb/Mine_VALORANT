import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three/webgpu'
import { loaders } from '../src/engine/runtime/resource/loader/loaders.js'
import { ResourceManager } from '../src/engine/runtime/resource/resource-manager.js'
import { WeaponAssets } from '../src/game/weapons/assets/weapon-assets.js'
import { weaponMaterialProfiles } from '../src/game/weapons/assets/weapon-materials.js'

const request = { weaponId: 'classic', assetVersion: 'v1', skinId: 'smite' }
const compatibility = { rig: 'rig-v1', geometryUV: 'uv-v1', clipSet: 'clips-v1' }
const flush = () => new Promise(resolve => setImmediate(resolve))

function fixture() {
  const scene = new THREE.Group()
  scene.name = 'Root'
  const bone = new THREE.Bone()
  bone.name = 'WeaponBone'
  const geometry = new THREE.BufferGeometry()
  const weaponMaterial = new THREE.MeshStandardMaterial()
  weaponMaterial.name = 'Weapon_Skin'
  const armsMaterial = new THREE.MeshStandardMaterial()
  armsMaterial.name = 'Character_Left'
  const mesh = new THREE.SkinnedMesh(geometry, weaponMaterial)
  mesh.name = 'WeaponMesh'
  mesh.bind(new THREE.Skeleton([bone]))
  const arms = new THREE.Mesh(geometry, armsMaterial)
  arms.name = 'Arms'
  scene.add(bone, mesh, arms)
  const clip = new THREE.AnimationClip('idle', 1, [
    new THREE.NumberKeyframeTrack('WeaponBone.position[x]', [0, 1], [0, 2]),
  ])
  const gltf = {
    scene,
    animations: [clip],
  }
  const manifest = {
    schemaVersion: 1,
    weaponId: 'classic',
    assetVersion: 'v1',
    model: { url: 'model.glb', sha256: 'model-hash' },
    compatibility,
    clips: [
      {
        name: 'idle',
        duration: 1,
        loop: false,
        markers: [
          { time: 0.5, cue: 'bolt' },
        ],
      },
    ],
    actions: { idle: 'idle' },
    requiredActions: ['idle'],
    materials: {
      weapon: ['Weapon_Skin'],
      armsLeft: ['Character_Left'],
    },
    skins: {
      smite: { url: 'skins/smite.json' },
    },
  }
  const skin = {
    schemaVersion: 1,
    weaponId: 'classic',
    assetVersion: 'v1',
    skinId: 'smite',
    compatibility,
    materials: {
      weapon: {
        map: {
          url: '../textures/skin.png',
          colorSpace: 'srgb',
          flipY: false,
          magFilter: 'nearest',
          minFilter: 'nearest',
          generateMipmaps: false,
        },
      },
    },
  }
  return {
    gltf,
    manifest,
    skin,
    mesh,
    geometry,
    weaponMaterial,
    armsMaterial,
  }
}

function setup(t, data = fixture(), overrides = {}, options = {}) {
  const calls = []
  const textures = []
  for (const type of ['json', 'gltf', 'texture']) {
    t.mock.method(loaders, type, async (entry) => {
      calls.push(entry)
      if (overrides[type])
        return overrides[type](entry)
      if (type === 'gltf')
        return data.gltf
      if (type === 'json') {
        return entry.url.endsWith('manifest.json')
          ? data.manifest
          : data.skin
      }
      const texture = new THREE.Texture()
      textures.push(texture)
      return texture
    })
  }
  const resources = new ResourceManager()
  const assets = new WeaponAssets({
    resources,
    scopeId: 'test-level',
    baseUrl: 'https://assets.test/weapons/',
    ...options,
  })
  t.after(() => assets.dispose())
  t.after(() => resources.dispose())
  return {
    resources,
    assets,
    calls,
    textures,
    data,
  }
}

test('warm loads share templates, resolve package paths, and expose no mutable Three objects', async (t) => {
  const f = setup(t)
  const [first, second] = await Promise.all([
    f.assets.load(request),
    f.assets.load({ ...request }),
  ])
  assert.equal(first, second)
  assert.ok(Object.isFrozen(first))
  assert.ok(Object.isFrozen(first.manifest))
  assert.ok(Object.isFrozen(first.manifest.actions))
  assert.equal(first.root, undefined)
  assert.equal(first.clips, undefined)
  assert.deepEqual(f.calls.map(entry => entry.type), ['json', 'gltf', 'json', 'texture'])
  assert.equal(f.calls.find(entry => entry.type === 'gltf').url, 'https://assets.test/weapons/classic/v1/model.glb')
  assert.equal(f.calls.find(entry => entry.type === 'gltf').options.sha256, 'model-hash')
  assert.equal(f.calls.find(entry => entry.type === 'texture').url, 'https://assets.test/weapons/classic/v1/textures/skin.png')
  assert.equal(f.textures[0].flipY, false)
  assert.equal(f.textures[0].magFilter, THREE.NearestFilter)
  assert.equal(f.textures[0].generateMipmaps, false)
  assert.equal(f.data.mesh.material, f.data.weaponMaterial)
  assert.equal(f.data.weaponMaterial.map, null)
  f.data.manifest.actions.idle = 'changed-source'
  assert.equal(first.manifest.actions.idle, 'idle')
})

test('instances have independent skeletons, materials and players while sharing geometry and skin texture', async (t) => {
  const f = setup(t)
  const asset = await f.assets.load(request)
  const a = f.assets.instantiate(asset)
  const b = f.assets.instantiate(asset)
  const am = a.root.getObjectByName('WeaponMesh')
  const bm = b.root.getObjectByName('WeaponMesh')
  assert.notEqual(am.skeleton, bm.skeleton)
  assert.notEqual(am.skeleton, f.data.mesh.skeleton)
  assert.notEqual(am.skeleton.bones[0], bm.skeleton.bones[0])
  assert.equal(am.skeleton.bones[0], a.root.getObjectByName('WeaponBone'))
  assert.equal(am.geometry, bm.geometry)
  assert.equal(am.geometry, f.data.geometry)
  assert.notEqual(am.material, bm.material)
  assert.notEqual(a.root.getObjectByName('Arms').material, b.root.getObjectByName('Arms').material)
  assert.equal(am.material.map, bm.material.map)
  assert.equal(am.material.map, f.textures[0])
  assert.equal(a.root.getObjectByName('Arms').material.map, null)
  a.player.play('idle', { fade: 0 })
  const events = a.player.advance(0.5)
  assert.equal(a.root.getObjectByName('WeaponBone').position.x, 1)
  assert.equal(b.root.getObjectByName('WeaponBone').position.x, 0)
  assert.equal(f.data.gltf.scene.getObjectByName('WeaponBone').position.x, 0)
  assert.equal(events.filter(event => event.type === 'marker').length, 1)
  am.material.opacity = 0.2
  assert.equal(bm.material.opacity, 1)
  let materialDisposals = 0
  let geometryDisposals = 0
  let textureDisposals = 0
  am.material.addEventListener('dispose', () => materialDisposals++)
  am.geometry.addEventListener('dispose', () => geometryDisposals++)
  f.textures[0].addEventListener('dispose', () => textureDisposals++)
  const skeletonDispose = t.mock.method(am.skeleton, 'dispose')
  a.dispose()
  a.dispose()
  assert.equal(a.player.snapshot().disposed, true)
  assert.equal(skeletonDispose.mock.callCount(), 1)
  assert.equal(materialDisposals, 1)
  assert.equal(geometryDisposals, 0)
  assert.equal(textureDisposals, 0)
  b.player.play('idle', { fade: 0 })
  b.player.advance(0.5)
  assert.equal(b.root.getObjectByName('WeaponBone').position.x, 1)
})

test('aborting one request rejects it promptly without cancelling another waiter or the cached template', async (t) => {
  const model = Promise.withResolvers()
  const f = setup(t, fixture(), {
    gltf: () => model.promise,
  })
  const controller = new AbortController()
  const first = assert.rejects(f.assets.load(request, { signal: controller.signal }), { name: 'AbortError' })
  const second = f.assets.load(request)
  await flush()
  controller.abort()
  await first
  const modelCall = f.calls.find(entry => entry.type === 'gltf')
  assert.equal(modelCall.options.signal.aborted, false)
  model.resolve(f.data.gltf)
  const handle = await second
  assert.equal(await f.assets.load(request), handle)
  assert.equal(f.calls.filter(entry => entry.type === 'gltf').length, 1)
})

test('runtime materials use flat full metal for the gun and keep matte arms and source materials', async (t) => {
  const f = setup(t)
  const normalMap = new THREE.Texture()
  f.data.weaponMaterial.normalMap = normalMap
  const handle = await f.assets.load(request)
  const instance = f.assets.instantiate(handle)
  const weapon = instance.root.getObjectByName('WeaponMesh').material
  const arms = instance.root.getObjectByName('Arms').material
  assert.equal(weapon.roughness, 1)
  assert.equal(weapon.metalness, 1)
  assert.equal(weapon.flatShading, true)
  assert.equal(weapon.normalMap, null)
  assert.equal(weapon.isMeshPhysicalMaterial, undefined)
  assert.equal(weapon.envMap, null, 'the material falls back to the scene environment')
  assert.equal(arms.roughness, weaponMaterialProfiles.armsLeft.roughness)
  assert.equal(arms.metalness, weaponMaterialProfiles.armsLeft.metalness)
  assert.equal(f.data.weaponMaterial.roughness, 1)
  assert.equal(f.data.weaponMaterial.metalness, 0)
  assert.equal(f.data.weaponMaterial.flatShading, false)
  assert.equal(f.data.weaponMaterial.normalMap, normalMap)
  assert.equal(f.data.armsMaterial.roughness, 1)
  assert.equal(weapon.alphaTest, f.data.weaponMaterial.alphaTest)
  assert.equal(weapon.side, f.data.weaponMaterial.side)
  assert.deepEqual(weapon.color.toArray(), f.data.weaponMaterial.color.toArray())
  assert.equal(weapon.map, f.textures[0])
})

test('the room reflection is borrowed by gun materials and follows lighting for all live instances', async (t) => {
  const data = fixture()
  const source = new THREE.MeshPhysicalMaterial({ name: data.weaponMaterial.name, clearcoat: 0.29, clearcoatRoughness: 0.05 })
  data.mesh.material = source
  const scope = new THREE.MeshStandardMaterial({ name: 'Scope' })
  data.gltf.scene.add(new THREE.Mesh(data.geometry, scope))
  data.manifest.materials.scope = ['Scope']
  const reflectionTexture = new THREE.Texture()
  let reflectionDisposals = 0
  reflectionTexture.addEventListener('dispose', () => reflectionDisposals++)
  const { assets } = setup(t, data, {}, { reflectionTexture })
  const handle = await assets.load(request)
  const first = assets.instantiate(handle)
  const gun = first.root.getObjectByName('WeaponMesh').material
  const arms = first.root.getObjectByName('Arms').material
  const sight = first.root.children.find(object => object.material?.name === 'Scope').material
  assert.equal(gun.envMap, reflectionTexture)
  assert.equal(gun.envMapIntensity, 0.3)
  assert.equal(gun.clearcoat, 0.29)
  assert.equal(gun.clearcoatRoughness, 0.18)
  assert.equal(source.clearcoatRoughness, 0.05)
  assert.equal(arms.envMap, null)
  assert.equal(sight.envMap, null)
  assets.setReflectionEnabled(false)
  assert.equal(gun.envMapIntensity, 0)
  assert.equal(gun.emissiveIntensity, 0.4)
  const second = assets.instantiate(handle)
  const stagedGun = second.root.getObjectByName('WeaponMesh').material
  assert.equal(stagedGun.envMap, reflectionTexture)
  assert.equal(stagedGun.envMapIntensity, 0)
  assets.setReflectionEnabled(true)
  assert.equal(gun.envMapIntensity, 0.3)
  assert.equal(stagedGun.envMapIntensity, 0.3)
  assert.equal(arms.envMapIntensity, 1)
  assert.equal(sight.envMapIntensity, 1)
  assets.dispose()
  assert.equal(reflectionDisposals, 0)
  reflectionTexture.dispose()
})

test('a compatible skin swap is atomic and preserves the exact player, skeleton, materials and other instances', async (t) => {
  const data = fixture()
  data.manifest.skins.sakura = { url: 'skins/sakura.json' }
  const f = setup(t, data, {
    json(entry) {
      if (entry.url.endsWith('manifest.json'))
        return data.manifest
      const skin = structuredClone(data.skin)
      if (entry.url.endsWith('sakura.json')) {
        skin.skinId = 'sakura'
        skin.materials.weapon.map.url = '../textures/sakura.png'
      }
      return skin
    },
  })
  const original = await f.assets.load(request)
  const alternate = await f.assets.load({ ...request, skinId: 'sakura' })
  const a = f.assets.instantiate(original)
  const b = f.assets.instantiate(original)
  const mesh = a.root.getObjectByName('WeaponMesh')
  const material = mesh.material
  const skeleton = mesh.skeleton
  const arms = a.root.getObjectByName('Arms').material
  a.player.play('idle', { fade: 0 })
  a.player.advance(0.35)
  const playback = a.player.snapshot()
  f.assets.applySkin(a, alternate)
  assert.equal(a.skinId, 'sakura')
  assert.equal(mesh.material, material)
  assert.equal(mesh.skeleton, skeleton)
  assert.equal(a.root.getObjectByName('Arms').material, arms)
  assert.equal(arms.map, null)
  assert.equal(material.roughness, weaponMaterialProfiles.weapon.roughness)
  assert.equal(material.metalness, weaponMaterialProfiles.weapon.metalness)
  assert.equal(material.emissiveMap, material.map)
  assert.equal(material.emissiveIntensity, 0.4)
  assert.equal(arms.roughness, weaponMaterialProfiles.armsLeft.roughness)
  assert.deepEqual(a.player.snapshot(), playback)
  assert.notEqual(mesh.material.map, b.root.getObjectByName('WeaponMesh').material.map)
  assert.equal(b.skinId, 'smite')
  assert.equal(b.root.getObjectByName('WeaponMesh').material.map, f.textures[0])
  assert.throws(() => f.assets.applySkin(a, { ...alternate }), /this scope/)
  assert.equal(a.skinId, 'sakura')
  f.assets.applySkin(a, original)
  assert.equal(material.map, f.textures[0])
  a.dispose()
  assert.throws(() => f.assets.applySkin(a, alternate), /live instance/)
  f.assets.applySkin(b, alternate)
  assert.equal(b.skinId, 'sakura', 'releasing one instance did not destroy the shared replacement map')
})

test('albedo-only weapon skins glow with their color map and ignore embedded emission', async (t) => {
  const data = fixture()
  const embedded = new THREE.Texture()
  data.weaponMaterial.emissiveMap = embedded
  data.weaponMaterial.emissive.setRGB(0.6, 0.6, 0.6)
  data.weaponMaterial.emissiveIntensity = 2
  const f = setup(t, data)
  const handle = await f.assets.load(request)
  const instance = f.assets.instantiate(handle)
  const material = instance.root.getObjectByName('WeaponMesh').material
  assert.equal(material.map, f.textures[0])
  assert.equal(material.emissiveMap, material.map)
  assert.notEqual(material.emissiveMap, embedded)
  assert.equal(material.emissive.getHex(), 0xFFFFFF)
  assert.equal(material.emissiveIntensity, 0.4)
  assert.equal(data.weaponMaterial.emissiveMap, embedded, 'the shared template is untouched')
  assert.deepEqual(data.weaponMaterial.emissive.toArray(), [0.6, 0.6, 0.6])
  assert.equal(data.weaponMaterial.emissiveIntensity, 2)
})

test('skin emission is loaded, replaced and removed together with albedo without accumulating layers', async (t) => {
  const data = fixture()
  data.manifest.skins.sakura = { url: 'skins/sakura.json' }
  data.manifest.skins.ag = { url: 'skins/ag.json' }
  data.skin.materials.weapon.emissiveMap = {
    ...data.skin.materials.weapon.map,
    url: '../textures/smite-emissive.png',
  }
  data.skin.materials.weapon.emissiveIntensity = 2.5
  data.armsMaterial.emissive.setRGB(0.1, 0.2, 0.3)
  const f = setup(t, data, {
    json(entry) {
      if (entry.url.endsWith('manifest.json'))
        return data.manifest
      const skin = structuredClone(data.skin)
      if (entry.url.endsWith('sakura.json')) {
        skin.skinId = 'sakura'
        skin.materials.weapon.map.url = '../textures/sakura.png'
        skin.materials.weapon.emissiveMap.url = '../textures/sakura-emissive.png'
        delete skin.materials.weapon.emissiveIntensity
      }
      if (entry.url.endsWith('ag.json')) {
        skin.skinId = 'ag'
        skin.materials.weapon.map.url = '../textures/ag.png'
        delete skin.materials.weapon.emissiveMap
        delete skin.materials.weapon.emissiveIntensity
      }
      return skin
    },
  })
  const original = await f.assets.load(request)
  const alternate = await f.assets.load({ ...request, skinId: 'sakura' })
  const plain = await f.assets.load({ ...request, skinId: 'ag' })
  const a = f.assets.instantiate(original)
  const b = f.assets.instantiate(alternate)
  const material = a.root.getObjectByName('WeaponMesh').material
  const other = b.root.getObjectByName('WeaponMesh').material
  const arms = a.root.getObjectByName('Arms').material
  const smiteMap = material.map
  const smiteEmission = material.emissiveMap
  const sakuraMap = other.map
  const sakuraEmission = other.emissiveMap
  assert.ok(smiteEmission?.isTexture)
  assert.notEqual(smiteMap, smiteEmission)
  assert.notEqual(smiteEmission, sakuraEmission)
  assert.equal(material.emissive.getHex(), 0xFFFFFF)
  assert.equal(material.emissiveIntensity, 2.5)
  assert.equal(other.emissiveIntensity, 0.4)
  assert.equal(smiteEmission.colorSpace, THREE.SRGBColorSpace)
  assert.equal(smiteEmission.flipY, false)
  assert.equal(smiteEmission.magFilter, THREE.NearestFilter)
  assert.equal(smiteEmission.minFilter, THREE.NearestFilter)
  assert.equal(smiteEmission.generateMipmaps, false)
  a.player.play('idle', { fade: 0 })
  a.player.advance(0.35)
  const playback = a.player.snapshot()
  const children = a.root.children.slice()
  let emissionDisposals = 0
  smiteEmission.addEventListener('dispose', () => emissionDisposals++)
  for (let index = 0; index < 12; index++) {
    f.assets.applySkin(a, alternate)
    assert.equal(material.map, sakuraMap)
    assert.equal(material.emissiveMap, sakuraEmission)
    assert.equal(material.emissiveIntensity, 0.4)
    f.assets.applySkin(a, plain)
    assert.equal(material.emissiveMap, material.map)
    assert.notEqual(material.map, smiteMap)
    assert.notEqual(material.map, sakuraMap)
    assert.equal(material.emissive.getHex(), 0xFFFFFF)
    assert.equal(material.emissiveIntensity, 0.4)
    f.assets.applySkin(a, original)
    assert.equal(material.map, smiteMap)
    assert.equal(material.emissiveMap, smiteEmission)
    assert.equal(material.emissive.getHex(), 0xFFFFFF)
    assert.equal(material.emissiveIntensity, 2.5)
  }
  assert.equal(a.root.getObjectByName('WeaponMesh').material, material)
  assert.deepEqual(a.root.children, children)
  assert.deepEqual(a.player.snapshot(), playback)
  assert.equal(material.roughness, weaponMaterialProfiles.weapon.roughness)
  assert.equal(material.metalness, weaponMaterialProfiles.weapon.metalness)
  assert.equal(other.emissiveMap, sakuraEmission)
  assert.deepEqual(arms.emissive.toArray(), [0.1, 0.2, 0.3])
  a.dispose()
  assert.equal(emissionDisposals, 0, 'instances borrow the scope-owned emission maps')
  f.assets.dispose()
  assert.equal(emissionDisposals, 1)
})

test('failed emission downloads keep the displayed skin intact and retry only the missing texture', async (t) => {
  const data = fixture()
  data.manifest.skins.glow = { url: 'skins/glow.json' }
  let attempts = 0
  const f = setup(t, data, {
    json(entry) {
      if (entry.url.endsWith('manifest.json'))
        return data.manifest
      const skin = structuredClone(data.skin)
      if (entry.url.endsWith('glow.json')) {
        skin.skinId = 'glow'
        skin.materials.weapon.emissiveMap = { ...skin.materials.weapon.map, url: '../textures/glow.png' }
      }
      return skin
    },
    texture(entry) {
      if (entry.url.endsWith('/glow.png') && ++attempts === 1)
        throw new Error('temporary emission failure')
      return new THREE.Texture()
    },
  })
  const original = await f.assets.load(request)
  const instance = f.assets.instantiate(original)
  const material = instance.root.getObjectByName('WeaponMesh').material
  const map = material.map
  await assert.rejects(f.assets.load({ ...request, skinId: 'glow' }), /temporary emission failure/)
  assert.equal(instance.skinId, 'smite')
  assert.equal(material.map, map)
  assert.equal(material.emissiveMap, map)
  const glow = await f.assets.load({ ...request, skinId: 'glow' })
  f.assets.applySkin(instance, glow)
  assert.equal(instance.skinId, 'glow')
  assert.ok(material.emissiveMap?.isTexture)
  assert.equal(attempts, 2)
  assert.equal(f.calls.filter(entry => entry.type === 'texture' && entry.url.endsWith('/skin.png')).length, 2, 'one albedo per skin, never redownloaded on retry')
})

test('removing an optional scope override restores all source channels, and a missing binding leaves every channel intact', async (t) => {
  const data = fixture()
  const source = new THREE.MeshStandardMaterial({
    map: new THREE.Texture(),
    emissiveMap: new THREE.Texture(),
    emissive: 0x123456,
    emissiveIntensity: 0.4,
  })
  source.name = 'Scope'
  data.gltf.scene.add(new THREE.Mesh(data.geometry, source))
  data.manifest.materials.scope = ['Scope']
  data.manifest.skins.plain = { url: 'skins/plain.json' }
  data.skin.materials.scope = structuredClone(data.skin.materials.weapon)
  data.skin.materials.scope.emissiveMap = { ...data.skin.materials.scope.map, url: '../textures/scope-emission.png' }
  const f = setup(t, data, {
    json(entry) {
      if (entry.url.endsWith('manifest.json'))
        return data.manifest
      const skin = structuredClone(data.skin)
      if (entry.url.endsWith('plain.json')) {
        skin.skinId = 'plain'
        delete skin.materials.scope
        skin.materials.weapon.emissiveMap = { ...skin.materials.weapon.map, url: '../textures/plain-emission.png' }
      }
      return skin
    },
  })
  const scoped = await f.assets.load(request)
  const plain = await f.assets.load({ ...request, skinId: 'plain' })
  const instance = f.assets.instantiate(scoped)
  const weapon = instance.root.getObjectByName('WeaponMesh').material
  const scope = instance.root.children.find(object => object.material?.name === 'Scope').material
  const originalMap = weapon.map
  const scopeMap = scope.map
  const scopeEmission = scope.emissiveMap
  source.name = 'MissingScope'
  assert.throws(() => f.assets.applySkin(instance, plain), /Missing instance material/)
  assert.equal(instance.skinId, 'smite')
  assert.equal(weapon.map, originalMap)
  assert.equal(weapon.emissiveMap, originalMap)
  assert.equal(scope.map, scopeMap)
  assert.equal(scope.emissiveMap, scopeEmission)
  source.name = 'Scope'
  f.assets.applySkin(instance, plain)
  assert.ok(weapon.emissiveMap?.isTexture)
  assert.equal(scope.map, source.map)
  assert.equal(scope.emissiveMap, source.emissiveMap)
  assert.ok(scope.emissive.equals(source.emissive))
  assert.equal(scope.emissiveIntensity, 0.4)
})

test('invalid emission inputs reject preparation before downloading any skin maps', async (t) => {
  for (const [label, change] of [
    [
      'unknown channel',
      input => input.normalMap = input.map,
    ],
    [
      'missing URL',
      input => delete input.emissiveMap.url,
    ],
    [
      'linear emission',
      input => input.emissiveMap.colorSpace = 'linear',
    ],
    [
      'flipped UVs',
      input => input.emissiveMap.flipY = true,
    ],
    [
      'linear mag filter',
      input => input.emissiveMap.magFilter = 'linear',
    ],
    [
      'mip min filter',
      input => input.emissiveMap.minFilter = 'mipmap',
    ],
    [
      'generated mipmaps',
      input => input.emissiveMap.generateMipmaps = true,
    ],
    [
      'negative intensity',
      input => input.emissiveIntensity = -1,
    ],
    [
      'infinite intensity',
      input => input.emissiveIntensity = Infinity,
    ],
    [
      'NaN intensity',
      input => input.emissiveIntensity = NaN,
    ],
    [
      'string intensity',
      input => input.emissiveIntensity = '2',
    ],
    [
      'intensity without a map',
      (input) => {
        delete input.emissiveMap
        input.emissiveIntensity = 2
      },
    ],
  ]) {
    await t.test(label, async (child) => {
      const data = fixture()
      const input = data.skin.materials.weapon
      input.emissiveMap = { ...input.map, url: '../textures/emission.png' }
      change(input)
      const f = setup(child, data)
      await assert.rejects(f.assets.load(request), /material inputs|sampling profile|emissiveIntensity/)
      assert.equal(f.calls.filter(entry => entry.type === 'texture').length, 0)
    })
  }
})

test('a skin cannot replace character arm materials', async (t) => {
  const data = fixture()
  data.skin.materials.armsLeft = structuredClone(data.skin.materials.weapon)
  const f = setup(t, data)
  await assert.rejects(f.assets.load(request), /never character arms/)
})

test('out-of-order skin requests warm independent handles without creating a stale visual instance', async (t) => {
  const data = fixture()
  data.manifest.skins.alternate = { url: 'skins/alternate.json' }
  const slow = Promise.withResolvers()
  const fast = Promise.withResolvers()
  const f = setup(t, data, {
    json(entry) {
      if (entry.url.endsWith('manifest.json'))
        return data.manifest
      const skin = structuredClone(data.skin)
      if (entry.url.endsWith('alternate.json')) {
        skin.skinId = 'alternate'
        skin.materials.weapon.map.url = '../textures/alternate.png'
      }
      return skin
    },
    texture(entry) {
      return entry.url.endsWith('alternate.png')
        ? fast.promise
        : slow.promise
    },
  })
  const instantiate = t.mock.method(f.resources, 'instantiate')
  const controller = new AbortController()
  const abandoned = assert.rejects(f.assets.load(request, { signal: controller.signal }), { name: 'AbortError' })
  const latest = f.assets.load({ ...request, skinId: 'alternate' })
  await flush()
  controller.abort()
  await abandoned
  const alternateTexture = new THREE.Texture()
  fast.resolve(alternateTexture)
  const latestHandle = await latest
  assert.equal(latestHandle.skinId, 'alternate')
  assert.equal(instantiate.mock.callCount(), 0)
  const originalTexture = new THREE.Texture()
  slow.resolve(originalTexture)
  const originalHandle = await f.assets.load(request)
  assert.equal(originalHandle.skinId, 'smite')
  assert.equal(instantiate.mock.callCount(), 0)
  const a = f.assets.instantiate(latestHandle)
  const b = f.assets.instantiate(originalHandle)
  assert.equal(a.root.getObjectByName('WeaponMesh').material.map, alternateTexture)
  assert.equal(b.root.getObjectByName('WeaponMesh').material.map, originalTexture)
  assert.equal(f.calls.filter(entry => entry.type === 'gltf').length, 1)
})

test('closing a scope rejects pending requests and ResourceManager releases a late non-cooperative result', async (t) => {
  const model = Promise.withResolvers()
  const f = setup(t, fixture(), {
    gltf: () => model.promise,
  })
  const rejected = assert.rejects(f.assets.load(request), { name: 'AbortError' })
  await flush()
  let geometryDisposals = 0
  f.data.geometry.addEventListener('dispose', () => geometryDisposals++)
  f.assets.dispose()
  await rejected
  assert.equal(f.calls.find(entry => entry.type === 'gltf').options.signal.aborted, true)
  model.resolve(f.data.gltf)
  await flush()
  assert.equal(geometryDisposals, 1)
  for (const entry of f.calls) assert.equal(f.resources.has(entry.name), false)
  await assert.rejects(f.assets.load(request), { name: 'AbortError' })
})

test('failed requests can retry and keep their successfully loaded sibling resources', async (t) => {
  let attempts = 0
  const data = fixture()
  const f = setup(t, data, {
    gltf() {
      if (++attempts === 1)
        throw new Error('temporary model failure')
      return data.gltf
    },
  })
  await assert.rejects(f.assets.load(request), /temporary model failure/)
  const asset = await f.assets.load(request)
  assert.equal(asset.weaponId, 'classic')
  assert.equal(attempts, 2)
  assert.equal(f.calls.filter(entry => entry.type === 'json').length, 2)
})

test('missing required actions, invalid root bindings and incompatible skins reject before instantiation', async (t) => {
  for (const [name, modify, pattern] of [
    [
      'action',
      data => data.manifest.requiredActions.push('fire'),
      /Missing required action/,
    ],
    [
      'binding',
      data => data.gltf.animations[0].tracks[0].name = 'Absent.position[x]',
      /Missing binding/,
    ],
    [
      'skin',
      data => data.skin.compatibility = { ...compatibility, rig: 'another-rig' },
      /Incompatible skin/,
    ],
    [
      'material',
      data => data.manifest.materials.weapon = ['Absent_Material'],
      /Missing material binding/,
    ],
  ]) {
    await t.test(name, async (child) => {
      const data = fixture()
      modify(data)
      const f = setup(child, data)
      const instantiate = child.mock.method(f.resources, 'instantiate')
      await assert.rejects(f.assets.load(request), pattern)
      assert.equal(instantiate.mock.callCount(), 0)
    })
  }
})

test('failed instance creation releases cloned materials and skeletons without releasing the template', async (t) => {
  const f = setup(t)
  const asset = await f.assets.load(request)
  const instantiate = f.resources.instantiate.bind(f.resources)
  let cloned
  let cloneMaterialDisposals = 0
  let skeletonDisposals = 0
  let sharedDisposals = 0
  f.data.geometry.addEventListener('dispose', () => sharedDisposals++)
  t.mock.method(f.resources, 'instantiate', (name) => {
    cloned = instantiate(name)
    // Corrupt only the new clone to make AnimationPlayer's binding validation fail after cloning materials.
    cloned.getObjectByName('WeaponBone').name = 'OtherBone'
    t.mock.method(cloned.getObjectByName('WeaponMesh').skeleton, 'dispose', () => skeletonDisposals++)
    return cloned
  })
  const clone = f.data.weaponMaterial.clone.bind(f.data.weaponMaterial)
  t.mock.method(f.data.weaponMaterial, 'clone', () => {
    const material = clone()
    material.addEventListener('dispose', () => cloneMaterialDisposals++)
    return material
  })
  assert.throws(() => f.assets.instantiate(asset), /Missing binding/)
  assert.equal(cloneMaterialDisposals, 1)
  assert.equal(skeletonDisposals, 1)
  assert.equal(sharedDisposals, 0)
  assert.equal(cloned.parent, null)
})

test('scope disposal releases every player and instance before shared resources, and rejects foreign handles', async (t) => {
  const f = setup(t)
  const asset = await f.assets.load(request)
  const instance = f.assets.instantiate(asset)
  instance.player.play('idle')
  const parent = new THREE.Group()
  parent.add(instance.root)
  const order = []
  instance.root.getObjectByName('WeaponMesh').material.addEventListener('dispose', () => order.push('instance'))
  f.data.geometry.addEventListener('dispose', () => {
    assert.equal(instance.player.snapshot().disposed, true)
    assert.equal(instance.root.parent, null)
    order.push('template')
  })
  const other = new WeaponAssets({ resources: f.resources, scopeId: 'other' })
  t.after(() => other.dispose())
  assert.throws(() => other.instantiate(asset), /this scope/)
  assert.throws(() => f.assets.instantiate({ ...asset }), /this scope/)
  f.assets.dispose()
  f.assets.dispose()
  instance.dispose()
  assert.deepEqual(order, ['instance', 'template'])
  assert.throws(() => f.assets.instantiate(asset), { name: 'AbortError' })
  for (const entry of f.calls) assert.equal(f.resources.has(entry.name), false)
})

test('external level abort closes completed assets and does not unload unrelated manager entries', async (t) => {
  const f = setup(t)
  const controller = new AbortController()
  const assets = new WeaponAssets({ resources: f.resources, scopeId: 'abortable', signal: controller.signal })
  t.after(() => assets.dispose())
  const asset = await assets.load(request)
  const instance = assets.instantiate(asset)
  await f.resources.load([
    { name: 'unrelated', type: 'json', url: '/unrelated.json' },
  ])
  controller.abort()
  assert.equal(instance.player.snapshot().disposed, true)
  assert.equal(f.resources.has('unrelated'), true)
  assert.throws(() => assets.instantiate(asset), { name: 'AbortError' })
})

test('a failing instance disposer cannot skip other instances or shared resource release', async (t) => {
  const f = setup(t)
  const handle = await f.assets.load(request)
  const first = f.assets.instantiate(handle)
  const second = f.assets.instantiate(handle)
  const failure = new Error('material listener failed')
  first.root.getObjectByName('WeaponMesh').material.addEventListener('dispose', () => {
    throw failure
  })
  assert.throws(() => f.assets.dispose(), error => error instanceof AggregateError
    && error.errors[0].errors.includes(failure))
  assert.equal(first.player.snapshot().disposed, true)
  assert.equal(second.player.snapshot().disposed, true)
  for (const entry of f.calls) assert.equal(f.resources.has(entry.name), false)
  assert.doesNotThrow(() => f.assets.dispose())
})

function withControls() {
  const data = fixture()
  data.gltf.animations.push(new THREE.AnimationClip('ammo_display', 1, [
    new THREE.VectorKeyframeTrack('WeaponBone.scale', [0, 1], [1, 1, 1, 0.00001, 0.00001, 0.00001]),
    new THREE.NumberKeyframeTrack('Arms.position[y]', [0, 1], [100, 200]),
  ]))
  data.manifest.clips.push({ name: 'ammo_display', duration: 1 })
  data.manifest.runtimeControls = {
    ammoDisplay: {
      clip: 'ammo_display',
      tracks: ['WeaponBone.scale'],
    },
  }
  data.manifest.ammoDisplay = {
    control: 'ammoDisplay',
    levels: [
      { minimum: 0, time: 1 },
      { minimum: 1, time: 0 },
    ],
  }
  return data
}

test('manifest controls preflight and instantiate as per-instance sparse bindings, preserving main actions and skins', async (t) => {
  const f = setup(t, withControls())
  const handle = await f.assets.load(request)
  const a = f.assets.instantiate(handle)
  const b = f.assets.instantiate(handle)
  a.player.play('idle')
  b.player.play('idle')
  a.player.setControls({ ammoDisplay: 1 })
  b.player.setControls({ ammoDisplay: 0 })
  assert.ok(a.root.getObjectByName('WeaponBone').scale.x < 0.00002)
  assert.equal(b.root.getObjectByName('WeaponBone').scale.x, 1)
  assert.equal(f.data.gltf.scene.getObjectByName('WeaponBone').scale.x, 1)
  assert.equal(a.root.getObjectByName('Arms').position.y, 0)
  a.player.advance(0.5)
  assert.equal(a.root.getObjectByName('WeaponBone').position.x, 1)
  assert.equal(a.player.snapshot().controls.bindings, 1)
  f.assets.dispose()
  for (const instance of [a, b]) {
    assert.equal(instance.player.snapshot().controls.bindings, 0)
    assert.equal(instance.root.getObjectByName('WeaponBone').scale.x, 1)
    assert.equal(instance.player.snapshot().disposed, true)
  }
})

test('invalid controls and ammo thresholds fail template preparation before cloning or downloading textures', async (t) => {
  for (const [label, change] of [
    [
      'missing clip',
      data => data.manifest.runtimeControls.ammoDisplay.clip = 'absent',
    ],
    [
      'missing track',
      data => data.manifest.runtimeControls.ammoDisplay.tracks = ['Absent.scale'],
    ],
    [
      'empty tracks',
      data => data.manifest.runtimeControls.ammoDisplay.tracks = [],
    ],
    [
      'duplicate track',
      data => data.manifest.runtimeControls.ammoDisplay.tracks.push('WeaponBone.scale'),
    ],
    [
      'null controls',
      data => data.manifest.runtimeControls = null,
    ],
    [
      'unknown display control',
      data => data.manifest.ammoDisplay.control = 'absent',
    ],
    [
      'no empty level',
      data => data.manifest.ammoDisplay.levels[0].minimum = 1,
    ],
    [
      'duplicate threshold',
      data => data.manifest.ammoDisplay.levels[1].minimum = 0,
    ],
    [
      'fractional threshold',
      data => data.manifest.ammoDisplay.levels[1].minimum = 0.5,
    ],
    [
      'time outside clip',
      data => data.manifest.ammoDisplay.levels[1].time = 2,
    ],
    [
      'NaN sample',
      data => data.manifest.ammoDisplay.levels[1].time = NaN,
    ],
  ]) {
    await t.test(label, async (child) => {
      const data = withControls()
      change(data)
      const f = setup(child, data)
      const instantiate = child.mock.method(f.resources, 'instantiate')
      await assert.rejects(f.assets.load(request), /control|ammo display/i)
      assert.equal(instantiate.mock.callCount(), 0)
      assert.equal(f.calls.filter(call => call.type === 'texture').length, 0)
    })
  }
})
