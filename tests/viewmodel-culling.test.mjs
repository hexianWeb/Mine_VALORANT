import assert from 'node:assert/strict'
import test from 'node:test'
import { BufferGeometry, Group, Mesh, MeshBasicMaterial, Scene, SkinnedMesh } from 'three/webgpu'
import { WeaponViewModel } from '../src/game/weapons/weapon-viewmodel.js'

test('only the instantiated viewmodel skinned meshes bypass stale animated frustum bounds', async (t) => {
  const geometry = new BufferGeometry()
  const material = new MeshBasicMaterial()
  const root = new Group()
  const nested = new Group()
  const sourceArm = new SkinnedMesh(geometry, material)
  const sourceWeapon = new SkinnedMesh(geometry, material)
  const arm = sourceArm.clone()
  const weapon = sourceWeapon.clone()
  const ordinaryMesh = new Mesh(geometry, material)
  nested.add(arm, ordinaryMesh)
  root.add(nested, weapon)
  const unrelated = new SkinnedMesh(geometry, material)
  const scene = new Scene()
  scene.add(unrelated)
  const handle = {
    manifest: {
      view: {
        mountOffset: [0, 0, 0],
      },
    },
  }
  const ticket = { epoch: 1, requestId: 1, instanceId: 'pistol' }
  const snapshot = {
    epoch: 1,
    phase: 'Empty',
    preparation: { ticket },
    inventory: {
      weapons: [
        { instanceId: 'pistol', definitionId: 'classic', skinId: 'smite' },
      ],
    },
  }
  const view = new WeaponViewModel({
    assets: {
      load: async () => handle,
      instantiate: () => ({
        root,
        dispose() {},
      }),
    },
    layer: {
      scene,
      setEnabled() {},
      setFov() {},
    },
    definitions: [
      {
        id: 'classic',
        assets: { modelId: 'classic', assetVersion: 'v1' },
      },
    ],
    queue() {},
  })
  t.after(() => {
    view.dispose()
    geometry.dispose()
    material.dispose()
  })
  assert.equal(arm.frustumCulled, true)
  assert.equal(weapon.frustumCulled, true)
  view.receive({
    events: [],
    effects: [
      { type: 'PrepareWeapon', ticket },
    ],
  }, snapshot)
  await Promise.resolve()
  await Promise.resolve()
  view.motion({ presentationTime: 0, fixedDelta: 1 / 60 }, snapshot, null)
  assert.equal(arm.frustumCulled, false)
  assert.equal(weapon.frustumCulled, false)
  assert.equal(sourceArm.frustumCulled, true)
  assert.equal(sourceWeapon.frustumCulled, true)
  assert.equal(ordinaryMesh.frustumCulled, true)
  assert.equal(unrelated.frustumCulled, true)
})
