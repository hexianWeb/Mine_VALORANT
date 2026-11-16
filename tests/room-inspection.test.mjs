import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three/webgpu'
import { installDiagnostics } from '../src/app/diagnostics.js'
import { createRoomShadows } from '../src/game/range-room/lighting/room-shadows.js'

test('diagnostics expose room inspection without a removed prop or legacy commands', () => {
  const target = {}
  const state = {
    cameraMode: 'fly',
    flySpeed: 6,
    shadows: { enabled: true },
    player: null,
  }
  const inspection = {
    snapshot: () => state,
  }
  const runtime = {
    state: 'ready',
    engine: {
      time: {
        snapshot: () => ({ frame: 1 }),
      },
    },
    render: {
      snapshot: () => ({ ready: true, config: {} }),
    },
  }
  const level = {
    snapshot: () => ({ ready: true, config: {} }),
  }
  const dispose = installDiagnostics({ runtime, level, inspection, target })
  const api = target.__RANGE_ROOM__
  assert.equal(api.ready, true)
  assert.deepEqual(api.inspection.snapshot(), state)
  assert.deepEqual(api.snapshot().inspection, state)
  for (const key of [
    'teapot',
    'target',
    'focusTeapot',
    'focusTarget',
    'setPaused',
  ])
    assert.equal(Object.hasOwn(api.inspection, key), false)
  assert.equal(Object.hasOwn(api.snapshot().inspection, 'teapot'), false)
  dispose()
  assert.equal(Object.hasOwn(target, '__RANGE_ROOM__'), false)
})

test('shadow rig restores shared materials and renderer state without disposing room resources', () => {
  const scene = new THREE.Scene()
  const renderer = {
    shadowMap: { enabled: false, type: THREE.BasicShadowMap },
  }
  const geometry = new THREE.PlaneGeometry()
  const baked = new THREE.MeshLambertNodeMaterial()
  baked.userData.roomMode = 'lightmap'
  const realtime = new THREE.MeshStandardNodeMaterial({ alphaTest: 0.5 })
  const fixture = new THREE.MeshBasicNodeMaterial()
  fixture.userData.roomMode = 'fixture-emissive'
  const a = new THREE.Mesh(geometry, baked)
  const b = new THREE.Mesh(geometry, [baked, realtime])
  const c = new THREE.Mesh(geometry, fixture)
  scene.add(a, b, c)
  const rig = createRoomShadows({
    scene,
    renderer,
    roots: [scene],
    position: new THREE.Vector3(0, 10, 0),
    target: new THREE.Vector3(),
  })
  assert.notEqual(a.material, baked)
  assert.equal(b.material[0], a.material)
  assert.equal(b.material[1], realtime)
  assert.equal(b.material[1].alphaTest, 0.5)
  assert.equal(baked.outputNode, null)
  assert.equal(c.castShadow, false)
  assert.equal(c.receiveShadow, false)
  assert.equal(rig.snapshot().casters, 2)
  let cloneDisposals = 0
  let sourceDisposals = 0
  a.material.addEventListener('dispose', () => cloneDisposals++)
  baked.addEventListener('dispose', () => sourceDisposals++)
  rig.setEnabled(false)
  rig.dispose()
  rig.dispose()
  assert.equal(cloneDisposals, 1)
  assert.equal(sourceDisposals, 0)
  assert.equal(a.material, baked)
  assert.deepEqual(b.material, [baked, realtime])
  assert.equal(a.castShadow, false)
  assert.equal(a.receiveShadow, false)
  assert.deepEqual(renderer.shadowMap, { enabled: false, type: THREE.BasicShadowMap })
  assert.equal(scene.children.length, 3)
  geometry.dispose()
  baked.dispose()
  realtime.dispose()
  fixture.dispose()
})
