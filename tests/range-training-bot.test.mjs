import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import test from 'node:test'
import { Scene, Vector3 } from 'three/webgpu'
import { Level, MeshComponent, TransformComponent } from '../src/engine/runtime/function/framework/index.js'
import { ResourceManager } from '../src/engine/runtime/resource/resource-manager.js'
import { ShotTargets } from '../src/game/targets/shot-targets.js'
import { loadTrainingBotAssets, TrainingBotComponent } from '../src/game/targets/training-bot.js'
import { traceWeaponImpact } from '../src/game/weapons/player-weapons.js'

async function fixture(t) {
  const fetch = globalThis.fetch
  t.mock.method(globalThis, 'fetch', (url, options) => {
    if (String(url).startsWith('file:'))
      return fs.readFile(new URL(url)).then(data => new Response(data))
    return fetch(url, options)
  })
  const globals = {
    self: globalThis,
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
  const assets = level.disposer.add(await loadTrainingBotAssets({ resources }))
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
  }
}

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
