import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { classicAimProfile } from '../src/game/weapons/aim-profile.js'
import { weaponAudioProfiles } from '../src/game/weapons/definitions/audio.js'
import { sheriffDefinition, sheriffGameplayProvenance } from '../src/game/weapons/definitions/sheriff.js'
import { practiceLoadout } from '../src/game/weapons/player-weapons.js'
import { pngSize, sha256 } from '../tools/weapons/package-validation.mjs'
import { readPinnedAuthoring } from '../tools/weapons/publish-authored.mjs'

const readJSON = async file => JSON.parse(await readFile(file, 'utf8'))

test('Sheriff uses pinned public-reference timing and labels the missing original gameplay', async () => {
  const profile = await readJSON('tools/weapons/authored-releases/sheriff-temporary-runtime.json')
  assert.deepEqual(profile.definition, sheriffDefinition)
  assert.deepEqual(profile.provenance, sheriffGameplayProvenance)
  assert.deepEqual(profile.audio, weaponAudioProfiles.sheriff)
  assert.equal(profile.originalRuntimeManifestAvailable, false)
  const stats = profile.reference.weaponStats
  assert.equal(sheriffDefinition.capacity, stats.magazineSize)
  assert.equal(sheriffDefinition.capacity, 6)
  assert.equal(1 / sheriffDefinition.fire.interval, stats.fireRate)
  assert.equal(sheriffDefinition.fire.mode, 'semi')
  assert.equal(sheriffDefinition.equip.draw, stats.equipTimeSeconds)
  assert.equal(stats.adsStats, null)
  assert.equal(sheriffDefinition.capabilities.ads, false)
  assert.equal(sheriffDefinition.initialReserve, sheriffDefinition.capacity * 3)
  assert.deepEqual(sheriffDefinition.recoil, classicAimProfile.recoil)
  assert.deepEqual(sheriffDefinition.spread, classicAimProfile.spread)
  for (const branch of Object.values(sheriffDefinition.reload)) {
    assert.equal(branch.duration, stats.reloadTimeSeconds)
    assert.equal(branch.feed, branch.duration)
  }
  assert.deepEqual(practiceLoadout.slice(0, 5).map(slot => slot.weapon.definitionId), [
    'phantom',
    'classic',
    'ghost',
    'vandal',
    'sheriff',
  ])
  assert.equal(practiceLoadout[4].id, 'quinary')
})

test('three Sheriff sources and packed skins are pinned and share the actual export-scene rig/UV/actions', async () => {
  const recipe = await readJSON('tools/weapons/authored-releases/sheriff-v1.json')
  const input = await readPinnedAuthoring(recipe.authoring)
  await readPinnedAuthoring(recipe.runtimeProfile)
  const authoring = JSON.parse(input.bytes)
  assert.equal(authoring.clips.length, 30)
  assert.equal(recipe.scene, '80_ThreeJS_Export')
  assert.equal(recipe.authoringAdapter, undefined, 'the actual Sheriff arms already match the contract')
  assert.equal(authoring.clips.find(clip => clip.name === 'inspect').duration, sheriffDefinition.inspectDuration)
  assert.deepEqual(Object.keys(authoring.skins), sheriffDefinition.assets.skinIds)
  for (const skin of Object.values(authoring.skins)) {
    await readPinnedAuthoring(skin.source)
    const texture = await readPinnedAuthoring(skin.texture)
    assert.deepEqual(pngSize(texture.bytes), { width: 2048, height: 2048 })
    assert.deepEqual(skin.authoringSignature, authoring.skins.smite.authoringSignature)
    assert.equal(skin.inspection.actualSceneArmsValidated, true)
    assert.equal(skin.inspection.packedExternalPngIdentical, true)
    assert.equal(skin.inspection.image.channels, 4)
  }
})

test('Sheriff v1 contains all actions, loader mesh, shared arms and fresh release validation evidence', async () => {
  const directory = 'public/weapons/sheriff/v1'
  const manifest = await readJSON(`${directory}/manifest.json`)
  const audit = await readJSON(`${directory}/source-audit.json`)
  const report = await readJSON(`${directory}/validation.json`)
  assert.equal(manifest.provenance.kind, 'blender-actions-with-temporary-public-runtime')
  assert.notEqual(manifest.provenance.preview, true)
  assert.equal(manifest.provenance.originalRuntimeManifestAvailable, false)
  assert.equal(manifest.provenance.gameplayParameters, 'temporary-public-reference')
  assert.equal(manifest.model.sha256, sha256(await readFile(`${directory}/model.glb`)))
  assert.equal(manifest.provenance.releaseRecipeSha256, sha256(await readFile('tools/weapons/authored-releases/sheriff-v1.json')))
  assert.equal(manifest.provenance.authoringMetadataSha256, sha256(await readFile(`${directory}/authoring-metadata.json`)))
  assert.equal(manifest.armContract.textureSha256, '2c041879daf6509fe3da88a8e1b857e4b9a7c9b67279d012382f5f03529750e9')
  assert.ok(manifest.meshes.includes('Weapon_Magazine'), 'reload loader must not be dropped')
  assert.equal(manifest.meshes.length, 4)
  assert.equal(audit.poseSamples.length, 9)
  assert.deepEqual(Object.keys(manifest.skins), sheriffDefinition.assets.skinIds)
  for (const [skinId, descriptor] of Object.entries(manifest.skins)) {
    const bytes = await readFile(path.join(directory, descriptor.url))
    assert.equal(sha256(bytes), descriptor.sha256)
    const skin = JSON.parse(bytes)
    assert.equal(skin.skinId, skinId)
    assert.deepEqual(skin.compatibility, manifest.compatibility)
    assert.equal(skin.materials.weapon.map.width, 2048)
  }
  assert.equal(report.clips, 30)
  assert.equal(report.poseSamples, 9)
  assert.equal(report.stepTracks, 22)
  assert.equal(report.gltfIssues.numErrors, 0)
  assert.equal(report.gltfIssues.numWarnings, 0)
})
