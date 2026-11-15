import assert from 'node:assert/strict'
import test from 'node:test'
import { Scene } from 'three/webgpu'
import { createParticleSystem } from '../src/engine/runtime/index.js'
import { ImpactEffects } from '../src/game/weapons/impact-effects.js'
import { traceWeaponImpact } from '../src/game/weapons/player-weapons.js'

test('weapon impacts report the entry face of the nearest box and preserve miss distances', () => {
  const box = {
    name: 'Wall',
    min: [-1, -1, -1],
    max: [1, 1, 1],
  }
  const world = {
    boxes: [box],
  }
  for (let axis = 0; axis < 3; axis++) {
    for (const sign of [-1, 1]) {
      const origin = [0, 0, 0]
      const direction = [0, 0, 0]
      const face = [0, 0, 0]
      origin[axis] = sign * 10
      direction[axis] = -sign
      face[axis] = sign
      assert.deepEqual(traceWeaponImpact(origin, direction, world), {
        hit: 'Wall',
        distance: 9,
        position: face,
        normal: face,
        surface: 'stone',
      })
    }
  }
  assert.deepEqual(traceWeaponImpact([0, 0, 0], [1, 0, 0], world).normal, [-1, 0, 0])
  assert.deepEqual(traceWeaponImpact([0, 0, 3], [0, 0, 1], world, 100), {
    hit: null,
    distance: 100,
    position: [0, 0, 103],
    normal: null,
    surface: null,
  })
  assert.equal(traceWeaponImpact([0, 0, -10], [0, 0, 1], {
    boxes: [
      box,
      {
        ...box,
        name: 'Chest',
        min: [-1, -1, -4],
        max: [1, 1, -3],
      },
    ],
  }).surface, 'wood')
})

test('room collider names and the external ground resolve to four impact surfaces', () => {
  for (const [name, group, expected] of [
    ['COL_Practice_Prop_Anvil_001', 'Props', 'metal'],
    ['COL_Practice_Prop_Chest_005', 'Props', 'wood'],
    ['COL_Practice_Prop_Jungle_001', 'Props', 'wood'],
    ['COL_Practice_Prop_Bed_001', 'Props', 'wood'],
    ['COL_Practice_Prop_Fence_001', 'Props', 'wood'],
    ['COL_Practice_Prop_CounterSlab_10_0_001', 'Props', 'wood'],
    ['Ground', 'Ground', 'dirt'],
    ['COL_Practice_Floor_001', 'Floor', 'stone'],
  ]) {
    assert.equal(traceWeaponImpact([0, 0, 1], [0, 0, -1], {
      boxes: [
        {
          name,
          group,
          min: [-1, -1, -2],
          max: [1, 1, 0],
        },
      ],
    }).surface, expected)
  }
})

function particle(shape, born, x = 1) {
  return {
    shape,
    origin: [x, 2, 3],
    velocity: [4, 5, 6],
    born,
    life: 0.25,
    size: 0.125,
    gravity: 7,
    color: [8, 2, 1],
  }
}

test('particle batches upload the written ranges and overwrite only the oldest slots in their own batch', (t) => {
  const scene = new Scene()
  const particles = createParticleSystem({ scene, capacity: 2 })
  t.after(() => particles.dispose())
  const [solid, soft] = scene.children
  particles.emit([
    particle('streak', 1),
    particle('puff', 1),
    {
      ...particle('cube', 1, 2),
      stretch: 2,
    },
  ])
  const geometry = solid.geometry
  const origin = geometry.getAttribute('particleOrigin')
  assert.deepEqual([...origin.array], [1, 2, 3, 2, 2, 3])
  assert.deepEqual([
    ...geometry.getAttribute('particleParams').array,
  ], [1, 0.25, 0.125, 7, 1, 0.25, 0.125, 7])
  assert.deepEqual([
    ...geometry.getAttribute('particleColor').array,
  ], [8, 2, 1, 0, 8, 2, 1, 1])
  assert.deepEqual([
    ...geometry.getAttribute('particleStretch').array,
  ], [1, 2])
  assert.deepEqual(origin.updateRanges, [
    { start: 0, count: 6 },
  ])
  origin.clearUpdateRanges()
  particles.emit([
    particle('cube', 1.125, 3),
  ])
  assert.deepEqual([...origin.array], [3, 2, 3, 2, 2, 3])
  assert.deepEqual(origin.updateRanges, [
    { start: 0, count: 3 },
  ])
  assert.equal(solid.count, 2)
  assert.equal(soft.count, 1)
  assert.equal(soft.geometry.getAttribute('particleColor').getW(0), 2)
})

test('particles follow presentation time and clear/dispose their owned draw resources', () => {
  const scene = new Scene()
  const particles = createParticleSystem({ scene, capacity: 4 })
  const batches = [...scene.children]
  particles.emit([
    particle('streak', 2),
    particle('puff', 2.125),
  ])
  for (const [presentationTime, alive] of [
    [1.9, 0],
    [2, 1],
    [2.125, 2],
    [2.125, 2],
    [2.25, 1],
    [2.5, 0],
  ]) {
    particles.flush({ presentationTime })
    assert.deepEqual(particles.snapshot(), { capacity: 4, written: 2, alive })
  }
  assert.ok(batches.every(mesh => !mesh.visible))
  particles.clear()
  assert.deepEqual(particles.snapshot(), { capacity: 4, written: 0, alive: 0 })
  particles.emit([
    particle('cube', 2.5),
  ])
  particles.flush({ presentationTime: 2.5 })
  assert.equal(particles.snapshot().alive, 1)
  const releases = new Set()
  const owned = batches.flatMap(mesh => [mesh, mesh.geometry, mesh.material])
  for (const resource of owned)
    resource.addEventListener('dispose', () => releases.add(resource))
  particles.dispose()
  particles.dispose()
  assert.deepEqual(scene.children, [])
  assert.equal(releases.size, owned.length)
})

test('impact effects are deterministic per shot, face outward and use distinct presets', () => {
  const bursts = []
  let cleared = 0
  const impacts = new ImpactEffects({
    emit: particles => bursts.push(particles),
    clear: () => cleared++,
  })
  const shoot = (surface, hit = 'Collider') => impacts.receive({
    events: [
      {
        type: 'ShotFired',
        at: 2.5,
        payload: {
          shotSequence: 17,
          eyeOrigin: [1, 2, 3],
          shotDirection: [0, 0, -1],
          impact: {
            hit,
            surface,
            distance: 3,
            position: [1, 2, 0],
            normal: [0, 0, 1],
          },
        },
      },
    ],
  })
  for (const surface of ['metal', 'stone', 'wood', 'dirt']) {
    shoot(surface)
    shoot(surface)
    const first = bursts.at(-2)
    assert.deepEqual(first, bursts.at(-1))
    assert.ok(first.every(p => p.born === 2.5 && p.velocity[2] >= 0 && p.origin[2] === 0.01))
    const counts = Object.groupBy(first, p => p.shape)
    assert.equal(!!counts.streak, surface === 'metal' || surface === 'stone')
    assert.equal(counts.puff?.length ?? 0, { metal: 0, stone: 1, wood: 1, dirt: 2 }[surface])
    assert.ok(counts.cube.every(p => (p.stretch > 1) === (surface === 'wood')))
  }
  shoot(null, null)
  assert.equal(bursts.length, 8)
  impacts.receive({
    events: [
      { type: 'PresentationReset' },
    ],
  })
  assert.equal(cleared, 1)
})
