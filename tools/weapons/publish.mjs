import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { access, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { compatibilityFor, pngSize, readGlb, sha256, validateWeaponPackage } from './package-validation.mjs'
import { recipes } from './recipes.mjs'

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(import.meta.url)

function resource(url, bytes) {
  return {
    url,
    sha256: sha256(bytes),
    bytes: bytes.length,
  }
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
}

export function normalizedClips(source, weaponId) {
  const eventOwned = new Set([
    'draw',
    'shoot',
    'shoot_aim',
    'reload_tactical',
    'reload_empty',
  ])
  return source.clips.map(clip => ({
    name: clip.name,
    duration: clip.duration,
    loop: !!clip.loop,
    markers: Object.entries(clip.sound_effects ?? {}).flatMap(([time, input]) => {
      const cue = input.effect.split('/').at(-1).split(':').at(-1)
      const semantic = clip.name.startsWith('reload_')
        ? 'reload'
        : clip.name === 'shoot_aim'
          ? 'shoot'
          : clip.name
      // Gameplay emits these action-start sounds. Preserve independent markers such as salvo.
      if (Number(time) === 0 && eventOwned.has(clip.name) && cue === `${weaponId}_${semantic}`)
        return []
      return [
        {
          time: Number(time),
          cue,
        },
      ]
    }),
    controlBones: clip.control_bones ?? [],
  }))
}

async function runBlender(executable, requestFile) {
  await new Promise((resolve, reject) => {
    const child = spawn(executable, [
      '--background',
      '--factory-startup',
      '--disable-autoexec',
      '--python-exit-code',
      '1',
      '--python',
      path.join(project, 'tools/weapons/export_blender.py'),
      '--',
      requestFile,
    ], { windowsHide: true, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', code => code === 0
      ? resolve()
      : reject(new Error(`Blender exited ${code}`)))
  })
}

async function exists(filename) {
  try {
    await access(filename)
    return true
  }
  catch (error) {
    if (error.code === 'ENOENT')
      return false
    throw error
  }
}

async function files(directory, prefix = '') {
  const result = []
  for (const entry of await readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name)
    if (entry.isDirectory())
      result.push(...await files(directory, relative))
    else result.push(relative)
  }
  return result.sort()
}

/** Publishing a version twice must produce identical bytes; changed content needs a new version. */
async function install(candidate, target) {
  if (await exists(path.join(target, 'manifest.json'))) {
    const expected = await files(candidate)
    assert.deepEqual(await files(target), expected, `Existing version has a different file set: ${target}`)
    for (const relative of expected)
      assert.equal(sha256(await readFile(path.join(target, relative))), sha256(await readFile(path.join(candidate, relative))), `Existing version differs: ${relative}; publish a new assetVersion`)
    return
  }
  // Windows dev-server directory watchers can prevent directory renames. Publish the
  // entry manifest last, after every validated resource exists, without moving sources.
  await mkdir(target, { recursive: true })
  for (const relative of (await files(candidate)).filter(name => name !== 'manifest.json')) {
    await mkdir(path.dirname(path.join(target, relative)), { recursive: true })
    await cp(path.join(candidate, relative), path.join(target, relative))
  }
  await cp(path.join(candidate, 'manifest.json'), path.join(target, 'manifest.json'))
}

export async function publishWeapons({ weapons = ['classic', 'phantom'], blender, sourcePack, outputRoot, validatorModule, verifyOnly = false }) {
  const root = path.resolve(outputRoot ?? path.join(project, 'public/weapons'))
  const pack = path.resolve(sourcePack ?? path.join(project, '../vandal-roundtrip/valorant-first-person-pack'))
  const validator = require(validatorModule ?? path.resolve(pack, '../first-person/work/gltf-validator/node_modules/gltf-validator'))
  const selected = weapons.map((id) => {
    assert.ok(Object.hasOwn(recipes, id), `Unknown explicit weapon recipe: ${id}`)
    return recipes[id]
  })
  assert.equal(new Set(weapons).size, weapons.length, 'Repeated recipe')
  if (verifyOnly) {
    const results = []
    for (const recipe of selected) {
      const directory = path.join(root, recipe.weaponId, recipe.assetVersion)
      const report = JSON.parse(await readFile(path.join(directory, 'source-audit.json'), 'utf8'))
      results.push(await validateWeaponPackage(directory, { validator, poseSamples: report.poseSamples }))
    }
    return results
  }
  assert.ok(blender, 'Pass --blender PATH (or BLENDER_PATH); authoring is never sent to a live Blender instance')
  await mkdir(root, { recursive: true })
  const staging = await mkdtemp(path.join(root, '.publish-'))
  const prepared = []
  try {
    for (const recipe of selected) {
      const directory = path.join(staging, recipe.weaponId, recipe.assetVersion)
      await mkdir(path.join(directory, 'skins'), { recursive: true })
      await mkdir(path.join(directory, 'textures'), { recursive: true })
      const blend = path.resolve(project, recipe.blend)
      const texture = path.resolve(project, recipe.texture)
      const sourceManifest = path.join(pack, recipe.weaponId, 'manifest.json')
      const sourceBytes = await readFile(sourceManifest)
      const source = JSON.parse(sourceBytes)
      const blendHash = sha256(await readFile(blend))
      const textureBytes = await readFile(texture)
      assert.deepEqual(pngSize(textureBytes), { width: 2048, height: 2048 }, 'Expected the authored 2048px skin')
      const request = {
        ...recipe,
        blend,
        texture,
        sourceManifest,
        output: path.join(directory, 'model.glb'),
        report: path.join(directory, 'source-audit.json'),
      }
      const requestFile = path.join(staging, `${recipe.weaponId}-request.json`)
      await writeFile(requestFile, jsonBytes(request))
      await runBlender(blender, requestFile)
      assert.equal(sha256(await readFile(blend)), blendHash, 'Authoring source was modified')
      const modelBytes = await readFile(request.output)
      const audit = JSON.parse(await readFile(request.report, 'utf8'))
      const compatibility = compatibilityFor(readGlb(modelBytes))
      const textureName = `${sha256(textureBytes)}.png`
      await cp(texture, path.join(directory, 'textures', textureName))
      const skin = {
        schemaVersion: 1,
        weaponId: recipe.weaponId,
        assetVersion: recipe.assetVersion,
        skinId: recipe.skinId,
        compatibility,
        materials: {
          weapon: {
            map: {
              ...resource(`../textures/${textureName}`, textureBytes),
              ...pngSize(textureBytes),
              colorSpace: 'srgb',
              flipY: false,
              magFilter: 'nearest',
              minFilter: 'nearest',
              generateMipmaps: false,
            },
          },
        },
      }
      const skinBytes = jsonBytes(skin)
      await writeFile(path.join(directory, 'skins', `${recipe.skinId}.json`), skinBytes)
      const manifest = {
        schemaVersion: 1,
        weaponId: recipe.weaponId,
        assetVersion: recipe.assetVersion,
        model: resource('model.glb', modelBytes),
        compatibility,
        clips: normalizedClips(source, recipe.weaponId),
        actions: recipe.actions,
        requiredActions: recipe.requiredActions,
        materials: recipe.materials,
        meshes: recipe.meshes,
        sockets: recipe.sockets,
        defaultSkinId: recipe.skinId,
        skins: {
          [recipe.skinId]: resource(`skins/${recipe.skinId}.json`, skinBytes),
        },
        view: {
          unitsPerMeter: 1,
          up: 'Y',
          forward: '-Z',
          mountOffset: source.view.idle_position_blockbench.map(value => -value / 16),
          verticalFov: source.view.vertical_fov,
          aimVerticalFov: source.view.aim_vertical_fov,
          adsAlignmentBaked: source.view.ads_alignment_baked,
        },
        provenance: {
          sourceBlend: recipe.blend,
          sourceBlendSha256: blendHash,
          sourceManifestSha256: sha256(sourceBytes),
          sourceTextureSha256: sha256(textureBytes),
          exportScene: recipe.scene,
          blenderVersion: audit.blenderVersion,
        },
      }
      await writeFile(path.join(directory, 'manifest.json'), jsonBytes(manifest))
      const report = await validateWeaponPackage(directory, { validator, poseSamples: audit.poseSamples })
      await writeFile(path.join(directory, 'validation.json'), jsonBytes(report))
      prepared.push({ directory, recipe, report })
    }
    for (const { directory, recipe } of prepared)
      await install(directory, path.join(root, recipe.weaponId, recipe.assetVersion))
    return prepared.map(item => item.report)
  }
  finally {
    // Only remove the exact staging child just allocated under the explicit publication root.
    assert.equal(path.dirname(path.resolve(staging)), root)
    assert.ok(path.basename(staging).startsWith('.publish-'))
    await rm(staging, { recursive: true, force: true })
  }
}

async function main(args) {
  const options = { blender: process.env.BLENDER_PATH, weapons: [] }
  const names = {
    '--blender': 'blender',
    '--source-pack': 'sourcePack',
    '--out-root': 'outputRoot',
    '--validator-module': 'validatorModule',
  }
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]
    if (argument === '--verify-only') {
      options.verifyOnly = true
    }
    else if (Object.hasOwn(names, argument)) {
      assert.ok(args[index + 1] && !args[index + 1].startsWith('--'), `Missing value: ${argument}`)
      options[names[argument]] = args[++index]
    }
    else {
      assert.ok(!argument.startsWith('--'), `Unknown option: ${argument}`)
      options.weapons.push(argument)
    }
  }
  if (!options.weapons.length)
    delete options.weapons
  console.log(JSON.stringify(await publishWeapons(options), null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
