import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { checkWeaponIteration } from '../tools/weapons/check-iteration.mjs'
import { decodeAtlas, encodeAtlas } from '../tools/weapons/gun-atlas.mjs'
import { iterationModelKey, iterationToolchainFingerprint, validateWeaponIteration } from '../tools/weapons/iteration-validation.mjs'
import { sha256, validateWeaponPackage } from '../tools/weapons/package-validation.mjs'
import { publishOptimizedWeapon } from '../tools/weapons/publish-optimized.mjs'
import { createWorkflowTiming } from '../tools/weapons/workflow-timing.mjs'

async function fixture(t) {
  const work = 'D:/opencode-temp/opencode'
  await mkdir(work, { recursive: true })
  const root = await mkdtemp(path.join(work, 'weapon-iteration-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const directory = path.join(root, 'package')
  await cp('public/weapons/classic/v4', directory, { recursive: true })
  return {
    root,
    directory,
    cacheRoot: path.join(root, 'cache'),
  }
}

async function editSkin(directory, edit) {
  const manifestFile = path.join(directory, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'))
  const descriptor = manifest.skins.ag
  const skinFile = path.resolve(directory, descriptor.url)
  const skin = JSON.parse(await readFile(skinFile, 'utf8'))
  const map = skin.materials.weapon.map
  const file = path.resolve(path.dirname(skinFile), map.url)
  const bytes = await edit(await readFile(file))
  await writeFile(file, bytes)
  map.sha256 = sha256(bytes)
  map.bytes = bytes.length
  const encoded = Buffer.from(JSON.stringify(skin))
  await writeFile(skinFile, encoded)
  descriptor.sha256 = sha256(encoded)
  descriptor.bytes = encoded.length
  await writeFile(manifestFile, JSON.stringify(manifest))
}

test('preview samples only representative actions and reuses unchanged model work', async (t) => {
  const f = await fixture(t)
  const cold = await validateWeaponIteration(f.directory, f)
  assert.equal(cold.profile, 'preview')
  assert.equal(cold.publishable, false)
  assert.equal(cold.poseSamples, 3)
  assert.equal(cold.sampledClips, 3)
  assert.equal(cold.gltfIssues, null)
  assert.equal(cold.modelCache.hit, false)
  const warm = await validateWeaponIteration(f.directory, f)
  assert.equal(warm.modelCache.hit, true)
  assert.equal(warm.modelCache.key, cold.modelCache.key)
  assert.ok(!warm.timings.stages.some(stage => stage.name === 'model-preview-checks'))
  assert.ok(warm.timings.stages.some(stage => stage.name === 'resources-and-bindings'))
  assert.ok(warm.timings.stages.some(stage => stage.name === 'decode-png'))
})

test('external skin-only changes reuse model checks but still decode the current pixels', async (t) => {
  const f = await fixture(t)
  const before = await validateWeaponIteration(f.directory, f)
  await editSkin(f.directory, (bytes) => {
    const image = decodeAtlas(bytes)
    image.rgba[4 * (336 * 10 + 10)] ^= 1
    return encodeAtlas(image)
  })
  const after = await validateWeaponIteration(f.directory, f)
  assert.equal(after.modelCache.hit, true)
  assert.equal(after.modelCache.key, before.modelCache.key)
  await editSkin(f.directory, (bytes) => {
    const corrupt = Buffer.from(bytes)
    corrupt[40] ^= 1
    return corrupt
  })
  await assert.rejects(validateWeaponIteration(f.directory, f), /CRC/)
})

test('cache hits never bypass current model hashes', async (t) => {
  const f = await fixture(t)
  await validateWeaponIteration(f.directory, f)
  const modelFile = path.join(f.directory, 'model.glb')
  const model = await readFile(modelFile)
  model[model.length - 1] ^= 1
  await writeFile(modelFile, model)
  await assert.rejects(validateWeaponIteration(f.directory, f), /SHA256 mismatch/)
})

test('model, rig/UV/action signatures, metadata, weights, poses and toolchain all invalidate the model key', async () => {
  const manifest = JSON.parse(await readFile('public/weapons/classic/v4/manifest.json', 'utf8'))
  const poses = [
    { clip: 'static_idle', time: 0 },
  ]
  const key = iterationModelKey(manifest, poses, 'tool-v1')
  for (const edit of [
    value => value.model.sha256 = 'changed',
    value => value.compatibility.rig = 'changed',
    value => value.compatibility.geometryUV = 'changed',
    value => value.compatibility.clipSet = 'changed',
    value => value.clips[0].duration += 1,
    value => value.skinning.maxInfluences = 3,
    value => value.armContract.textureSha256 = 'changed',
  ]) {
    const changed = structuredClone(manifest)
    edit(changed)
    assert.notEqual(iterationModelKey(changed, poses, 'tool-v1'), key)
  }
  assert.notEqual(iterationModelKey(manifest, [], 'tool-v1'), key)
  assert.notEqual(iterationModelKey(manifest, poses, 'tool-v2'), key)
})

test('toolchain fingerprints use file contents, not just paths or versions', async (t) => {
  const f = await fixture(t)
  const file = path.join(f.root, 'tool.mjs')
  await writeFile(file, 'version-a')
  const first = await iterationToolchainFingerprint([file])
  await writeFile(file, 'version-b')
  assert.notEqual(await iterationToolchainFingerprint([file]), first)
})

test('damaged cache entries are recomputed and --no-cache forces fresh preview checks', async (t) => {
  const f = await fixture(t)
  const first = await validateWeaponIteration(f.directory, f)
  await writeFile(path.join(f.cacheRoot, `${first.modelCache.key}.json`), '{broken')
  assert.equal((await validateWeaponIteration(f.directory, f)).modelCache.hit, false)
  assert.equal((await validateWeaponIteration(f.directory, f)).modelCache.hit, true)
  assert.equal((await validateWeaponIteration(f.directory, { ...f, cache: false })).modelCache.hit, false)
})

test('release validation always performs the full nine-pose/glTF gate and does not consume preview cache', async (t) => {
  const f = await fixture(t)
  await validateWeaponIteration(f.directory, f)
  const report = await checkWeaponIteration([
    f.directory,
    '--release',
    '--cache-root',
    f.cacheRoot,
  ])
  assert.equal(report.profile, 'release')
  assert.equal(report.poseSamples, 9)
  assert.equal(report.modelCache.hit, false)
  assert.equal(report.gltfIssues.numErrors, 0)
  assert.equal(report.gltfIssues.numWarnings, 0)
  const original = JSON.parse(await readFile(path.join(f.directory, 'validation.json'), 'utf8'))
  assert.equal(report.tracks, original.tracks)
  assert.equal(report.maxPoseBoundsError, original.maxPoseBoundsError)
})

test('preview-marked candidates cannot pass release validation or become a release base', async (t) => {
  const f = await fixture(t)
  const file = path.join(f.directory, 'manifest.json')
  const manifest = JSON.parse(await readFile(file, 'utf8'))
  manifest.provenance.preview = true
  await writeFile(file, JSON.stringify(manifest))
  assert.equal((await validateWeaponIteration(f.directory, f)).publishable, false)
  await assert.rejects(validateWeaponPackage(f.directory), /Preview packages cannot pass release validation/)
  const recipe = JSON.parse(await readFile('tools/weapons/optimized-releases/classic-v4.json', 'utf8'))
  recipe.baseDirectory = f.directory
  recipe.baseManifestSha256 = sha256(await readFile(file))
  const recipeFile = path.join(f.root, 'preview-base.json')
  await writeFile(recipeFile, JSON.stringify(recipe))
  await assert.rejects(publishOptimizedWeapon({ recipeFile, preview: true, blender: 'not-invoked' }), /cannot be used as a verified release base/)
})

test('preview publication rejects project output and conflicting modes before invoking Blender', async () => {
  const recipeFile = 'tools/weapons/optimized-releases/classic-v4.json'
  await assert.rejects(publishOptimizedWeapon({ recipeFile, preview: true, outputRoot: 'public/weapons' }), /outside the project/)
  await assert.rejects(publishOptimizedWeapon({ recipeFile, preview: true, verifyOnly: true }), /cannot be combined/)
})

test('iteration reports stay outside assets and preserve failure timings', async (t) => {
  const f = await fixture(t)
  const protectedReport = path.join(f.directory, 'manifest.json')
  await assert.rejects(checkWeaponIteration([f.directory, '--report', protectedReport]), /outside the asset package/)
  const reportFile = path.join(f.root, 'failed.json')
  await writeFile(path.join(f.directory, 'model.glb'), 'corrupt')
  await assert.rejects(checkWeaponIteration([f.directory, '--report', reportFile]), /mismatch/)
  const report = JSON.parse(await readFile(reportFile, 'utf8'))
  assert.equal(report.passed, false)
  assert.ok(report.timings.stages.some(stage => stage.passed === false))
})

test('workflow timing records failures without swallowing errors', async () => {
  const timing = createWorkflowTiming()
  await assert.rejects(timing.measure('failed-stage', async () => {
    throw new Error('expected')
  }), /expected/)
  assert.deepEqual(timing.snapshot().stages.map(stage => [stage.name, stage.passed]), [
    ['failed-stage', false],
  ])
})
