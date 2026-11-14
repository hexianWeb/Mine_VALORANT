import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { phantomAimProfile } from '../src/game/weapons/aim-profile.js'
import { weaponAudioProfiles } from '../src/game/weapons/definitions/audio.js'
import { vandalDefinition, vandalGameplayProvenance } from '../src/game/weapons/definitions/vandal.js'
import { practiceLoadout } from '../src/game/weapons/player-weapons.js'
import { pngSize, sha256 } from '../tools/weapons/package-validation.mjs'
import { readPinnedAuthoring, validateAuthoredTexture } from '../tools/weapons/publish-authored.mjs'

const readJSON = async file => JSON.parse(await readFile(file, 'utf8'))

test('Vandal public-reference timing and explicit approximations match the pinned runtime profile', async () => {
  const profile = await readJSON('tools/weapons/authored-releases/vandal-temporary-runtime.json')
  assert.deepEqual(profile.definition, vandalDefinition)
  assert.deepEqual(profile.provenance, vandalGameplayProvenance)
  assert.deepEqual(profile.audio, weaponAudioProfiles.vandal)
  assert.equal(profile.originalRuntimeManifestAvailable, false)
  const stats = profile.reference.weaponStats
  assert.equal(vandalDefinition.capacity, stats.magazineSize)
  assert.equal(1 / vandalDefinition.fire.interval, stats.fireRate)
  assert.equal(vandalDefinition.fire.mode, 'auto')
  assert.equal(vandalDefinition.equip.draw, stats.equipTimeSeconds)
  assert.equal(vandalDefinition.capabilities.ads, true)
  assert.equal(vandalDefinition.initialReserve, vandalDefinition.capacity * 3)
  assert.deepEqual(vandalDefinition.recoil, phantomAimProfile.recoil)
  assert.deepEqual(vandalDefinition.spread, phantomAimProfile.spread)
  assert.equal(stats.adsStats.fireRate, 8.775)
  assert.match(vandalGameplayProvenance.adsFireRate, /temporarily stays 9.75/)
  for (const branch of Object.values(vandalDefinition.reload)) {
    assert.equal(branch.duration, stats.reloadTimeSeconds)
    assert.equal(branch.feed, branch.duration)
  }
  assert.deepEqual(practiceLoadout.slice(0, 4).map(slot => slot.weapon.definitionId), [
    'phantom',
    'classic',
    'ghost',
    'vandal',
  ])
  assert.equal(practiceLoadout[3].id, 'quaternary')
})

test('six pinned Vandal sources share geometry, weights, rig and actions; Original stays 256 square', async () => {
  const recipe = await readJSON('tools/weapons/authored-releases/vandal-v1.json')
  const input = await readPinnedAuthoring(recipe.authoring)
  await readPinnedAuthoring(recipe.runtimeProfile)
  const authoring = JSON.parse(input.bytes)
  assert.equal(authoring.clips.length, 30)
  assert.equal(authoring.clips.find(clip => clip.name === 'put_away').loop, false, 'hold-on-last-frame is not a loop')
  assert.equal(recipe.scene, 'E04_VANDAL_Actions')
  for (const clip of authoring.clips)
    assert.equal(recipe.authoringAdapter.actionAliases[`vandal / ${clip.name}`], clip.name)
  for (const [skinId, skin] of Object.entries(authoring.skins)) {
    await readPinnedAuthoring(skin.source)
    const texture = await readPinnedAuthoring(skin.texture)
    validateAuthoredTexture(texture.bytes, skin)
    assert.deepEqual(skin.authoringSignature, authoring.skins.sakura.authoringSignature)
    assert.deepEqual(skin.inspection.armAppearanceSamples, { Left: 248, Right: 248 })
    assert.equal(skin.inspection.preservedMeshRigActions, true)
    assert.equal(skin.inspection.packedExternalPixelsIdentical, true)
    assert.deepEqual(pngSize(texture.bytes), skinId === 'original'
      ? { width: 256, height: 256 }
      : { width: 2048, height: 2048 })
    if (skinId === 'original')
      assert.throws(() => validateAuthoredTexture(texture.bytes, {}), /deep-equal/)
  }
})

test('Vandal release preserves all meshes, shared arms and validation evidence without promoting a preview', async () => {
  const directory = 'public/weapons/vandal/v1'
  const manifest = await readJSON(`${directory}/manifest.json`)
  const audit = await readJSON(`${directory}/source-audit.json`)
  const report = await readJSON(`${directory}/validation.json`)
  const recipeBytes = await readFile('tools/weapons/authored-releases/vandal-v1.json')
  assert.equal(manifest.provenance.kind, 'blender-actions-with-temporary-public-runtime')
  assert.notEqual(manifest.provenance.preview, true)
  assert.equal(manifest.provenance.originalRuntimeManifestAvailable, false)
  assert.equal(manifest.provenance.gameplayParameters, 'temporary-public-reference')
  assert.equal(manifest.provenance.releaseRecipeSha256, sha256(recipeBytes))
  assert.equal(manifest.provenance.authoringMetadataSha256, sha256(await readFile(`${directory}/authoring-metadata.json`)))
  assert.equal(manifest.model.sha256, sha256(await readFile(`${directory}/model.glb`)))
  assert.equal(manifest.armContract.textureSha256, '2c041879daf6509fe3da88a8e1b857e4b9a7c9b67279d012382f5f03529750e9')
  assert.deepEqual(audit.authoringAdapter.armAppearanceSamples, { Left: 248, Right: 248 })
  assert.equal(audit.authoringAdapter.preservedMeshRigActions, true)
  assert.equal(manifest.meshes.length, 5)
  assert.ok(manifest.meshes.includes('Weapon_SpareMagazine'))
  assert.deepEqual(Object.keys(manifest.skins), vandalDefinition.assets.skinIds)
  for (const [skinId, descriptor] of Object.entries(manifest.skins)) {
    const filename = path.join(directory, descriptor.url)
    const bytes = await readFile(filename)
    assert.equal(sha256(bytes), descriptor.sha256)
    const skin = JSON.parse(bytes)
    assert.equal(skin.skinId, skinId)
    assert.deepEqual(skin.compatibility, manifest.compatibility)
    assert.equal(skin.materials.weapon.map.width, skinId === 'original'
      ? 256
      : 2048)
  }
  assert.equal(report.clips, 30)
  assert.equal(report.poseSamples, 9)
  assert.equal(report.gltfIssues.numErrors, 0)
  assert.equal(report.gltfIssues.numWarnings, 0)
})
