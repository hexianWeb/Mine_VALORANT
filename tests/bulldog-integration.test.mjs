import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { AnimationMixer, PerspectiveCamera, Raycaster, Texture, Vector3 } from 'three/webgpu'
import { createWeaponSight } from '../src/game/weapons/assets/weapon-sight.js'
import { bulldogDefinition } from '../src/game/weapons/definitions/bulldog.js'
import { accessorBytes, inspectWeaponPackage } from '../tools/weapons/package-validation.mjs'

test('Bulldog binds the authored view and STEP reloads to standard shared arms', async () => {
  const { modelId, assetVersion, defaultSkinId } = bulldogDefinition.assets
  const dir = fileURLToPath(new URL(`../public/weapons/${modelId}/${assetVersion}`, import.meta.url))
  const { manifest, glb } = await inspectWeaponPackage(dir)
  assert.equal(manifest.weaponId, modelId)
  assert.equal(manifest.assetVersion, assetVersion)
  assert.equal(manifest.defaultSkinId, defaultSkinId)
  assert.equal(manifest.armContract.version, 1)
  assert.equal(manifest.clips.length, 30)
  assert.equal(manifest.provenance.preview, undefined)
  assert.equal(manifest.provenance.temporaryAudioFrom, 'vandal')
  assert.equal(manifest.provenance.armFitting, 'authored-sleeve-stretch')
  assert.ok(Math.abs(manifest.view.aimVerticalFov - bulldogDefinition.aim.viewmodelFov) < 1e-4)
  for (const name of ['reload_tactical', 'reload_empty']) {
    const animation = glb.doc.animations.find(a => a.name === name)
    const stepBones = animation.channels
      .filter(c => c.target.path === 'scale' && animation.samplers[c.sampler].interpolation === 'STEP')
      .map(c => glb.doc.nodes[c.target.node].name)
    for (const name of ['magazine', 'magazine_incoming', 'magazine_outgoing'])
      assert.ok(stepBones.includes(name), `${animation.name} must retain ${name}`)
  }
  for (const side of ['Left', 'Right']) {
    const node = glb.doc.nodes.find(n => n.name === `Arms_${side}`)
    const [primitive] = glb.doc.meshes[node.mesh].primitives
    const index = primitive.attributes.JOINTS_0
    const { count, componentType } = glb.doc.accessors[index]
    assert.equal(count, 24)
    assert.ok(componentType === 5121 || componentType === 5123)
    const bytes = accessorBytes(glb, index)
    const skin = glb.doc.skins[node.skin]
    const bindings = new Map()
    for (let vertex = 0; vertex < count; vertex++) {
      const joint = componentType === 5121
        ? bytes[vertex * 4]
        : bytes.readUInt16LE(vertex * 8)
      const bone = glb.doc.nodes[skin.joints[joint]].name
      bindings.set(bone, (bindings.get(bone) ?? 0) + 1)
    }
    const prefix = side.toLowerCase()
    assert.equal(bindings.size, 2)
    assert.equal(bindings.get(`${prefix}_wrist`), 12)
    assert.equal(bindings.get(`${prefix}_sleeve`), 12)
  }
})

test('Bulldog moves closer at constant FOV; its draw overlaps the lift with one early charge and both reloads stay intact', async () => {
  const root = new URL('../public/weapons/bulldog/', import.meta.url)
  const old = JSON.parse(await readFile(new URL('v3/manifest.json', root), 'utf8'))
  const directory = fileURLToPath(new URL(`${bulldogDefinition.assets.assetVersion}/`, root))
  const { manifest, glb } = await inspectWeaponPackage(directory)
  const [x, y, z] = old.view.mountOffset
  assert.deepEqual(manifest.view.mountOffset.slice(0, 2), [x, y])
  assert.ok(Math.abs(manifest.view.mountOffset[2] - z * 0.8) < 1e-6)
  assert.equal(manifest.view.verticalFov, old.view.verticalFov)
  assert.equal(manifest.actions.reloadTactical, 'reload_empty')
  assert.equal(manifest.actions.reloadEmpty, 'reload_empty')
  const duration = role => manifest.clips.find(c => c.name === manifest.actions[role]).duration
  assert.equal(bulldogDefinition.equip.draw, duration('draw'))
  assert.equal(duration('draw'), 0.75)
  assert.equal(bulldogDefinition.inspectDuration, duration('inspect'))
  assert.equal(bulldogDefinition.aim.duration, duration('aimStart'))
  assert.equal(duration('fire'), 14 / 60)
  for (const [branch, role] of [
    ['tactical', 'reloadTactical'],
    ['empty', 'reloadEmpty'],
  ]) {
    const plan = bulldogDefinition.reload[branch]
    assert.equal(plan.clipEnd ?? plan.duration, duration(role))
    assert.equal(plan.feed, plan.duration)
  }
  assert.equal(bulldogDefinition.reload.tactical.duration, 2)
  const draw = glb.doc.animations.find(a => a.name === manifest.actions.draw)
  const keys = (joint) => {
    const channel = draw.channels.find(c => c.target.path === 'translation' && glb.doc.nodes[c.target.node].name === joint)
    const sampler = draw.samplers[channel.sampler]
    const times = accessorBytes(glb, sampler.input)
    const values = accessorBytes(glb, sampler.output)
    return Array.from({ length: times.length / 4 }, (_, i) => {
      const base = sampler.interpolation === 'CUBICSPLINE'
        ? i * 36 + 12
        : i * 12
      return {
        time: times.readFloatLE(i * 4),
        position: [0, 4, 8].map(axis => values.readFloatLE(base + axis)),
      }
    })
  }
  const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]))
  const grip = keys('charging_handle')
  const travel = grip.map(k => distance(k.position, grip[0].position))
  const peak = Math.max(...travel)
  assert.ok(peak > 0.05 && travel.at(-1) < 1e-4)
  const active = grip.filter((_, i) => travel[i] > peak * 0.10)
  assert.ok(active[0].time < duration('draw') * 0.45)
  assert.ok(active.at(-1).time < duration('draw') * 0.75, 'Return the handle before the equip finishes')
  const body = keys('bulldog')
  const nearest = t => body.reduce((a, b) => Math.abs(a.time - t) < Math.abs(b.time - t)
    ? a
    : b)
  const peakTime = grip[travel.indexOf(peak)].time
  assert.ok(distance(nearest(active[0].time).position, nearest(peakTime).position) > 0.02, 'The viewmodel lift must still be moving during the pull')
})

test('Bulldog ADS projects four unobstructed sight corners around screen center on the shipped model', async (t) => {
  const { modelId: weaponId, assetVersion } = bulldogDefinition.assets
  const dir = new URL(`../public/weapons/${weaponId}/${assetVersion}/`, import.meta.url)
  const manifest = JSON.parse(await readFile(new URL('manifest.json', dir), 'utf8'))
  const bytes = await readFile(new URL(manifest.model.url, dir))
  // Exercise the real node hierarchy, animations and skinning without a browser image decoder.
  const loader = new GLTFLoader().register(() => ({
    name: 'test-texture',
    loadTexture: async () => new Texture(),
  }))
  const { scene, animations } = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')
  scene.position.fromArray(manifest.view.mountOffset)
  const sight = createWeaponSight(scene, { weaponId, assetVersion, manifest })
  assert.ok(sight)
  t.after(() => sight.dispose())
  const projection = scene.getObjectByName('Sight projection')
  assert.equal(projection.parent.parent, scene.getObjectByName(manifest.sockets.sight))
  const mixer = new AnimationMixer(scene)
  mixer.clipAction(animations.find(a => a.name === manifest.actions.aim)).play()
  mixer.setTime(0.4)
  scene.updateMatrixWorld(true)
  const camera = new PerspectiveCamera(manifest.view.aimVerticalFov, 16 / 9, 0.005, 100)
  const center = projection.getWorldPosition(new Vector3()).project(camera)
  assert.ok(Math.abs(center.x) < 0.02 && Math.abs(center.y) < 0.02)
  const meshes = []
  scene.traverse((o) => {
    if (o.isSkinnedMesh)
      meshes.push(o)
  })
  const { width, height } = projection.geometry.parameters
  for (const x of [-1, 1]) {
    for (const y of [-1, 1]) {
      // Midpoint of each chamfer on the existing 224 × 170 bracket field.
      const point = projection.localToWorld(new Vector3(x * width * 78.5 / 224, y * height * 64 / 170, 0))
      const ndc = point.clone().project(camera)
      assert.ok(Math.abs((ndc.x - center.x) * 640 - x * 78.5) < 6)
      assert.ok(Math.abs((ndc.y - center.y) * 360 - y * 64) < 6)
      const ray = new Raycaster(camera.position, point.clone().normalize(), camera.near, point.length())
      assert.equal(ray.intersectObjects(meshes, false).length, 0, 'The weapon must not occlude its ADS sight')
    }
  }
})
