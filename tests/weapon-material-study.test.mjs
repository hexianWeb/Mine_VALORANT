import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import test from 'node:test'
import * as THREE from 'three/webgpu'
import { loaders } from '../src/engine/runtime/resource/loader/loaders.js'
import { ResourceManager } from '../src/engine/runtime/resource/resource-manager.js'
import { reflectionCubeFromBytes, reflectionEncoding, roomReflectionDefinition, validateReflectionManifest } from '../src/game/range-room/lighting/reflection-data.js'
import { WeaponAssets } from '../src/game/weapons/assets/weapon-assets.js'
import { createWeaponMaterialStudy } from '../src/game/weapons/assets/weapon-material-study.js'

function fixture() {
  const scene = new THREE.Scene()
  scene.environment = new THREE.Texture()
  scene.environmentIntensity = 0.35
  const reflection = {
    texture: new THREE.CubeTexture(),
    enabled: true,
    definition: roomReflectionDefinition,
    getDebugState: () => ({ ready: true }),
  }
  const study = createWeaponMaterialStudy({ scene, reflection })
  const material = new THREE.MeshPhysicalMaterial({
    roughness: 0.42,
    metalness: 0.8,
    clearcoat: 0.29,
    emissive: 0xFFFFFF,
    emissiveIntensity: 0.6,
  })
  material.name = 'Weapon_Skin'
  material.emissiveMap = new THREE.Texture()
  const arms = new THREE.MeshStandardMaterial({ roughness: 0.96, metalness: 0 })
  arms.name = 'Character_Left'
  const root = new THREE.Group()
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material)
  mesh.name = 'Gun'
  mesh.position.fromArray(roomReflectionDefinition.position)
  const arm = new THREE.Mesh(mesh.geometry, arms)
  root.add(mesh, arm)
  root.updateMatrixWorld(true)
  const handle = { weaponId: 'classic', assetVersion: 'v4', skinId: 'ag' }
  const roles = new Map([
    ['Weapon_Skin', 'weapon'],
    ['Character_Left', 'armsLeft'],
  ])
  return {
    scene,
    reflection,
    study,
    root,
    mesh,
    material,
    arms,
    handle,
    roles,
  }
}

test('AG study is flat full metal with color-map emission x0.4, keeping clearcoat, arms and pixels untouched', () => {
  const f = fixture()
  const map = f.material.map
  const emissiveMap = f.material.emissiveMap
  const arms = f.arms.toJSON()
  const hook = f.mesh.onBeforeRender
  const binding = f.study.attach(f.root, f.handle, f.roles)
  assert.equal(f.mesh.onBeforeRender, hook, 'the study must not patch render callbacks')
  assert.equal(f.material.flatShading, true)
  assert.equal(f.material.metalness, 1)
  assert.equal(f.material.roughness, 1)
  assert.equal(f.material.clearcoat, 0.29)
  assert.equal(f.material.clearcoatRoughness, 0.18)
  assert.equal(f.material.emissiveIntensity, 0.4)
  assert.equal(f.material.emissive.getHex(), 0xFFFFFF)
  assert.equal(f.material.emissiveMap, emissiveMap)
  assert.equal(f.material.map, map)
  assert.equal(f.material.envMap, f.reflection.texture)
  assert.deepEqual(f.arms.toJSON(), arms)
  f.material.roughness = 0.7
  f.material.metalness = 0.3
  f.mesh.onBeforeRender()
  assert.equal(f.material.roughness, 0.7, 'external edits must survive drawing')
  assert.equal(f.material.metalness, 0.3)
  f.material.metalness = 0.8
  binding.dispose()
  assert.equal(f.material.metalness, 0.8)
  assert.equal(f.material.clearcoat, 0.29)
  assert.equal(f.material.emissiveIntensity, 0.6)
  assert.equal(f.study.getDebugState().attachments, 0)
})

test('skin changes and switches back to AG reapply the study, while other weapons remain unchanged', () => {
  const f = fixture()
  const binding = f.study.attach(f.root, { ...f.handle, skinId: 'sakura' }, f.roles)
  assert.equal(f.material.metalness, 0.8)
  binding.setSkin(f.handle)
  assert.equal(f.material.emissiveIntensity, 0.4)
  binding.setSkin({ ...f.handle, skinId: 'sakura' })
  assert.equal(f.material.emissiveIntensity, 0.6)
  assert.equal(f.material.metalness, 0.8)
  binding.setSkin(f.handle)
  assert.equal(f.material.metalness, 1)
  assert.equal(f.study.attach(f.root, { ...f.handle, weaponId: 'phantom' }, f.roles), null)
  f.study.setLighting({ enabled: false })
  assert.equal(f.material.metalness, 0.8)
  f.study.setLighting({ enabled: true })
  assert.equal(f.material.metalness, 1)
  binding.dispose()
  f.study.dispose()
})

test('reflection source is indoor whenever loaded, supports sky/off, and respects global lighting on refresh', () => {
  const f = fixture()
  const binding = f.study.attach(f.root, f.handle, f.roles)
  assert.equal(f.study.getDebugState().resolvedSource, 'indoor')
  f.mesh.position.x = 1000
  f.root.updateMatrixWorld(true)
  f.mesh.onBeforeRender()
  assert.equal(f.material.envMap, f.reflection.texture, 'position no longer switches the source')
  f.reflection.enabled = false
  f.study.refresh()
  assert.equal(f.material.envMapIntensity, 0)
  f.study.setLighting({ source: 'sky' })
  assert.equal(f.material.envMap, f.scene.environment)
  f.study.setLighting({ source: 'off' })
  assert.equal(f.material.envMapIntensity, 0)
  const before = f.study.getDebugState()
  assert.throws(() => f.study.setLighting({ roughness: 0.5, intensity: NaN }), /Invalid/)
  assert.throws(() => f.study.setLighting({ toString: true }), /Invalid/)
  assert.deepEqual(f.study.getDebugState(), before)
  let disposals = 0
  f.reflection.texture.addEventListener('dispose', () => disposals++)
  binding.dispose()
  f.study.dispose()
  assert.equal(disposals, 0, 'the study only borrows the scene reflection')
})

test('brightness calibration scales only indoor reflections without altering emission or sky fallback', () => {
  const f = fixture()
  const binding = f.study.attach(f.root, f.handle, f.roles)
  assert.equal(f.study.getDebugState().intensity, 0.3)
  assert.equal(f.material.envMapIntensity, 0.3)
  f.study.setLighting({ intensity: 1.8 })
  assert.equal(f.material.envMapIntensity, 1.8)
  assert.equal(f.material.emissiveIntensity, 0.4)
  assert.equal(f.material.roughness, 1)
  f.study.setLighting({ source: 'sky' })
  assert.equal(f.material.envMapIntensity, 0.35, 'sky fallback must not receive the indoor artistic gain')
  f.study.setLighting({ source: 'off' })
  assert.equal(f.material.envMapIntensity, 0)
  binding.dispose()
  f.study.dispose()
})

test('WeaponAssets keeps the study binding across atomic skin swaps and releases it on instance disposal', async (t) => {
  const f = fixture()
  const compatibility = { rig: 'r', geometryUV: 'u', clipSet: 'c' }
  const manifest = {
    schemaVersion: 1,
    weaponId: 'classic',
    assetVersion: 'v4',
    compatibility,
    model: {
      url: 'model.glb',
    },
    skins: {
      ag: { url: 'ag.json' },
      sakura: { url: 'sakura.json' },
    },
    actions: { idle: 'idle' },
    requiredActions: ['idle'],
    clips: [
      { name: 'idle' },
    ],
    materials: {
      weapon: ['Weapon_Skin'],
      armsLeft: ['Character_Left'],
    },
  }
  const clip = new THREE.AnimationClip('idle', 1, [
    new THREE.NumberKeyframeTrack('Gun.position[x]', [0, 1], [0, 1]),
  ])
  const gltf = {
    scene: f.root,
    animations: [clip],
  }
  t.mock.method(loaders, 'gltf', async () => gltf)
  t.mock.method(loaders, 'texture', async () => new THREE.Texture())
  t.mock.method(loaders, 'json', async (entry) => {
    if (entry.url.endsWith('manifest.json'))
      return manifest
    return {
      schemaVersion: 1,
      weaponId: 'classic',
      assetVersion: 'v4',
      skinId: entry.url.endsWith('ag.json')
        ? 'ag'
        : 'sakura',
      compatibility,
      materials: {
        weapon: {
          map: {
            url: 'color.png',
            colorSpace: 'srgb',
            flipY: false,
            magFilter: 'nearest',
            minFilter: 'nearest',
            generateMipmaps: false,
          },
        },
      },
    }
  })
  const resources = new ResourceManager()
  const assets = new WeaponAssets({ resources, scopeId: 'study-test', materialStudy: f.study })
  t.after(() => {
    assets.dispose()
    resources.dispose()
    f.study.dispose()
  })
  const ag = await assets.load(f.handle)
  const sakura = await assets.load({ ...f.handle, skinId: 'sakura' })
  const instance = assets.instantiate(ag)
  const material = instance.root.getObjectByName('Gun').material
  const player = instance.player
  player.play('idle')
  player.advance(0.3)
  const playback = player.snapshot()
  assert.equal(material.metalness, 1)
  assets.applySkin(instance, sakura)
  assert.equal(material.metalness, 0.8)
  assets.applySkin(instance, ag)
  assert.equal(material.metalness, 1)
  assert.equal(instance.root.getObjectByName('Gun').material, material)
  assert.deepEqual(player.snapshot(), playback)
  instance.dispose()
  assert.equal(f.study.getDebugState().attachments, 0)
  assert.equal(f.material.metalness, 0.8, 'the shared source material was not modified')
})

test('published reflection source is finite scene-linear HDR, versioned and bound to the room and sky', () => {
  const base = new URL('../public/lighting/range-room-reflections/v1/', import.meta.url)
  const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', base), 'utf8'))
  const room = JSON.parse(fs.readFileSync(new URL('../public/lighting/range-room-lightmap/manifest.json', import.meta.url), 'utf8'))
  const hash = bytes => createHash('sha256').update(bytes).digest('hex')
  const source = {
    version: 1,
    three: THREE.REVISION,
    room: hash(JSON.stringify(room)),
    sky: hash(fs.readFileSync(new URL('../public/hdr/skybox-day.png', import.meta.url))),
    capture: roomReflectionDefinition,
    encoding: reflectionEncoding,
  }
  validateReflectionManifest(manifest, source)
  assert.throws(() => validateReflectionManifest(manifest, { ...source, sky: 'changed' }), /stale/)
  const bytes = fs.readFileSync(new URL(manifest.url, base))
  assert.equal(hash(bytes), manifest.sha256)
  const cube = reflectionCubeFromBytes(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  assert.equal(cube.colorSpace, THREE.LinearSRGBColorSpace)
  assert.equal(cube.type, THREE.HalfFloatType)
  assert.equal(cube.flipY, false)
  assert.equal(cube.images.length, 6)
  assert.ok(manifest.stats.every(face => face.rgbMean > 0))
  assert.ok(manifest.stats.some(face => face.rgbMax > 1), 'the stored reflection must retain HDR energy')
  assert.throws(() => reflectionCubeFromBytes(new ArrayBuffer(8)), /length/)
  const invalid = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  new DataView(invalid).setUint16(0, 0x7C00, true)
  assert.throws(() => reflectionCubeFromBytes(invalid), /Non-finite/)
  cube.dispose()
  for (const face of cube.images) face.dispose()
})
