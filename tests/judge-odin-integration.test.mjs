import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { AnimationPlayer } from '../src/engine/runtime/function/animation/animation-player.js'
import { ammoControlSamples } from '../src/game/weapons/assets/weapon-control-profile.js'
import { weaponAudioProfiles } from '../src/game/weapons/definitions/audio.js'
import { judgeDefinition, judgeGameplayProvenance } from '../src/game/weapons/definitions/judge.js'
import { practiceLoadout } from '../src/game/weapons/player-weapons.js'
import { pngSize, readGlb, sha256, validateWeaponModel } from '../tools/weapons/package-validation.mjs'
import { authoredControlProfile, readPinnedAuthoring } from '../tools/weapons/publish-authored.mjs'

const readJSON = async file => JSON.parse(await readFile(file, 'utf8'))
const entries = [
  [
    'judge',
    judgeDefinition,
    judgeGameplayProvenance,
    5,
  ],
]

test('Judge appends the sixth slot without changing the five existing loadout entries', () => {
  assert.deepEqual(practiceLoadout.map(slot => slot.weapon.definitionId), [
    'phantom',
    'classic',
    'ghost',
    'vandal',
    'sheriff',
    'judge',
  ])
  assert.equal(practiceLoadout[5].id, 'senary')
  assert.equal(judgeDefinition.fire.pellets, 12)
  assert.equal(judgeDefinition.capacity, 5, 'use the observed current record, not an old seven-round value')
})

test('publication rejects malformed sparse-control declarations, not only runtime loading', async () => {
  const original = await readJSON('public/weapons/judge/v1/manifest.json')
  const bytes = await readFile('public/weapons/judge/v1/model.glb')
  for (const mutate of [
    manifest => manifest.runtimeControls = null,
    manifest => manifest.runtimeControls.ammoDisplay.clip = 'missing',
    manifest => manifest.runtimeControls.ammoDisplay.tracks = ['missing.scale'],
    manifest => manifest.ammoDisplay.levels[0].time = 999,
  ]) {
    const manifest = structuredClone(original)
    mutate(manifest)
    await assert.rejects(validateWeaponModel({ manifest, bytes }), /control|track|clip|ammo|display/i)
  }
})

for (const [id, definition, provenance, window] of entries) {
  test(`${id} pins current sources, textures, public-reference approximations and source controls`, async () => {
    const recipe = await readJSON(`tools/weapons/authored-releases/${id}-v1.json`)
    const metadata = JSON.parse((await readPinnedAuthoring(recipe.authoring)).bytes)
    const runtime = JSON.parse((await readPinnedAuthoring(recipe.runtimeProfile)).bytes)
    assert.deepEqual(runtime.definition, definition)
    assert.deepEqual(runtime.provenance, provenance)
    assert.deepEqual(runtime.audio, weaponAudioProfiles[id])
    assert.equal(runtime.originalRuntimeManifestAvailable, false)
    assert.equal(runtime.reference.weaponStats.magazineSize, definition.capacity)
    assert.equal(runtime.reference.weaponStats.fireRate, 1 / definition.fire.interval)
    assert.equal(metadata.clips.length, 33)
    assert.equal(metadata.runtimeControls.ammoDisplay.tracks.length, window)
    assert.equal(metadata.controlEvidence.sourceSha256, metadata.skins.smite.source.sha256)
    assert.deepEqual(Object.keys(metadata.skins), definition.assets.skinIds)
    for (const skin of Object.values(metadata.skins)) {
      await readPinnedAuthoring(skin.source)
      const texture = await readPinnedAuthoring(skin.texture)
      assert.deepEqual(pngSize(texture.bytes), { width: 2048, height: 2048 })
      assert.deepEqual(skin.authoringSignature, metadata.skins.smite.authoringSignature)
      assert.equal(skin.inspection.actualSceneArmsValidated, true)
      if (id === 'odin') {
        assert.deepEqual(skin.inspection.adapter.armAppearanceSamples, { Left: 248, Right: 248 })
        assert.equal(skin.inspection.adapter.preservedMeshRigActions, true)
      }
    }
  })

  test(`${id} new release records complete validation and exact published-control key times`, async () => {
    const directory = `public/weapons/${id}/v1`
    const manifest = await readJSON(`${directory}/manifest.json`)
    const report = await readJSON(`${directory}/validation.json`)
    const metadata = await readJSON(`${directory}/authoring-metadata.json`)
    const bytes = await readFile(`${directory}/model.glb`)
    assert.equal(manifest.provenance.kind, 'blender-actions-with-temporary-public-runtime')
    assert.notEqual(manifest.provenance.preview, true)
    assert.equal(manifest.model.sha256, sha256(bytes))
    assert.equal(manifest.provenance.releaseRecipeSha256, sha256(await readFile(`tools/weapons/authored-releases/${id}-v1.json`)))
    assert.equal(manifest.provenance.authoringMetadataSha256, sha256(await readFile(`${directory}/authoring-metadata.json`)))
    assert.equal(manifest.armContract.textureSha256, '2c041879daf6509fe3da88a8e1b857e4b9a7c9b67279d012382f5f03529750e9')
    assert.deepEqual(authoredControlProfile(metadata, readGlb(bytes)), {
      runtimeControls: manifest.runtimeControls,
      ammoDisplay: manifest.ammoDisplay,
    })
    const wrong = structuredClone(metadata)
    wrong.ammoDisplay.levels[0].time += 0.012345
    assert.throws(() => authoredControlProfile(wrong, readGlb(bytes)), /authored control boundary/)
    assert.equal(report.clips, 33)
    assert.equal(report.poseSamples, 9)
    assert.equal(report.meshes, 4)
    assert.equal(report.controls.profiles, 2)
    assert.equal(report.gltfIssues.numErrors, 0)
    assert.equal(report.gltfIssues.numWarnings, 0)
    for (const descriptor of Object.values(manifest.skins))
      assert.equal(sha256(await readFile(path.join(directory, descriptor.url))), descriptor.sha256)
  })

  test(`${id} actual GLB feed controls select every level without overriding hands or starting an ammo action`, async (t) => {
    const directory = `public/weapons/${id}/v1`
    const manifest = await readJSON(`${directory}/manifest.json`)
    const globals = new Map(['self', 'createImageBitmap', 'ProgressEvent'].map(name => [
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    ]))
    globalThis.self = globalThis
    globalThis.createImageBitmap = async blob => ({
      ...pngSize(Buffer.from(await blob.arrayBuffer())),
      close() {},
    })
    globalThis.ProgressEvent ??= class ProgressEvent {
      constructor(type, values) { Object.assign(this, { type, ...values }) }
    }
    t.after(() => {
      for (const [name, descriptor] of globals) {
        if (descriptor)
          Object.defineProperty(globalThis, name, descriptor)
        else
          delete globalThis[name]
      }
    })
    const bytes = await readFile(`${directory}/model.glb`)
    const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')
    const player = new AnimationPlayer({
      root: gltf.scene,
      clips: gltf.animations,
      actions: {
        idle: { clip: manifest.actions.idle, loop: true },
      },
      controls: manifest.runtimeControls,
    })
    t.after(() => player.dispose())
    player.play('idle', { fade: 0 })
    player.advance(0)
    const hand = gltf.scene.getObjectByName('righthand').scale.toArray()
    const bones = manifest.runtimeControls.ammoDisplay.tracks.map(name => gltf.scene.getObjectByName(name.slice(0, -6)))
    const before = player.snapshot().current
    for (const magazine of [
      definition.capacity,
      ...Array.from({ length: window + 1 }, (_, index) => window - index),
    ]) {
      player.setControls(ammoControlSamples(manifest, magazine))
      assert.equal(bones.filter(bone => bone.scale.x > 0.5).length, Math.min(window, magazine), `magazine=${magazine}`)
      assert.deepEqual(gltf.scene.getObjectByName('righthand').scale.toArray(), hand)
      assert.deepEqual(player.snapshot().current, before)
      assert.equal(player.snapshot().stats.actions, 1)
      assert.deepEqual(player.advance(0), [])
    }
    player.clearControls()
    assert.deepEqual(player.snapshot().controls.samples, {})
  })
}
