import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { ghostDefinition } from '../src/game/weapons/definitions/ghost.js'
import { judgeDefinition } from '../src/game/weapons/definitions/judge.js'
import { odinDefinition } from '../src/game/weapons/definitions/odin.js'
import { phantomDefinition } from '../src/game/weapons/definitions/phantom.js'
import { sheriffDefinition } from '../src/game/weapons/definitions/sheriff.js'
import { decodeAtlas } from '../tools/weapons/gun-atlas.mjs'
import { inspectWeaponPackage, sha256 } from '../tools/weapons/package-validation.mjs'

const recipeBytes = await readFile('tools/weapons/skin-releases/original-atlas.json')
const recipe = JSON.parse(recipeBytes)
const readJSON = async file => JSON.parse(await readFile(file))

const definitions = [
  ghostDefinition,
  sheriffDefinition,
  phantomDefinition,
  judgeDefinition,
  odinDefinition,
]

for (const definition of definitions) {
  const { id, assets } = definition
  test(`${id} defaults to its native original atlas without changing the published model or variants`, async () => {
    const spec = recipe.weaponReleases[id]
    const base = path.join('public/weapons', id, spec.baseVersion)
    const current = path.join('public/weapons', id, spec.assetVersion)
    const baseBytes = await readFile(path.join(base, 'manifest.json'))
    const before = JSON.parse(baseBytes)
    const { manifest, bytes: model } = await inspectWeaponPackage(current)
    assert.equal(sha256(baseBytes), spec.baseManifestSha256)
    assert.equal(sha256(model), before.model.sha256)
    assert.deepEqual(manifest.model, before.model)
    for (const key of [
      'compatibility',
      'clips',
      'actions',
      'armContract',
      'ammoDisplay',
      'runtimeControls',
      'view',
    ])
      assert.deepEqual(manifest[key], before[key], key)
    assert.equal(assets.assetVersion, manifest.assetVersion)
    assert.equal(assets.defaultSkinId, 'original')
    assert.equal(manifest.defaultSkinId, 'original')
    assert.deepEqual(assets.skinIds, [
      ...Object.keys(before.skins),
      'original',
    ])
    assert.deepEqual(Object.keys(manifest.skins), assets.skinIds)
    assert.notEqual(manifest.provenance.preview, true)
    assert.equal(manifest.provenance.originalAtlas.recipe.sha256, sha256(recipeBytes))
    const auditBytes = await readFile(path.join(current, manifest.provenance.originalAtlas.audit.url))
    assert.equal(sha256(auditBytes), manifest.provenance.originalAtlas.audit.sha256)
    const audit = JSON.parse(auditBytes)
    assert.equal(audit.sourceBlendSha256, recipe.sourceBlend.sha256)
    assert.equal(audit.packedAtlasSha256, spec.atlasSha256)

    for (const [skinId, ref] of Object.entries(before.skins)) {
      const legacy = await readJSON(path.join(base, ref.url))
      const skin = await readJSON(path.join(current, manifest.skins[skinId].url))
      assert.deepEqual(skin, { ...legacy, assetVersion: spec.assetVersion })
    }
    const original = path.join(current, manifest.skins.original.url)
    const { materials: { weapon: { map } } } = await readJSON(original)
    const texture = await readFile(path.resolve(path.dirname(original), map.url))
    const source = await readFile(`assets/weapons/original-textures/${id}/weapon.png`)
    assert.equal(sha256(source), spec.atlasSha256)
    assert.equal(audit.publishedAtlasSha256, sha256(texture))
    assert.deepEqual(texture, source.subarray(0, texture.length))
    const padding = source.subarray(texture.length)
    assert.equal(padding.length, audit.trailingZeroBytesRemoved)
    assert.ok(padding.length <= 3 && padding.every(byte => byte === 0))
    const { width, height } = decodeAtlas(texture)
    assert.deepEqual([width, height], [spec.atlasSize, spec.atlasSize])
  })
}
