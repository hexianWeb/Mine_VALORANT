import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { sha256, validateWeaponPackage } from '../tools/weapons/package-validation.mjs'
import { publishSkinRelease } from '../tools/weapons/publish-skins.mjs'

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'weapon-skin-publication-'))
  t.after(async () => {
    assert.equal(path.dirname(directory), path.resolve(tmpdir()))
    assert.ok(path.basename(directory).startsWith('weapon-skin-publication-'))
    await rm(directory, { recursive: true, force: true })
  })
  // v2's audit is historical: the real authoring files now have the new arm UVs.
  // Start from the current normalized base and add its independently re-audited Sakura.
  const baseDirectory = path.join(directory, 'base')
  await cp('public/weapons/classic/v3', baseDirectory, { recursive: true })
  const manifestPath = path.join(baseDirectory, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  delete manifest.skins.sakura
  await writeFile(manifestPath, JSON.stringify(manifest))
  const recipe = JSON.parse(await readFile('tools/weapons/skin-releases/classic-v2.json', 'utf8'))
  recipe.baseDirectory = baseDirectory
  recipe.assetVersion = 'v4'
  recipe.variants[0].auditFile = 'public/weapons/classic/v3/skin-audits/sakura.json'
  return {
    directory,
    recipe: { ...recipe, outputRoot: directory, workRoot: directory },
  }
}

test('a material release preserves the exact base model and current local skin while adding the audited Sakura', async (t) => {
  const { recipe } = await fixture(t)
  const report = await publishSkinRelease(recipe)
  assert.deepEqual(report.skins, ['smite', 'sakura'])
  assert.equal(report.gltfIssues.numErrors, 0)
  assert.equal(report.gltfIssues.numWarnings, 0)
  assert.equal(sha256(await readFile(path.join(report.directory, 'model.glb'))), sha256(await readFile(path.join(recipe.baseDirectory, 'model.glb'))))
  const manifest = JSON.parse(await readFile(path.join(report.directory, 'manifest.json'), 'utf8'))
  const skin = JSON.parse(await readFile(path.join(report.directory, manifest.skins.smite.url), 'utf8'))
  const texture = await readFile(path.join(report.directory, 'skins', skin.materials.weapon.map.url))
  const base = JSON.parse(await readFile(path.join(recipe.baseDirectory, 'manifest.json'), 'utf8'))
  const baseSkin = JSON.parse(await readFile(path.join(recipe.baseDirectory, base.skins.smite.url), 'utf8'))
  assert.equal(sha256(texture), sha256(await readFile(path.resolve(recipe.baseDirectory, 'skins', baseSkin.materials.weapon.map.url))))
  await validateWeaponPackage(report.directory)
  assert.deepEqual(await publishSkinRelease(recipe), report, 'an identical release is idempotent')
  await writeFile(path.join(report.directory, 'manifest.json'), '{}')
  await assert.rejects(publishSkinRelease(recipe), /Existing version differs/)
})

test('material releases preserve existing emission and publish a separately authored emission map', async (t) => {
  const { recipe } = await fixture(t)
  const manifestPath = path.join(recipe.baseDirectory, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const descriptor = manifest.skins.smite
  const skinPath = path.join(recipe.baseDirectory, descriptor.url)
  const skin = JSON.parse(await readFile(skinPath, 'utf8'))
  skin.materials.weapon.emissiveMap = { ...skin.materials.weapon.map }
  skin.materials.weapon.emissiveIntensity = 0.75
  const skinBytes = JSON.stringify(skin)
  await writeFile(skinPath, skinBytes)
  descriptor.sha256 = sha256(skinBytes)
  descriptor.bytes = new TextEncoder().encode(skinBytes).length
  await writeFile(manifestPath, JSON.stringify(manifest))
  const variant = recipe.variants[0]
  variant.emissiveMap = variant.texture
  variant.emissiveMapSha256 = sha256(await readFile(variant.emissiveMap))
  variant.emissiveIntensity = 2.5
  const report = await publishSkinRelease(recipe)
  for (const [skinId, intensity, emissionHash] of [
    ['smite', 0.75, skin.materials.weapon.emissiveMap.sha256],
    ['sakura', 2.5, variant.emissiveMapSha256],
  ]) {
    const published = JSON.parse(await readFile(path.join(report.directory, 'skins', `${skinId}.json`), 'utf8'))
    const material = published.materials.weapon
    assert.equal(material.emissiveIntensity, intensity)
    assert.equal(material.emissiveMap.sha256, emissionHash)
    assert.equal(sha256(await readFile(path.resolve(report.directory, 'skins', material.emissiveMap.url))), emissionHash)
  }
  await validateWeaponPackage(report.directory)
  variant.emissiveMapSha256 = '0'.repeat(64)
  await assert.rejects(publishSkinRelease(recipe), /Emissive PNG changed/)
})

test('a material release rejects same-version replacement and incompatible or stale authoring evidence', async (t) => {
  const { recipe, directory } = await fixture(t)
  await assert.rejects(publishSkinRelease({ ...recipe, assetVersion: 'v3' }), /new assetVersion/)
  const proof = JSON.parse(await readFile(recipe.variants[0].auditFile, 'utf8'))
  proof.skin.rig = 'different'
  const auditFile = path.join(directory, 'bad-audit.json')
  await writeFile(auditFile, JSON.stringify(proof))
  await assert.rejects(publishSkinRelease({
    ...recipe,
    variants: [
      { ...recipe.variants[0], auditFile },
    ],
  }), /Incompatible authoring variant/)
  proof.skin.rig = proof.base.rig
  proof.skin.textureSha256 = 'stale'
  await writeFile(auditFile, JSON.stringify(proof))
  await assert.rejects(publishSkinRelease({
    ...recipe,
    variants: [
      { ...recipe.variants[0], auditFile },
    ],
  }), /PNG changed/)
})
