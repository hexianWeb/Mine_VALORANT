import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three/webgpu'
import { loaders } from '../src/engine/runtime/resource/loader/loaders.js'
import { ResourceManager } from '../src/engine/runtime/resource/resource-manager.js'
import { WeaponAssets } from '../src/game/weapons/assets/weapon-assets.js'

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

function setup(t, data = fixture(), overrides = {}) {
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
  const assets = new WeaponAssets({ resources, scopeId: 'test-level', baseUrl: 'https://assets.test/weapons/' })
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
