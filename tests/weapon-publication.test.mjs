import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { compatibilityFor, readGlb, sha256, validateWeaponPackage } from '../tools/weapons/package-validation.mjs'
import { normalizedClips } from '../tools/weapons/publish.mjs'

const publication = fileURLToPath(new URL('../public/weapons/', import.meta.url))

async function temporaryPackage(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'weapon-publication-test-'))
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()))
    assert.ok(path.basename(directory).startsWith('weapon-publication-test-'))
    await rm(directory, { recursive: true, force: true })
  })
  await cp(path.join(publication, 'classic/v1'), directory, { recursive: true })
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'))
  return {
    directory,
    manifest,
    save: () => writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest)),
  }
}

test('published current-skin packages bind every clip and match the authoring Blender poses', async () => {
  for (const [weaponId, assetVersion, clipCount, meshCount] of [
    ['classic', 'v1', 31, 4],
    ['classic', 'v2', 31, 4],
    ['phantom', 'v1', 30, 5],
  ]) {
    const directory = path.join(publication, weaponId, assetVersion)
    const audit = JSON.parse(await readFile(path.join(directory, 'source-audit.json'), 'utf8'))
    const report = await validateWeaponPackage(directory, { poseSamples: audit.poseSamples })
    assert.equal(report.clips, clipCount)
    assert.equal(report.meshes, meshCount)
    assert.equal(report.poseSamples, 9)
    assert.ok(report.maxPoseBoundsError < 1e-6)
    assert.ok(report.stepTracks > 0)
    const recorded = JSON.parse(await readFile(path.join(directory, 'validation.json'), 'utf8'))
    assert.equal(recorded.gltfIssues.numErrors, 0)
    assert.equal(recorded.gltfIssues.numWarnings, 0)
    assert.equal(report.tracks, recorded.tracks)
  }
})

test('publication validation rejects changed model bytes before loading the asset', async (t) => {
  const fixture = await temporaryPackage(t)
  const filename = path.join(fixture.directory, fixture.manifest.model.url)
  const bytes = await readFile(filename)
  bytes[bytes.length - 1] ^= 1
  await writeFile(filename, bytes)
  await assert.rejects(validateWeaponPackage(fixture.directory), /SHA256 mismatch/)
})

test('publication validation rejects unbound action and material roles', async (t) => {
  const fixture = await temporaryPackage(t)
  const original = fixture.manifest.actions.fire
  fixture.manifest.actions.fire = 'absent_shoot'
  await fixture.save()
  await assert.rejects(validateWeaponPackage(fixture.directory), /Missing action binding/)
  fixture.manifest.actions.fire = original
  fixture.manifest.materials.weapon = ['absent_material']
  await fixture.save()
  await assert.rejects(validateWeaponPackage(fixture.directory), /Unbound material/)
})

test('skin hash validity cannot hide a different compatibility signature', async (t) => {
  const fixture = await temporaryPackage(t)
  const descriptor = fixture.manifest.skins.smite
  const filename = path.join(fixture.directory, descriptor.url)
  const skin = JSON.parse(await readFile(filename, 'utf8'))
  skin.compatibility.rig = '0'.repeat(64)
  const bytes = JSON.stringify(skin)
  await writeFile(filename, bytes)
  descriptor.sha256 = sha256(bytes)
  descriptor.bytes = new TextEncoder().encode(bytes).length
  await fixture.save()
  await assert.rejects(validateWeaponPackage(fixture.directory), /Incompatible skin/)
})

test('publication resource paths cannot escape their package', async (t) => {
  const fixture = await temporaryPackage(t)
  fixture.manifest.model.url = '../model.glb'
  await fixture.save()
  await assert.rejects(validateWeaponPackage(fixture.directory), /escapes package/)
})

test('compatibility signatures separate rig, topology/UV and animation inputs from texture pixels', async () => {
  const bytes = await readFile(path.join(publication, 'classic/v1/model.glb'))
  const glb = readGlb(bytes)
  const original = compatibilityFor(glb)
  glb.doc.nodes[0].translation = [1, 2, 3]
  const changedRig = compatibilityFor(glb)
  assert.notEqual(changedRig.rig, original.rig)
  assert.equal(changedRig.geometryUV, original.geometryUV)
  assert.equal(changedRig.clipSet, original.clipSet)
  glb.doc.animations[0].samplers[0].interpolation = 'CHANGED'
  assert.notEqual(compatibilityFor(glb).clipSet, original.clipSet)
  glb.doc.materials[0].pbrMetallicRoughness.baseColorFactor = [0, 1, 0, 1]
  assert.equal(compatibilityFor(glb).geometryUV, original.geometryUV)
})

test('normalization removes duplicated gameplay-start audio and preserves independent markers', () => {
  const source = {
    clips: [
      {
        name: 'shoot',
        duration: 1,
        loop: false,
        sound_effects: {
          0: { effect: 'phantom_shoot' },
          0.25: { effect: 'valorant:operator/operator_bolt' },
        },
      },
      {
        name: 'reload_empty',
        duration: 2.5,
        sound_effects: {
          0: { effect: 'phantom_reload' },
        },
      },
      {
        name: 'shoot_salvo',
        duration: 1,
        sound_effects: {
          0: { effect: 'valorant:classic/classic_shoot_salvo' },
        },
      },
    ],
  }
  const clips = normalizedClips(source, 'phantom')
  assert.deepEqual(clips[0].markers, [
    { time: 0.25, cue: 'operator_bolt' },
  ])
  assert.deepEqual(clips[1].markers, [])
  assert.deepEqual(clips[2].markers, [
    { time: 0, cue: 'classic_shoot_salvo' },
  ])
  assert.ok(source.clips[0].sound_effects[0])
})
