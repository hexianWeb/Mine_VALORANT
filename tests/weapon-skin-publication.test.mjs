import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
  const recipe = JSON.parse(await readFile('tools/weapons/skin-releases/classic-v2.json', 'utf8'))
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
  assert.equal(sha256(texture), sha256(await readFile(path.join(recipe.baseDirectory, 'textures/weapon.png'))))
  await validateWeaponPackage(report.directory)
  assert.deepEqual(await publishSkinRelease(recipe), report, 'an identical release is idempotent')
  await writeFile(path.join(report.directory, 'manifest.json'), '{}')
  await assert.rejects(publishSkinRelease(recipe), /Existing version differs/)
})

test('a material release rejects same-version replacement and incompatible or stale authoring evidence', async (t) => {
  const { recipe, directory } = await fixture(t)
  await assert.rejects(publishSkinRelease({ ...recipe, assetVersion: 'v1' }), /new assetVersion/)
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
