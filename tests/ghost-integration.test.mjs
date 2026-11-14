import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { classicAimProfile } from '../src/game/weapons/aim-profile.js'
import { ghostDefinition, ghostGameplayProvenance } from '../src/game/weapons/definitions/ghost.js'
import { practiceLoadout } from '../src/game/weapons/player-weapons.js'
import { sha256 } from '../tools/weapons/package-validation.mjs'
import { readPinnedAuthoring } from '../tools/weapons/publish-authored.mjs'

const readJSON = async file => JSON.parse(await readFile(file, 'utf8'))

test('Ghost uses an explicit temporary public reference without pretending to recover original gameplay', async () => {
  const profile = await readJSON('tools/weapons/authored-releases/ghost-temporary-runtime.json')
  assert.deepEqual(profile.definition, ghostDefinition)
  assert.deepEqual(profile.provenance, ghostGameplayProvenance)
  assert.equal(profile.originalRuntimeManifestAvailable, false)
  assert.equal(profile.reference.weaponStats.magazineSize, ghostDefinition.capacity)
  assert.equal(profile.reference.weaponStats.fireRate, 1 / ghostDefinition.fire.interval)
  assert.equal(ghostDefinition.fire.mode, 'semi')
  assert.equal(ghostDefinition.capabilities.ads, false)
  assert.equal(ghostDefinition.initialReserve, ghostDefinition.capacity * 3)
  assert.deepEqual(ghostDefinition.recoil, classicAimProfile.recoil)
  assert.deepEqual(ghostDefinition.spread, classicAimProfile.spread)
  for (const branch of Object.values(ghostDefinition.reload)) {
    assert.equal(branch.duration, profile.reference.weaponStats.reloadTimeSeconds)
    assert.equal(branch.feed, branch.duration)
  }
  assert.deepEqual(practiceLoadout.slice(0, 3).map(slot => slot.weapon.definitionId), ['phantom', 'classic', 'ghost'])
  assert.equal(practiceLoadout[2].id, 'tertiary')
})

test('authored publication pins every source and rejects stale metadata before exporting', async () => {
  const recipe = await readJSON('tools/weapons/authored-releases/ghost-v1.json')
  const input = await readPinnedAuthoring(recipe.authoring)
  const metadata = JSON.parse(input.bytes)
  assert.equal(metadata.clips.length, 30)
  for (const skin of Object.values(metadata.skins)) {
    await readPinnedAuthoring(skin.source)
    await readPinnedAuthoring(skin.texture)
  }
  await readPinnedAuthoring(recipe.runtimeProfile)
  await assert.rejects(readPinnedAuthoring({
    ...recipe.authoring,
    sha256: '0'.repeat(64),
  }), /Pinned input changed/)
  await assert.rejects(readPinnedAuthoring({
    path: '../outside.json',
    sha256: '0'.repeat(64),
  }), /escapes project/)
})

test('Ghost v1 is a freshly validated authored release, not a relabelled art preview', async () => {
  const directory = 'public/weapons/ghost/v1'
  const manifest = await readJSON(`${directory}/manifest.json`)
  const report = await readJSON(`${directory}/validation.json`)
  assert.equal(manifest.provenance.kind, 'blender-actions-with-temporary-public-runtime')
  assert.notEqual(manifest.provenance.preview, true)
  assert.equal(manifest.provenance.originalRuntimeManifestAvailable, false)
  assert.equal(manifest.provenance.gameplayParameters, 'temporary-public-reference')
  assert.equal(manifest.model.sha256, sha256(await readFile(`${directory}/model.glb`)))
  assert.equal(manifest.provenance.releaseRecipeSha256, sha256(await readFile('tools/weapons/authored-releases/ghost-v1.json')))
  assert.equal(manifest.provenance.authoringMetadataSha256, sha256(await readFile(`${directory}/authoring-metadata.json`)))
  assert.equal(manifest.armContract.textureSha256, '2c041879daf6509fe3da88a8e1b857e4b9a7c9b67279d012382f5f03529750e9')
  assert.deepEqual(Object.keys(manifest.skins), ghostDefinition.assets.skinIds)
  for (const [skinId, descriptor] of Object.entries(manifest.skins)) {
    const filename = path.join(directory, descriptor.url)
    const bytes = await readFile(filename)
    assert.equal(sha256(bytes), descriptor.sha256)
    const skin = JSON.parse(bytes)
    assert.equal(skin.skinId, skinId)
    assert.deepEqual(skin.compatibility, manifest.compatibility)
  }
  assert.equal(report.clips, 30)
  assert.equal(report.poseSamples, 9)
  assert.equal(report.gltfIssues.numErrors, 0)
  assert.equal(report.gltfIssues.numWarnings, 0)
})
