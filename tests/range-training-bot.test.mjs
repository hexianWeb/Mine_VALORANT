import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import test from 'node:test'
import { BackSide, ClampToEdgeWrapping, NearestFilter, NearestMipmapNearestFilter, Raycaster, Scene, SRGBColorSpace, Texture, Vector3 } from 'three/webgpu'
import { Level, MeshComponent, TransformComponent } from '../src/engine/runtime/function/framework/index.js'
import { loaders } from '../src/engine/runtime/resource/loader/loaders.js'
import { ResourceManager } from '../src/engine/runtime/resource/resource-manager.js'
import { ShotTargets } from '../src/game/targets/shot-targets.js'
import { loadTrainingBotAssets, TrainingBotComponent } from '../src/game/targets/training-bot.js'
import { traceWeaponImpact } from '../src/game/weapons/player-weapons.js'

async function fixture(t, { audio = null } = {}) {
  const fetch = globalThis.fetch
  const requests = []
  t.mock.method(globalThis, 'fetch', (url, options) => {
    const asset = new URL(url, 'https://training-bot.test/')
    if (asset.pathname.startsWith('/targets/') || asset.pathname.startsWith('/audio/bot/')) {
      requests.push(asset.pathname)
      return fs.readFile(new URL(`../public${asset.pathname}`, import.meta.url)).then(data => new Response(data))
    }
    return fetch(url, options)
  })
  // HTML image decoding is browser-only; keep the real loader for GLB bones/UVs.
  const loadTexture = loaders.texture
  t.mock.method(loaders, 'texture', async (entry, manager) => {
    if (!entry.url.startsWith('/targets/skin/'))
      return loadTexture(entry, manager)
    const response = await globalThis.fetch(entry.url, { signal: entry.options?.signal })
    const bytes = Buffer.from(await response.arrayBuffer())
    return new Texture({
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
    })
  })
  const globals = {
    self: globalThis,
    location: { href: 'https://training-bot.test/' },
    // Node runs the real GLTFLoader and pose sampling; Chrome decodes the texture.
    createImageBitmap: async (blob) => {
      const bytes = Buffer.from(await blob.arrayBuffer())
      return {
        width: bytes.readUInt32BE(16),
        height: bytes.readUInt32BE(20),
      }
    },
  }
  for (const [key, value] of Object.entries(globals)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { value, configurable: true })
    t.after(() => descriptor
      ? Object.defineProperty(globalThis, key, descriptor)
      : delete globalThis[key])
  }

  const scene = new Scene()
  const resources = new ResourceManager()
  const level = new Level({ scene })
  t.after(() => {
    level.dispose()
    resources.dispose()
  })
  const targets = new ShotTargets()
  const assets = level.disposer.add(await loadTrainingBotAssets({ resources, audio }))
  await assets.audioReady
  const object = level.addObject(assets.instantiate({
    scene,
    targets,
    position: [0, 0, 0],
  }))
  const bot = object.requireComponent(TrainingBotComponent)
  const root = object.requireComponent(MeshComponent).root
  const step = (count) => {
    for (let i = 0; i < count; i++) {
      level.tickComponents('fixed', {
        time: { fixedDelta: 1 / 60 },
      })
    }
  }
  return {
    level,
    object,
    bot,
    root,
    targets,
    step,
    assets,
    requests,
    resources,
  }
}

test('committed head/body hits play one sound per target and shot, and removal cancels only that bot', async (t) => {
  const cues = []
  const invalidations = []
  const audio = {
    async decode(bytes) {
      assert.equal(Buffer.from(bytes).toString('ascii', 0, 4), 'OggS')
      return { bytes: bytes.byteLength }
    },
    enqueue(cue) { cues.push(cue) },
    invalidate(filter) { invalidations.push(filter) },
    reportOnce(key, error) { assert.fail(`${key}: ${error}`) },
  }
  const { level, object, bot, targets, requests, assets } = await fixture(t, { audio })
  assert.ok(requests.includes('/audio/bot/Head_Hit.ogg'))
  assert.ok(requests.includes('/audio/bot/Body_Hit.ogg'))
  const impact = (region, distance = 1, targetId = object.id) => ({ targetId, region, distance })
  targets.react([
    impact('chest', 2),
    impact('head'),
    impact('head'),
  ], { at: 0.5 })
  assert.equal(cues.length, 1, 'multiple pellets cause only one hit cue')
  assert.equal(cues[0].group, 'bot-hit:head')
  assert.equal(cues[0].at, 0.5)
  assert.equal(cues[0].owner, object.id)
  assert.equal(cues[0].kind, 'transient')
  const bodyRegions = [
    'chest',
    'arm_l',
    'arm_r',
    'leg_l',
    'leg_r',
  ]
  for (const region of bodyRegions) {
    targets.react([
      impact(region),
    ], { at: 0.6 })
  }
  assert.equal(cues.length, 6)
  assert.ok(cues.slice(1).every(cue => cue.group === 'bot-hit:body'))
  assert.ok(cues.slice(1).every(cue => cue.buffer === cues[1].buffer))
  assert.notEqual(cues[0].buffer, cues[1].buffer)
  assert.equal(new Set(cues.map(cue => cue.id)).size, cues.length)

  bot.enabled = false
  targets.react([
    impact('head'),
  ], { at: 0.7 })
  bot.enabled = true
  object.active = false
  targets.react([
    impact('head'),
  ], { at: 0.7 })
  object.active = true
  targets.react([
    { hit: null },
  ], { at: 0.7 })
  assert.equal(cues.length, 6, 'disabled/inactive bots and misses stay silent')

  const second = level.addObject(assets.instantiate({
    scene: level.scene,
    targets,
    position: [3, 0, 0],
  }))
  targets.react([
    impact('chest', 1, second.id),
  ], { at: 0.8 })
  assert.equal(cues[6].owner, second.id)
  assert.equal(cues[6].buffer, cues[1].buffer, 'audio buffers are shared across instances')
  level.removeObject(object.id)
  assert.deepEqual(invalidations.at(-1), { scope: cues[0].scope, owner: object.id })
  targets.react([
    impact('head'),
  ], { at: 0.9 })
  assert.equal(cues.length, 7, 'removed bots cannot enqueue sounds')
})

test('public bot assets get an occluded outline that follows the same animated skeleton', async (t) => {
  const { bot, root, step, requests } = await fixture(t)
  assert.deepEqual(requests, [
    '/targets/training-bot/range-training-bot.hitboxes.json',
    '/targets/training-bot/range-training-bot.glb',
    '/targets/skin/Range_Bot_Blue_128x128.png',
    '/targets/skin/Range_Bot_Yellow_128x128.png',
    '/targets/skin/Range_Bot_urple_128x128.png',
  ])
  const mesh = root.getObjectByProperty('isSkinnedMesh', true)
  const shell = mesh.children.find(node => node.isSkinnedMesh)
  assert.ok(shell, 'one outline shell is attached to the rendered mesh')
  assert.equal(shell.children.length, 0, 'shells do not recursively create shells')
  assert.equal(shell.skeleton, mesh.skeleton)
  assert.ok(shell.bindMatrix.equals(mesh.bindMatrix))
  assert.notEqual(shell.geometry, mesh.geometry)
  assert.notEqual(shell.geometry.attributes.normal, mesh.geometry.attributes.normal)
  assert.notDeepEqual(
    shell.geometry.attributes.normal.array,
    mesh.geometry.attributes.normal.array,
    'outline-only normals close the flat cuboid seams',
  )
  assert.equal(shell.material.side, BackSide)
  assert.equal(shell.material.depthTest, true)
  assert.equal(shell.material.depthWrite, false, 'outline does not pollute AO depth')
  assert.equal(shell.material.alphaTest, mesh.material.alphaTest)
  assert.ok(shell.material.vertexNode, 'outline expansion runs in the WebGPU vertex stage')
  assert.ok(shell.material.colorNode, 'flat outline color preserves texture alpha')
  assert.equal(shell.material.color.getHex(), 0x7A56A0)
  assert.equal(shell.castShadow, false)
  assert.equal(shell.receiveShadow, false)
  assert.equal(shell.frustumCulled, false)
  assert.deepEqual(new Raycaster().intersectObject(shell), [], 'outline is not pickable')

  const head = mesh.skeleton.bones.findIndex(bone => bone.name === 'head')
  const { skinIndex, skinWeight, position } = mesh.geometry.attributes
  const vertex = Array.from({ length: position.count }, (_, i) => i)
    .find(i => skinIndex.getX(i) === head && skinWeight.getX(i) > 0.99)
  assert.notEqual(vertex, undefined)
  root.updateMatrixWorld(true)
  const before = mesh.getVertexPosition(vertex, new Vector3())
  bot.react({ region: 'head' })
  step(5)
  root.updateMatrixWorld(true)
  const after = mesh.getVertexPosition(vertex, new Vector3())
  const outlined = shell.getVertexPosition(vertex, new Vector3())
  assert.ok(after.distanceTo(before) > 0.001)
  assert.ok(after.distanceTo(outlined) < 1e-6, 'base and shell skinning use the same pose')
})

test('three skins bind to the existing UVs with difficulty metadata and independent poses', async (t) => {
  const { level, assets, targets, resources } = await fixture(t)
  const template = resources.get('range-room:training-bot:model', 'gltf').scene.getObjectByProperty('isSkinnedMesh', true)
  const originalMap = template.material.map
  const entries = [
    ['blue', 'easy', '简单', 0x4F9ED9],
    ['yellow', 'normal', '普通', 0xD6B64A],
    ['purple', 'hard', '困难', 0x7A56A0],
  ].map(([skin, difficulty, label, outlineColor], index) => {
    const object = level.addObject(assets.instantiate({
      scene: level.scene,
      targets,
      position: [index * 2.4, 0, 0],
      skin,
    }))
    const bot = object.requireComponent(TrainingBotComponent)
    const mesh = object.requireComponent(MeshComponent).root.getObjectByProperty('isSkinnedMesh', true)
    assert.equal(bot.snapshot().skin, skin)
    assert.equal(bot.snapshot().difficulty, difficulty)
    assert.equal(bot.snapshot().difficultyLabel, label)
    assert.equal(mesh.geometry, template.geometry, 'skins do not duplicate or change UV geometry')
    assert.notEqual(mesh.material, template.material)
    assert.equal(mesh.material.map.name, `Training bot:${skin}`)
    assert.equal(mesh.material.map.colorSpace, SRGBColorSpace)
    assert.equal(mesh.material.map.flipY, false)
    assert.equal(mesh.material.map.magFilter, NearestFilter)
    assert.equal(mesh.material.map.minFilter, NearestMipmapNearestFilter)
    assert.equal(mesh.material.map.wrapS, ClampToEdgeWrapping)
    assert.equal(mesh.material.map.wrapT, ClampToEdgeWrapping)
    assert.equal(mesh.material.alphaTest, template.material.alphaTest)
    const shell = mesh.children.find(node => node.isSkinnedMesh)
    assert.equal(shell.material.color.getHex(), outlineColor)
    assert.equal(shell.material.side, BackSide)
    assert.equal(shell.material.depthTest, true)
    assert.equal(shell.material.depthWrite, false)
    assert.deepEqual([mesh.material.map.image.width, mesh.material.map.image.height], [128, 128])
    return { object, bot, mesh }
  })
  assert.equal(template.material.map, originalMap, 'the GLB template keeps its embedded texture')
  assert.equal(new Set(entries.map(entry => entry.mesh.material.map)).size, 3)
  assert.equal(new Set(entries.map(entry => entry.mesh.skeleton)).size, 3)
  entries[0].bot.react({ region: 'head' })
  assert.equal(entries[1].bot.snapshot().reaction, null)
  assert.equal(entries[2].bot.snapshot().reaction, null)
  assert.throws(() => assets.instantiate({
    scene: level.scene,
    targets,
    position: [0, 0, 0],
    skin: 'unknown',
  }), /Unknown skin/u)

  const duplicate = level.addObject(assets.instantiate({
    scene: level.scene,
    targets,
    position: [0, 0, 3],
    skin: 'blue',
  }))
  const duplicateMesh = duplicate.requireComponent(MeshComponent).root.getObjectByProperty('isSkinnedMesh', true)
  assert.equal(duplicateMesh.material, entries[0].mesh.material, 'same-skin materials are cached per level')
  assert.equal(
    duplicateMesh.children.find(node => node.isSkinnedMesh).material,
    entries[0].mesh.children.find(node => node.isSkinnedMesh).material,
    'same-skin outlines are cached without leaking other skins\' colors',
  )
  assert.notEqual(duplicateMesh.skeleton, entries[0].mesh.skeleton)
  let materialDisposals = 0
  let textureDisposals = 0
  duplicateMesh.material.addEventListener('dispose', () => materialDisposals++)
  duplicateMesh.material.map.addEventListener('dispose', () => textureDisposals++)
  level.removeObject(duplicate.id)
  assert.equal(materialDisposals, 0)
  assert.equal(textureDisposals, 0)
  level.dispose()
  assert.equal(materialDisposals, 1)
  assert.equal(textureDisposals, 1)
  for (const skin of ['blue', 'yellow', 'purple'])
    assert.equal(resources.has(`range-room:training-bot:skin:${skin}`), false)
})

test('outline data is shared across bots and released only after their instances', async (t) => {
  const { level, object, root, assets, targets } = await fixture(t)
  const second = level.addObject(assets.instantiate({
    scene: level.scene,
    targets,
    position: [3, 0, 0],
  }))
  const mesh = root.getObjectByProperty('isSkinnedMesh', true)
  const other = second.requireComponent(MeshComponent).root.getObjectByProperty('isSkinnedMesh', true)
  const shell = mesh.children.find(node => node.isSkinnedMesh)
  const otherShell = other.children.find(node => node.isSkinnedMesh)
  assert.equal(shell.geometry, otherShell.geometry)
  assert.equal(shell.material, otherShell.material)
  assert.notEqual(shell.skeleton, otherShell.skeleton)
  const skeletonDispose = t.mock.method(mesh.skeleton, 'dispose')
  const otherSkeletonDispose = t.mock.method(other.skeleton, 'dispose')
  let geometryDisposals = 0
  let materialDisposals = 0
  shell.geometry.addEventListener('dispose', () => geometryDisposals++)
  shell.material.addEventListener('dispose', () => materialDisposals++)
  level.removeObject(object.id)
  assert.equal(skeletonDispose.mock.callCount(), 1)
  assert.equal(otherSkeletonDispose.mock.callCount(), 0)
  assert.equal(geometryDisposals, 0)
  assert.equal(materialDisposals, 0)
  assert.equal(level.scene.children.length, 1)
  level.dispose()
  assert.equal(otherSkeletonDispose.mock.callCount(), 1)
  assert.equal(geometryDisposals, 1)
  assert.equal(materialDisposals, 1)
})

test('the exported GO resolves all six hit regions and its reactions restore the guard pose', async (t) => {
  const { object, bot, root, targets, step } = await fixture(t)
  const shots = [
    {
      origin: [0, 2.29, -4],
      region: 'head',
      bone: 'head',
    },
    {
      origin: [0, 1.56, -4],
      region: 'chest',
      bone: 'torso',
    },
    // These lines pass through the raised forearm before reaching the chest.
    {
      origin: [-0.396, 1.568, -4],
      region: 'arm_l',
      bone: 'left_elbow',
    },
    {
      origin: [0.288, 1.568, -4],
      region: 'arm_r',
      bone: 'right_elbow',
    },
    {
      origin: [-0.42, 0.48, -4],
      region: 'leg_l',
      bone: 'left_shin',
    },
    {
      origin: [0.42, 0.48, -4],
      region: 'leg_r',
      bone: 'right_shin',
    },
  ]
  for (const { origin, region, bone } of shots) {
    const joint = root.getObjectByName(bone)
    const guard = joint.quaternion.clone()
    const hit = traceWeaponImpact(origin, [0, 0, 1], { boxes: [] }, 200, targets)
    assert.equal(hit.targetId, object.id)
    assert.equal(hit.region, region)
    assert.equal(hit.surface, 'metal')
    targets.react([hit])
    assert.equal(bot.snapshot().reaction.clip, `hit_${region}`)
    step(5)
    assert.ok(joint.quaternion.angleTo(guard) > 0.01, bone)
    step(20)
    assert.equal(bot.snapshot().reaction, null)
    assert.ok(joint.quaternion.angleTo(guard) < 0.001, bone)
  }
  assert.equal(bot.snapshot().hitCount, 6)
})

test('room occlusion caps target queries, and one shot reacts once at its nearest pellet per GO', async (t) => {
  const { level, object, bot, targets } = await fixture(t)
  const direction = [0, 0, 1]
  const trace = (origin, boxes = []) => traceWeaponImpact(origin, direction, { boxes }, 200, targets)
  const arm = [-0.396, 1.568, -4]
  const wall = {
    name: 'wall',
    min: [-2, 0, -2],
    max: [2, 3, -1.9],
  }
  assert.equal(trace(arm, [wall]).hit, 'wall')
  assert.equal(trace([0, 0.5, -4]).hit, null, 'the broadphase alone does not count as a hit')
  const armHit = trace(arm)
  const chestHit = trace([0, 1.56, -4])
  assert.ok(armHit.distance < chestHit.distance)
  targets.react([chestHit, armHit, armHit])
  assert.equal(bot.snapshot().reaction.clip, 'hit_arm_l')
  assert.equal(bot.snapshot().hitCount, 1)

  // The logical placement can advance before MeshComponent presents it.
  const transform = object.requireComponent(TransformComponent)
  transform.teleport(new Vector3(3, 1, 2))
  transform.scale.setScalar(0.75)
  transform.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), 0.4)
  const worldOrigin = new Vector3(...arm).multiplyScalar(0.75).applyQuaternion(transform.quaternion).add(transform.position).toArray()
  const worldDirection = new Vector3(...direction).applyQuaternion(transform.quaternion).toArray()
  const placed = traceWeaponImpact(worldOrigin, worldDirection, { boxes: [] }, 200, targets)
  assert.equal(placed.region, 'arm_l')
  assert.ok(Math.abs(placed.distance - armHit.distance * 0.75) < 1e-5)
  level.removeObject(object.id)
  assert.equal(traceWeaponImpact(worldOrigin, worldDirection, { boxes: [] }, 200, targets).hit, null)
  assert.equal(level.scene.children.length, 0)
})
