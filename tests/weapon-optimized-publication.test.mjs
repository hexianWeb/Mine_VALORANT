import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import validator from 'gltf-validator'
import { classicDefinition } from '../src/game/weapons/definitions/classic.js'
import { cropGunAtlas, decodeAtlas, encodeAtlas, remapGunUV } from '../tools/weapons/gun-atlas.mjs'
import { accessorBytes, pngSize, readGlb, sha256, validateWeaponPackage } from '../tools/weapons/package-validation.mjs'
import { meshStatistics, publishOptimizedWeapon } from '../tools/weapons/publish-optimized.mjs'

const directory = 'public/weapons/classic/v4'
const recipeFile = 'tools/weapons/optimized-releases/classic-v4.json'
const manifest = JSON.parse(await readFile(`${directory}/manifest.json`, 'utf8'))

test('lossless atlas crop preserves texels, non-power-of-two dimensions and transparent outer gutters', () => {
  const rgba = Buffer.from(Array.from({ length: 6 * 5 * 4 }, (_, index) => index % 251))
  const source = { width: 6, height: 5, rgba }
  assert.deepEqual(decodeAtlas(encodeAtlas(source)).rgba, rgba)
  const crop = cropGunAtlas(encodeAtlas(source), {
    rect: [1, 1, 2, 2],
    padding: 2,
  })
  assert.deepEqual([crop.width, crop.height], [6, 6])
  const decoded = decodeAtlas(crop.bytes)
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 2; x++) {
      assert.deepEqual(decoded.rgba.subarray(((y + 2) * 6 + x + 2) * 4, ((y + 2) * 6 + x + 2) * 4 + 4), rgba.subarray(((y + 1) * 6 + x + 1) * 4, ((y + 1) * 6 + x + 1) * 4 + 4))
    }
  }
  for (let index = 0; index < 6; index++) {
    for (const pixel of [
      index,
      30 + index,
      index * 6,
      index * 6 + 5,
    ])
      assert.equal(decoded.rgba[pixel * 4 + 3], 0)
  }
  const invalid = encodeAtlas(source)
  invalid[20] ^= 1
  assert.throws(() => decodeAtlas(invalid), /CRC/)
  assert.throws(() => cropGunAtlas(encodeAtlas(source), {
    rect: [5, 0, 2, 2],
    padding: 2,
  }), /exceeds/)
})

test('UV remapping keeps Blender V orientation and original pixel coordinates within float32 precision', () => {
  for (const [x, y] of [
    [0, 0],
    [14, 20],
    [105.5, 84.25],
    [332, 332],
  ]) {
    const [u, v] = remapGunUV([x / 2048, 1 - y / 2048], {
      sourceSize: [2048, 2048],
    })
    assert.ok(Math.abs(u * 336 - 2 - x) < 0.0001)
    assert.ok(Math.abs((1 - v) * 336 - 2 - y) < 0.0001)
  }
  assert.throws(() => remapGunUV([0.8, 0.1], {
    sourceSize: [2048, 2048],
  }), /excluded content/)
})

test('optimized Classic publishes current geometry, full actions, shared arms and AG as the game default', async () => {
  const audit = JSON.parse(await readFile(`${directory}/source-audit.json`, 'utf8'))
  const report = await validateWeaponPackage(directory, { validator, poseSamples: audit.poseSamples })
  assert.equal(report.clips, 31)
  assert.equal(report.tracks, 1116)
  assert.equal(report.stepTracks, 1)
  assert.equal(report.poseSamples, 9)
  assert.ok(report.maxPoseBoundsError < 1e-6)
  assert.equal(report.gltfIssues.numErrors, 0)
  assert.equal(report.gltfIssues.numWarnings, 0)
  assert.equal(audit.optimizedGeometry.restRigMatched, true)
  assert.equal(audit.optimizedGeometry.identicalAuthoringActions, 31)
  assert.equal(audit.optimizedGeometry.preservedAuthoredBlendedWeights, true)
  assert.equal(audit.sourceSha256, manifest.provenance.sourceBlendSha256)
  assert.equal(classicDefinition.assets.assetVersion, manifest.assetVersion)
  assert.equal(classicDefinition.assets.defaultSkinId, 'ag')
  assert.deepEqual(classicDefinition.assets.skinIds, Object.keys(manifest.skins))
  const old = readGlb(await readFile('public/weapons/classic/v3/model.glb'))
  const current = readGlb(await readFile(`${directory}/model.glb`))
  const stats = meshStatistics(current)
  assert.equal(stats.Weapon_Body.triangles, 1413)
  assert.equal(stats.Weapon_Magazine.triangles, 158)
  assert.ok(stats.Weapon_Body.triangles < meshStatistics(old).Weapon_Body.triangles)
  assert.deepEqual(audit.optimizedGeometry.meshes.map(mesh => mesh.vertices), [1030, 316])
  const previous = JSON.parse(await readFile('public/weapons/classic/v3/manifest.json', 'utf8'))
  assert.deepEqual(manifest.armContract, previous.armContract)
  assert.deepEqual(manifest.clips, previous.clips)
  assert.deepEqual(manifest.actions, previous.actions)
  assert.deepEqual(manifest.view, previous.view)
  assert.notEqual(manifest.compatibility.geometryUV, previous.compatibility.geometryUV)
})

test('all three skins use matching 336 atlases; Sakura is a lossless crop, not a stale old-UV texture', async () => {
  const base = JSON.parse(await readFile('public/weapons/classic/v3/skins/sakura.json', 'utf8'))
  const original = await readFile(path.resolve('public/weapons/classic/v3/skins', base.materials.weapon.map.url))
  const expectedSakura = cropGunAtlas(original).bytes
  for (const [skinId, descriptor] of Object.entries(manifest.skins)) {
    const skin = JSON.parse(await readFile(path.join(directory, descriptor.url), 'utf8'))
    const bytes = await readFile(path.resolve(directory, 'skins', skin.materials.weapon.map.url))
    assert.deepEqual(skin.compatibility, manifest.compatibility)
    assert.deepEqual(pngSize(bytes), { width: 336, height: 336 })
    const decoded = decodeAtlas(bytes)
    assert.equal(decoded.rgba[(336 * 336 - 1) * 4 + 3], 0)
    if (skinId === 'sakura')
      assert.equal(sha256(bytes), sha256(expectedSakura))
  }
})

test('old flash cards sample the transparent corner and authored mixed weights are preserved', async () => {
  const glb = readGlb(await readFile(`${directory}/model.glb`))
  const primitive = glb.doc.meshes.find(mesh => mesh.name === 'Weapon_Body').primitives[0]
  const uv = accessorBytes(glb, primitive.attributes.TEXCOORD_0)
  const indices = accessorBytes(glb, primitive.indices)
  const component = glb.doc.accessors[primitive.indices].componentType
  const indexAt = index => component === 5123
    ? indices.readUInt16LE(index * 2)
    : indices.readUInt32LE(index * 4)
  let transparentTriangles = 0
  for (let index = 0; index < glb.doc.accessors[primitive.indices].count; index += 3) {
    if ([0, 1, 2].every(offset => uv.readFloatLE(indexAt(index + offset) * 8) > 0.995 && uv.readFloatLE(indexAt(index + offset) * 8 + 4) > 0.995))
      transparentTriangles++
  }
  assert.equal(transparentTriangles, 4)
  assert.equal(glb.doc.materials[primitive.material].alphaMode, 'MASK')
  const weights = accessorBytes(glb, primitive.attributes.WEIGHTS_0)
  assert.equal(glb.doc.accessors[primitive.attributes.WEIGHTS_0].componentType, 5126)
  let blended = 0
  for (let vertex = 0; vertex < glb.doc.accessors[primitive.attributes.WEIGHTS_0].count; vertex++) {
    if ([0, 1, 2, 3].filter(channel => weights.readFloatLE(vertex * 16 + channel * 4) > 1e-6).length > 1)
      blended++
  }
  assert.ok(blended > 0)
})

test('mixed-weight validation is an explicit release contract, not a relaxation of legacy packages', async (t) => {
  const work = 'D:/opencode-temp/opencode'
  await mkdir(work, { recursive: true })
  const copy = await mkdtemp(path.join(work, 'optimized-package-test-'))
  t.after(async () => {
    assert.ok(path.basename(copy).startsWith('optimized-package-test-'))
    await rm(copy, { recursive: true, force: true })
  })
  await cp(directory, copy, { recursive: true })
  const altered = structuredClone(manifest)
  delete altered.skinning
  await writeFile(path.join(copy, 'manifest.json'), JSON.stringify(altered))
  await assert.rejects(validateWeaponPackage(copy), /Expected rigid source weights/)
  altered.skinning = { maxInfluences: 5 }
  await writeFile(path.join(copy, 'manifest.json'), JSON.stringify(altered))
  await assert.rejects(validateWeaponPackage(copy), /Invalid declared skin influence limit/)
})

test('verify-only checks the exact release recipe without opening authoring files or Blender', async (t) => {
  const recipe = await readFile(recipeFile)
  assert.equal(sha256(recipe), manifest.provenance.releaseRecipeSha256)
  const report = await publishOptimizedWeapon({ recipeFile, verifyOnly: true })
  assert.equal(report.weaponId, 'classic')
  assert.equal(report.gltfIssues.numErrors, 0)
  const work = 'D:/opencode-temp/opencode'
  await mkdir(work, { recursive: true })
  const copy = await mkdtemp(path.join(work, 'optimized-recipe-test-'))
  t.after(async () => {
    assert.ok(path.basename(copy).startsWith('optimized-recipe-test-'))
    await rm(copy, { recursive: true, force: true })
  })
  const altered = path.join(copy, 'recipe.json')
  await writeFile(altered, Buffer.concat([
    recipe,
    Buffer.from('\n'),
  ]))
  await assert.rejects(publishOptimizedWeapon({ recipeFile: altered, verifyOnly: true }), /Published release recipe changed/)
})
