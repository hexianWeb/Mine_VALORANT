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
  const sourceId = targets.openSource(1)
  let sequence = 0
  let tick = 0
  const cached = new Map()
  const present = (at = tick / 60) => level.tickComponents('motion', {
    time: { presentationTime: at },
  })
  const submit = (impacts, { at = Math.max(1, tick) / 60, definitionId = 'classic', presentation = true } = {}) => {
    tick = Math.round(at * 60)
    const time = { fixedTick: tick, fixedElapsed: tick / 60, fixedDelta: 1 / 60 }
    targets.beginShot(time)
    const pellets = impacts.map((impact, index) => {
      const owner = level.objects.get(impact.targetId)
      if (owner) {
        const position = owner.requireComponent(TransformComponent).position
        const captured = targets.trace([position.x, position.y + 2.29, position.z - 4], [0, 0, 1], 200)
        if (captured?.targetId === owner.id)
          cached.set(owner.id, captured)
      }
      return {
        index,
        direction: [0, 0, 1],
        impact: {
          hit: null,
          position: [0, 0, 0],
          normal: null,
          distance: 200,
          ...cached.get(impact.targetId),
          ...impact,
        },
      }
    })
    const result = targets.resolveShot({
      type: 'ShotFired',
      sourceId,
      epoch: 1,
      sequence: ++sequence,
      fixedTick: time.fixedTick,
      at: time.fixedElapsed,
      instanceId: 'test-weapon',
      payload: {
        weapon: { definitionId },
        pellets,
      },
    }, time)
    if (presentation)
      present(time.fixedElapsed)
    return result
  }
  const step = (count) => {
    for (let i = 0; i < count; i++) {
      tick++
      level.tickComponents('fixed', {
        time: { fixedTick: tick, fixedElapsed: tick / 60, fixedDelta: 1 / 60 },
      })
      present()
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
    submit,
    present,
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
  const { level, object, bot, targets, requests, assets, submit } = await fixture(t, { audio })
  assert.ok(requests.includes('/audio/bot/Head_Hit.ogg'))
  assert.ok(requests.includes('/audio/bot/Body_Hit.ogg'))
  const impact = (region, distance = 1, targetId = object.id) => ({ targetId, region, distance })
  submit([
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
    submit([
      impact(region),
    ], { at: 0.6 })
  }
  assert.equal(cues.length, 6)
  assert.ok(cues.slice(1).every(cue => cue.group === 'bot-hit:body'))
  assert.ok(cues.slice(1).every(cue => cue.buffer === cues[1].buffer))
  assert.notEqual(cues[0].buffer, cues[1].buffer)
  assert.equal(new Set(cues.map(cue => cue.id)).size, cues.length)

  bot.enabled = false
  submit([
    impact('head'),
  ], { at: 0.7 })
  bot.enabled = true
  object.active = false
  submit([
    impact('head'),
  ], { at: 0.7 })
  object.active = true
  submit([
    { hit: null },
  ], { at: 0.7 })
  assert.equal(cues.length, 6, 'disabled/inactive bots and misses stay silent')

  const second = level.addObject(assets.instantiate({
    scene: level.scene,
    targets,
    position: [3, 0, 0],
  }))
  submit([
    impact('chest', 1, second.id),
  ], { at: 0.8 })
  assert.equal(cues[6].owner, second.id)
  assert.equal(cues[6].buffer, cues[1].buffer, 'audio buffers are shared across instances')
  level.removeObject(object.id)
  assert.deepEqual(invalidations.at(-1), { scope: cues[0].scope, owner: object.id })
  submit([
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
  assets.setFlowGlow(1)
  const entries = [
    ['blue', 'easy', '简单', 0x4F9ED9],
    ['yellow', 'medium', '中等', 0xD6B64A],
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
    assert.ok(mesh.material.isNodeMaterial)
    assert.equal(mesh.material.mrtNode.get('keepColor').value, 1)
    assert.equal(mesh.material.emissive.getHex(), template.material.emissive.getHex(), 'Flow keeps the skin emission unchanged')
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
    assert.equal(shell.material.mrtNode, mesh.material.mrtNode, 'the outline shares the body mask')
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
  const { object, bot, root, targets, step, submit } = await fixture(t)
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
    submit([hit])
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
  const { level, object, bot, targets, submit } = await fixture(t)
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
  submit([chestHit, armHit, armHit])
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

test('real GLB authority/visible skeletons and placements are isolated across P; lethal facts detach pose and transform', async (t) => {
  const { object, bot, root, targets, submit, present, level } = await fixture(t)
  const head = root.getObjectByName('head')
  const guard = head.quaternion.clone()
  const spawn = {
    targetId: object.id,
    sessionId: 'test-session',
    spawnId: 'test-spawn',
    cellId: '3,1',
    position: [3, 0, 0],
    quaternion: [0, 0, 0, 1],
    scale: [1, 1, 1],
    at: 1 / 60,
    bodyHideTicks: 3,
  }
  bot.activateSpawn(spawn, { maxHealth: 100, maxArmor: 0 }, { fixedTick: 1, fixedElapsed: 1 / 60, fixedDelta: 1 / 60 })
  assert.equal(object.requireComponent(MeshComponent).enabled, false, 'latest Transform must not overwrite delayed P placement')
  assert.equal(root.position.x, 0)
  const hit = targets.trace([3, 2.29, -4], [0, 0, 1], 200)
  assert.equal(hit.sessionId, spawn.sessionId)
  assert.equal(hit.spawnId, spawn.spawnId)
  const nonlethal = submit([hit], { at: 1 / 60, presentation: false })
  assert.equal(nonlethal.damage[0].amount, 78)
  assert.equal(bot.snapshot().combat.attributes.health, 22)
  assert.equal(bot.snapshot().poses.presentation, null)
  present(0)
  assert.equal(root.position.x, 0)
  present(1 / 60)
  assert.equal(root.position.x, 3)
  bot.tick({
    phase: 'fixed',
    time: { fixedTick: 6, fixedElapsed: 0.1, fixedDelta: 1 / 60 },
  })
  const before = targets.trace([3, 2.29, -4], [0, 0, 1], 200)
  present(1 / 60)
  const authority = bot.snapshot().poses.authority
  present(0.1)
  assert.deepEqual(targets.trace([3, 2.29, -4], [0, 0, 1], 200), before)
  assert.deepEqual(bot.snapshot().poses.authority, authority)
  const secondHit = targets.trace([3, 1.56, -4], [0, 0, 1], 200)
  const lethal = submit([secondHit], { at: 0.2, definitionId: 'sheriff', presentation: false })
  assert.equal(lethal.deaths.length, 1)
  assert.equal(lethal.reactions.length, 0)
  assert.equal(bot.snapshot().hitCount, 1, 'lethal does not also start a normal hit reaction')
  assert.equal(targets.trace([3, 1.56, -4], [0, 0, 1], 200), null)
  const killed = lethal.deaths[0]
  assert.deepEqual(killed.position, [3, 0, 0])
  assert.equal(killed.bodyHideAt, 0.25)
  assert.ok(killed.pose.length > 10)
  assert.ok(Object.isFrozen(killed.pose[0].quaternion))
  assert.ok(Number.isSafeInteger(killed.presentationSeed))
  const captured = JSON.stringify(killed)
  object.requireComponent(TransformComponent).teleport(new Vector3(9, 0, 0))
  present(0.2)
  assert.equal(JSON.stringify(killed), captured, 'death never borrows a new life\'s mutable placement or bones')
  const state = bot.snapshot()
  assert.equal(state.poses.pending, 0)
  present(0.2)
  assert.equal(bot.snapshot().poses.pending, 0, 'same P does not replay')

  // A fixed step can reuse this instance while P is still showing the old body.
  bot.activateSpawn({
    ...spawn,
    spawnId: 'next-spawn',
    cellId: '9,1',
    position: [9, 0, 0],
    at: 0.25,
  }, { maxHealth: 100, maxArmor: 0 }, { fixedTick: 15, fixedElapsed: 0.25, fixedDelta: 1 / 60 })
  present(0.249)
  assert.equal(bot.snapshot().poses.visibleSpawn, spawn.spawnId)
  assert.equal(root.position.x, 3)
  present(0.25)
  assert.equal(bot.snapshot().poses.visibleSpawn, 'next-spawn')
  assert.equal(bot.snapshot().poses.bodyHideAt, null)
  assert.equal(root.visible, true)
  assert.equal(root.position.x, 9)
  assert.ok(head.quaternion.angleTo(guard) < 1e-6, 'reused body restores the authored guard pose')
  level.removeObject(object.id)
})

test('a reused challenge bot changes its skin and outline together at the new spawn time', async (t) => {
  const { bot, object, root, present } = await fixture(t)
  const mesh = root.getObjectByProperty('isSkinnedMesh', true)
  const shell = mesh.children.find(node => node.isSkinnedMesh)
  const purple = mesh.material
  const originalOutline = shell.material
  const variants = [
    ['easy', 'blue', 0x4F9ED9],
    ['medium', 'yellow', 0xD6B64A],
    ['hard', 'purple', 0x7A56A0],
  ]
  for (const [index, [difficulty, skin, color]] of variants.entries()) {
    const fixedTick = index + 1
    const at = fixedTick / 60
    const previousMaterial = mesh.material
    const previousOutline = shell.material
    bot.activateSpawn({
      targetId: object.id,
      sessionId: `difficulty-${difficulty}`,
      spawnId: `life-${fixedTick}`,
      cellId: '0,1',
      position: [0, 0, 0],
      quaternion: [0, 0, 0, 1],
      scale: [1, 1, 1],
      at,
    }, { mode: 'shooting-test', difficulty }, { fixedTick, fixedElapsed: at, fixedDelta: 1 / 60 })
    present(at - 0.001)
    assert.equal(mesh.material, previousMaterial)
    assert.equal(shell.material, previousOutline)
    present(at)
    assert.equal(bot.snapshot().skin, skin)
    assert.equal(mesh.material.map.name, `Training bot:${skin}`)
    assert.equal(shell.material.color.getHex(), color)
    assert.equal(mesh.children.filter(node => node.isSkinnedMesh).length, 1)
  }
  assert.equal(mesh.material, purple, 'switching back to the default reuses its material')
  assert.equal(shell.material, originalOutline)
})

test('target feedback queues are cleared by lifecycle invalidation before a later P can replay old hits', async (t) => {
  const cues = []
  const audio = {
    decode: async () => ({}),
    enqueue: cue => cues.push(cue),
    invalidate() {},
    reportOnce(key, error) { assert.fail(`${key}: ${error}`) },
  }
  const { bot, object, submit, present } = await fixture(t, { audio })
  submit([
    { targetId: object.id, region: 'head', distance: 1 },
  ], { at: 0.1, presentation: false })
  assert.equal(cues.length, 0)
  assert.equal(bot.snapshot().poses.pending, 1)
  bot.invalidateSpawn(0.1, 'respawn')
  present(0.1)
  assert.equal(cues.length, 0)
  assert.equal(bot.snapshot().poses.pending, 0)
})

test('bot lifecycle audio follows presented spawns and non-kill removals', async (t) => {
  const cues = []
  const audio = {
    decode: async () => ({}),
    enqueue: cue => cues.push(cue),
    invalidate() {},
    reportOnce(key, error) { assert.fail(`${key}: ${error}`) },
  }
  const { bot, object, targets, submit, present } = await fixture(t, { audio })
  const spawn = (tick) => {
    const at = tick / 60
    bot.activateSpawn({
      targetId: object.id,
      spawnId: `spawn-${tick}`,
      sessionId: 'test-session',
      cellId: '0,2',
      position: [0, 0, 0],
      quaternion: [0, 0, 0, 1],
      scale: [1, 1, 1],
      at,
      bodyHideTicks: 3,
    }, { maxHealth: 100 }, { fixedTick: tick, fixedElapsed: at, fixedDelta: 1 / 60 })
    present(at)
  }
  spawn(1)
  assert.deepEqual(cues.map(cue => cue.group), ['bot:in'])
  bot.removeSpawn(0.05, 'expired')
  present(0.04)
  assert.equal(cues.length, 1)
  present(0.05)
  assert.deepEqual(cues.map(cue => cue.group), ['bot:in', 'bot:out'])
  spawn(6)
  const hit = targets.trace([0, 2.29, -4], [0, 0, 1], 200)
  assert.equal(submit([hit], { at: 0.15, definitionId: 'vandal' }).deaths.length, 1)
  // Let the killed body disappear. Reuse and cancellation must not replay old sound.
  present(0.2)
  spawn(15)
  bot.invalidateSpawn(0.25, 'respawn')
  assert.deepEqual(cues.map(cue => cue.group), [
    'bot:in',
    'bot:out',
    'bot:in',
    'bot:in',
    'bot:out',
  ])
})

test('real target poses and hit queries agree for subdivided rendering, catch-up and opposite same-tick preparation order', async (t) => {
  const { bot, root, assets, level, targets } = await fixture(t)
  const otherObject = level.addObject(assets.instantiate({
    scene: level.scene,
    targets,
    position: [0, 0, 0],
  }))
  const other = otherObject.requireComponent(TrainingBotComponent)
  const otherRoot = otherObject.requireComponent(MeshComponent).root
  for (let tick = 1; tick <= 30; tick++) {
    const time = { fixedTick: tick, fixedElapsed: tick / 60, fixedDelta: 1 / 60 }
    bot.preparePose(time)
    bot.tick({ phase: 'fixed', time })
    other.tick({ phase: 'fixed', time })
    other.preparePose(time)
    if (tick === 3) {
      bot.react({ region: 'head' }, { at: time.fixedElapsed })
      other.react({ region: 'head' }, { at: time.fixedElapsed })
    }
    bot.tick({
      phase: 'motion',
      time: { presentationTime: time.fixedElapsed },
    })
    if (tick % 3 === 0) {
      other.tick({
        phase: 'motion',
        time: { presentationTime: time.fixedElapsed },
      })
      assert.deepEqual(bot.trace([0, 2.29, -4], [0, 0, 1], 200), other.trace([0, 2.29, -4], [0, 0, 1], 200))
      assert.ok(root.getObjectByName('head').quaternion.angleTo(otherRoot.getObjectByName('head').quaternion) < 1e-7)
      assert.deepEqual(bot.snapshot().poses.authority, other.snapshot().poses.authority)
    }
  }
})
