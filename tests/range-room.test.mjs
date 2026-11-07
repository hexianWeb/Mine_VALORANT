import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import * as THREE from 'three/webgpu'
import { loaders } from '../src/engine/resources/loaders.js'
import { ResourceManager } from '../src/engine/resources/resources.js'
import { createRangeRoom } from '../src/world/range-room.js'
import { roomGroundConfig, roomGroundTextures } from '../src/world/room-ground.js'

const exportedManifest = JSON.parse(fs.readFileSync(new URL('../public/lighting/range-room/manifest.json', import.meta.url)))

function fixture(t, loadSky, loadGround) {
  const manifest = structuredClone(exportedManifest)
  manifest.atlases = manifest.atlases.map(page => ({ ...page, width: 1, height: 1 }))
  manifest.bindings = manifest.atlases.map((page, index) => ({
    receiverId: `receiver-${index}`,
    meshIndex: index,
    primitiveIndex: 0,
    materialIndex: index,
    sourceMaterial: `material-${index}`,
    mode: 'baked-appearance',
    atlasId: page.id,
    uvChannel: 1,
  }))
  const template = new THREE.Group()
  const associations = new Map()
  for (const binding of manifest.bindings) {
    const geometry = new THREE.BoxGeometry(10, 4, 8)
    geometry.setAttribute('uv1', geometry.getAttribute('uv').clone())
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial())
    mesh.userData.rangeRoomId = binding.receiverId
    associations.set(mesh, { meshes: binding.meshIndex, primitives: binding.primitiveIndex })
    template.add(mesh)
  }
  t.mock.method(globalThis, 'fetch', async () => Response.json(manifest))
  t.mock.method(loaders, 'gltf', async () => ({
    scene: template,
    parser: { associations },
  }))
  t.mock.method(loaders, 'exr', async () => new THREE.DataTexture(new Uint16Array(4), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType))
  const sky = new THREE.Texture({ width: 4096, height: 2048 })
  t.mock.method(loaders, 'texture', async (entry) => {
    if (entry.name === 'range-room:skybox-day') {
      return loadSky
        ? loadSky(entry)
        : sky
    }
    return loadGround
      ? loadGround(entry)
      : new THREE.Texture({ width: 16, height: 16 })
  })
  const globals = new Map()
  for (const [key, value] of Object.entries({
    location: { href: 'http://localhost/' },
    document: {
      createElement: () => ({
        getContext: () => ({
          drawImage() {},
        }),
      }),
    },
  })) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  }
  const scene = new THREE.Scene()
  const background = scene.background = new THREE.Color(0x123456)
  const environment = scene.environment = new THREE.Texture()
  scene.environmentIntensity = 0.7
  const camera = new THREE.PerspectiveCamera()
  const resources = new ResourceManager()
  const world = createRangeRoom({
    scene,
    camera,
    resources,
    maxAnisotropy: 8,
  })
  t.after(() => {
    world.dispose()
    resources.dispose()
    environment.dispose()
    for (const [key, descriptor] of globals) {
      if (descriptor)
        Object.defineProperty(globalThis, key, descriptor)
      else
        delete globalThis[key]
    }
  })
  const assertRestored = () => {
    assert.equal(world.snapshot().ready, false)
    assert.equal(scene.children.length, 0)
    assert.equal(scene.background, background)
    assert.equal(scene.environment, environment)
    assert.equal(scene.environmentIntensity, 0.7)
    assert.equal(resources.has('range-room:skybox-day'), false)
    for (const texture of roomGroundTextures)
      assert.equal(resources.has(texture.name), false)
    assert.equal(resources.has(`room:${manifest.id}:${manifest.model.sha256}:model`), false)
    for (const page of manifest.atlases)
      assert.equal(resources.has(`room:${manifest.id}:${manifest.model.sha256}:${page.id}`), false)
  }
  return {
    world,
    scene,
    camera,
    manifest,
    sky,
    assertRestored,
  }
}

test('room owns camera setup, lighting, environment and cleanup independently of a renderer', async (t) => {
  const { world, scene, camera, manifest, sky, assertRestored } = fixture(t)
  assert.equal(world.snapshot().ready, false)
  const pending = world.load()
  await assert.rejects(world.load(), /Already loaded\/loading/)
  const room = await pending
  assert.equal(room.root.parent, scene)
  assert.deepEqual(camera.position.toArray(), manifest.camera.position)
  assert.deepEqual(camera.quaternion.toArray(), manifest.camera.quaternion)
  for (const key of ['fov', 'near'])
    assert.equal(camera[key], manifest.camera[key])
  assert.equal(camera.far, Math.max(manifest.camera.far, roomGroundConfig.viewDistance))
  assert.equal(scene.background, sky)
  assert.equal(world.snapshot().ready, true)
  assert.equal(world.snapshot().sampling.anisotropy, 8)
  assert.deepEqual(world.snapshot().environmentSize, [1024, 512])
  assert.equal(world.snapshot().lights.filter(light => light.type === 'PointLight').length, 0)
  assert.equal(world.ground.root.parent, scene)
  assert.deepEqual(world.snapshot().bounds, world.snapshot().ground.roomBounds)
  assert.deepEqual(world.snapshot().ground.footprint.size, [10, 8])
  world.setRuntimeLighting(false)
  assert.equal(scene.environmentIntensity, 0)
  assert.equal(world.snapshot().ground.skyIntensity, 0)
  assert.ok(world.snapshot().lights.every(light => light.intensity === 0))
  world.setRuntimeLighting(true)
  assert.equal(scene.environmentIntensity, 0.35)
  assert.equal(world.snapshot().ground.skyIntensity, 1)
  assert.ok(world.snapshot().lights.some(light => light.intensity > 0))
  let skyDisposals = 0
  let proxyDisposals = 0
  sky.addEventListener('dispose', () => skyDisposals++)
  scene.environment.addEventListener('dispose', () => proxyDisposals++)
  world.dispose()
  world.dispose()
  assertRestored()
  assert.equal(skyDisposals, 1)
  assert.equal(proxyDisposals, 1)
  assert.throws(() => world.setRuntimeLighting(true), /Room is not ready/)
  await assert.rejects(world.load(), /disposed/)
})

test('sky load failure releases the already loaded room and restores the scene', async (t) => {
  const { world, assertRestored } = fixture(t, async () => {
    throw new Error('sky load failed')
  })
  await assert.rejects(world.load(), /sky load failed/)
  assertRestored()
})

test('disposing during sky loading releases late textures and never attaches lights', async (t) => {
  const started = Promise.withResolvers()
  const pendingSky = Promise.withResolvers()
  const { world, sky, scene, assertRestored } = fixture(t, () => {
    started.resolve()
    return pendingSky.promise
  })
  const pending = world.load()
  await started.promise
  assert.equal(scene.children.length, 1)
  assert.equal(world.snapshot().ready, false)
  let disposals = 0
  sky.addEventListener('dispose', () => disposals++)
  world.dispose()
  pendingSky.resolve(sky)
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(disposals, 1)
  assertRestored()
})

test('a ground texture load failure releases room, sky and partial ground assets', async (t) => {
  const { world, assertRestored } = fixture(t, undefined, async (entry) => {
    if (entry.name === 'range-room:ground-grass')
      throw new Error('grass load failed')
    return new THREE.Texture({ width: 16, height: 16 })
  })
  await assert.rejects(world.load(), /grass load failed/)
  assertRestored()
})

test('disposing during ground loading releases the late texture without attaching terrain', async (t) => {
  const started = Promise.withResolvers()
  const pendingGrass = Promise.withResolvers()
  const late = new THREE.Texture({ width: 16, height: 16 })
  let disposals = 0
  late.addEventListener('dispose', () => disposals++)
  const { world, assertRestored } = fixture(t, undefined, (entry) => {
    if (entry.name === 'range-room:ground-grass') {
      started.resolve()
      return pendingGrass.promise
    }
    return new THREE.Texture({ width: 16, height: 16 })
  })
  const pending = world.load()
  await started.promise
  world.dispose()
  pendingGrass.resolve(late)
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(disposals, 1)
  assert.equal(world.ground, null)
  assertRestored()
})
