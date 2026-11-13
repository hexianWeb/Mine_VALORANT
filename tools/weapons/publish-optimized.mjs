import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import validator from 'gltf-validator'
import { cropGunAtlas, decodeAtlas } from './gun-atlas.mjs'
import { validateWeaponIteration } from './iteration-validation.mjs'
import { compatibilityFor, pngSize, readGlb, sha256, validateWeaponPackage } from './package-validation.mjs'
import { installWeaponPackage } from './publish.mjs'
import { recipes } from './recipes.mjs'
import { createWorkflowTiming } from './workflow-timing.mjs'

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const json = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
function resource(url, bytes) {
  return {
    url,
    sha256: sha256(bytes),
    bytes: bytes.length,
  }
}

export function meshStatistics(glb) {
  return Object.fromEntries(glb.doc.nodes.filter(node => node.mesh !== undefined).map(node => [
    node.name,
    glb.doc.meshes[node.mesh].primitives.reduce((stats, primitive) => ({
      vertices: stats.vertices + glb.doc.accessors[primitive.attributes.POSITION].count,
      triangles: stats.triangles + glb.doc.accessors[primitive.indices].count / 3,
    }), { vertices: 0, triangles: 0 }),
  ]))
}

async function runBlender(blender, request, workRoot) {
  await new Promise((resolve, reject) => {
    const child = spawn(blender, [
      '--background',
      '--factory-startup',
      '--disable-autoexec',
      '--python-exit-code',
      '1',
      '--python',
      path.join(project, 'tools/weapons/export_blender.py'),
      '--',
      request,
    ], {
      windowsHide: true,
      stdio: 'inherit',
      env: { ...process.env, TEMP: workRoot, TMP: workRoot },
    })
    child.once('error', reject)
    child.once('exit', code => code === 0
      ? resolve()
      : reject(new Error(`Optimized export exited ${code}`)))
  })
}

/** Preview is opt-in; release always performs fresh, complete validation. */
export async function publishOptimizedWeapon(options) {
  const timing = createWorkflowTiming(options.onStage)
  try {
    const report = await buildOptimizedWeapon(options, timing)
    return {
      ...report,
      timings: timing.snapshot(),
    }
  }
  catch (error) {
    error.timings = timing.snapshot()
    throw error
  }
}

function outsideProject(directory) {
  const relative = path.relative(project, directory)
  assert.ok(relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative), 'Preview output must be outside the project; never replace published assets')
}

async function buildOptimizedWeapon({ recipeFile, blender, outputRoot, workRoot = 'D:/opencode-temp/opencode', verifyOnly = false, preview = false }, timing) {
  assert.ok(!(preview && verifyOnly), 'Use check-iteration.mjs for an existing preview; --preview and --verify-only cannot be combined')
  const recipeBytes = await timing.measure('read-recipe', () => readFile(recipeFile))
  const recipe = JSON.parse(recipeBytes)
  assert.equal(recipe.schemaVersion, 1)
  assert.ok(Object.hasOwn(recipes, recipe.weaponId), 'Unknown weapon recipe')
  assert.match(recipe.assetVersion, /^[\w-]+$/)
  let target = path.join(path.resolve(outputRoot ?? path.join(project, 'public/weapons')), recipe.weaponId, recipe.assetVersion)
  const previewRoot = path.resolve(outputRoot ?? process.env.WEAPON_PREVIEW_ROOT ?? 'D:/opencode-temp/opencode/weapon-previews')
  if (preview)
    outsideProject(previewRoot)
  if (verifyOnly) {
    const published = JSON.parse(await readFile(path.join(target, 'manifest.json'), 'utf8'))
    assert.equal(published.provenance.releaseRecipeSha256, sha256(recipeBytes), 'Published release recipe changed')
    const audit = JSON.parse(await readFile(path.join(target, 'source-audit.json'), 'utf8'))
    return timing.measure('release-validation', () => validateWeaponPackage(target, { validator, poseSamples: audit.poseSamples }))
  }
  assert.ok(blender, 'Pass --blender PATH; never export through the live Blender')
  const base = path.resolve(project, recipe.baseDirectory)
  const baseBytes = await readFile(path.join(base, 'manifest.json'))
  assert.equal(sha256(baseBytes), recipe.baseManifestSha256, 'Base metadata changed')
  const manifest = JSON.parse(baseBytes)
  assert.ok(!manifest.provenance?.preview, 'A preview cannot be used as a verified release base')
  assert.equal(manifest.weaponId, recipe.weaponId)
  assert.notEqual(manifest.assetVersion, recipe.assetVersion, 'Optimized geometry needs a new version')
  await timing.measure('base-validation', async () => {
    if (preview)
      return validateWeaponIteration(base)
    const previousAudit = JSON.parse(await readFile(path.join(base, 'source-audit.json'), 'utf8'))
    return validateWeaponPackage(base, { validator, poseSamples: previousAudit.poseSamples })
  })
  const rigBlend = path.resolve(project, recipe.rigBlend)
  const meshBlend = path.resolve(project, recipe.geometrySource.blend)
  const [rigHash, meshHash] = await timing.measure('source-fingerprints', () => Promise.all([rigBlend, meshBlend].map(async file => sha256(await readFile(file)))))
  if (!preview) {
    assert.equal(rigHash, recipe.rigBlendSha256, 'Rig authoring changed')
    assert.equal(meshHash, recipe.geometrySource.sha256, 'Optimized authoring changed')
  }
  assert.equal(new Set(recipe.skins.map(skin => skin.skinId)).size, recipe.skins.length, 'Duplicate skin ID')
  assert.ok(recipe.skins.some(skin => skin.skinId === recipe.defaultSkinId), 'Missing default skin')
  await mkdir(workRoot, { recursive: true })
  const staging = await mkdtemp(path.join(workRoot, 'weapon-optimized-'))
  try {
    await mkdir(path.join(staging, 'textures'))
    await mkdir(path.join(staging, 'skins'))
    await mkdir(path.join(staging, 'skin-audits'))
    const preparedSkins = await timing.measure('prepare-skins', async () => {
      const skins = []
      for (const input of recipe.skins) {
        assert.match(input.skinId, /^[\w-]+$/)
        let bytes
        let proof
        if (input.baseSkinId) {
          assert.ok(manifest.skins[input.baseSkinId], 'Missing base skin')
          const descriptor = path.resolve(base, manifest.skins[input.baseSkinId].url)
          const skin = JSON.parse(await readFile(descriptor, 'utf8'))
          const original = await readFile(path.resolve(path.dirname(descriptor), skin.materials.weapon.map.url))
          assert.equal(sha256(original), input.sourceTextureSha256, 'Source skin changed')
          assert.ok(input.crop, 'A UV-layout change cannot silently reuse an old skin map')
          const cropped = cropGunAtlas(original, input.crop)
          bytes = cropped.bytes
          proof = {
            type: 'lossless-atlas-crop',
            baseSkinId: input.baseSkinId,
            sourceSha256: sha256(original),
            sourceSize: cropped.sourceSize,
            rect: cropped.rect,
            padding: cropped.padding,
          }
        }
        else {
          bytes = await readFile(path.resolve(project, input.texture))
          if (!preview)
            assert.equal(sha256(bytes), input.sha256, 'Authored skin changed')
          assert.deepEqual(pngSize(bytes), { width: input.size[0], height: input.size[1] })
          proof = {
            type: 'authored-cropped-texture',
            source: input.texture,
            sourceSha256: sha256(bytes),
          }
        }
        const image = decodeAtlas(bytes)
        assert.deepEqual([image.width, image.height], recipe.geometrySource.textureSize)
        assert.equal(image.rgba[(image.width * image.height - 1) * 4 + 3], 0, 'Legacy flash UV requires a transparent texel')
        const filename = `${sha256(bytes)}.png`
        await writeFile(path.join(staging, 'textures', filename), bytes)
        skins.push({
          skinId: input.skinId,
          bytes,
          filename,
          proof,
        })
      }
      return skins
    })
    const defaultSkin = preparedSkins.find(skin => skin.skinId === recipe.defaultSkinId)
    const request = {
      ...recipes[recipe.weaponId],
      blend: rigBlend,
      scene: recipe.exportScene,
      texture: path.join(staging, 'textures', defaultSkin.filename),
      sourceManifest: path.join(base, 'manifest.json'),
      output: path.join(staging, 'model.glb'),
      report: path.join(staging, 'source-audit.json'),
      optimizedGeometry: { ...recipe.geometrySource, blend: meshBlend, sha256: meshHash },
      timingReport: path.join(staging, 'blender-timings.json'),
    }
    const requestFile = path.join(staging, 'export-request.json')
    await writeFile(requestFile, json(request))
    await timing.measure('blender-export', () => runBlender(blender, requestFile, workRoot))
    const blenderTimings = JSON.parse(await readFile(request.timingReport, 'utf8'))
    await rm(request.timingReport)
    await rm(requestFile) // Machine-local paths do not belong in the published package.
    await timing.measure('source-unchanged', async () => {
      assert.equal(sha256(await readFile(rigBlend)), rigHash, 'Rig changed during export')
      assert.equal(sha256(await readFile(meshBlend)), meshHash, 'Geometry source changed during export')
    })
    const modelBytes = await readFile(request.output)
    const compatibility = compatibilityFor(readGlb(modelBytes))
    const workerAudit = JSON.parse(await readFile(request.report, 'utf8'))
    const audit = { ...workerAudit, rigSourceSha256: workerAudit.sourceSha256, sourceSha256: meshHash }
    await writeFile(request.report, json(audit))
    const next = {
      ...manifest,
      assetVersion: recipe.assetVersion,
      model: resource('model.glb', modelBytes),
      compatibility,
      defaultSkinId: recipe.defaultSkinId,
      skins: {},
      skinning: { maxInfluences: 4 },
      provenance: {
        sourceBlend: recipe.geometrySource.blend,
        sourceBlendSha256: meshHash,
        exportScene: recipe.exportScene,
        authoringScene: recipe.geometrySource.scene,
        blenderVersion: workerAudit.blenderVersion,
        rigSource: { blend: recipe.rigBlend, sha256: rigHash },
        basePackage: {
          assetVersion: manifest.assetVersion,
          manifestSha256: sha256(baseBytes),
          modelSha256: manifest.model.sha256,
        },
        releaseRecipeSha256: sha256(recipeBytes),
        modelDerivation: 'authored-optimized-geometry-and-336-uv-on-verified-authoring-rig',
        ...(preview
          ? { preview: true }
          : {}),
      },
    }
    for (const skin of preparedSkins) {
      const bytes = json({
        schemaVersion: 1,
        weaponId: recipe.weaponId,
        assetVersion: recipe.assetVersion,
        skinId: skin.skinId,
        compatibility,
        materials: {
          weapon: {
            map: {
              ...resource(`../textures/${skin.filename}`, skin.bytes),
              ...pngSize(skin.bytes),
              colorSpace: 'srgb',
              flipY: false,
              magFilter: 'nearest',
              minFilter: 'nearest',
              generateMipmaps: false,
            },
          },
        },
      })
      await writeFile(path.join(staging, 'skins', `${skin.skinId}.json`), bytes)
      next.skins[skin.skinId] = resource(`skins/${skin.skinId}.json`, bytes)
      await writeFile(path.join(staging, 'skin-audits', `${skin.skinId}.json`), json({
        ...skin.proof,
        outputSha256: sha256(skin.bytes),
        compatibility,
      }))
    }
    await writeFile(path.join(staging, 'manifest.json'), json(next))
    const report = await timing.measure(preview ? 'preview-validation' : 'release-validation', () => preview
      ? validateWeaponIteration(staging)
      : validateWeaponPackage(staging, { validator, poseSamples: audit.poseSamples }))
    const stats = {
      previous: meshStatistics(readGlb(await readFile(path.join(base, manifest.model.url)))),
      current: meshStatistics(readGlb(modelBytes)),
      source: audit.optimizedGeometry.meshes,
    }
    await writeFile(path.join(staging, 'validation.json'), json({ ...report, meshStatistics: stats }))
    let previewUrl
    if (preview) {
      await mkdir(previewRoot, { recursive: true })
      outsideProject(await realpath(previewRoot))
      const candidate = await mkdtemp(path.join(previewRoot, 'candidate-'))
      target = path.join(candidate, recipe.weaponId, recipe.assetVersion)
      const query = new URLSearchParams({
        candidate: path.basename(candidate),
        weapon: recipe.weaponId,
        version: recipe.assetVersion,
        skin: recipe.defaultSkinId,
      })
      previewUrl = `/weapon-preview.html?${query}`
    }
    await timing.measure(preview ? 'install-candidate' : 'install-release', () => installWeaponPackage(staging, target))
    return {
      ...report,
      assetVersion: recipe.assetVersion,
      defaultSkinId: recipe.defaultSkinId,
      skins: preparedSkins.map(skin => skin.skinId),
      directory: target,
      modelBytes: modelBytes.length,
      meshStatistics: stats,
      blenderTimings,
      ...(preview
        ? {
            profile: 'preview',
            publishable: false,
            previewRoot,
            previewUrl,
          }
        : {}),
    }
  }
  finally {
    assert.equal(path.dirname(path.resolve(staging)), path.resolve(workRoot))
    assert.ok(path.basename(staging).startsWith('weapon-optimized-'))
    await rm(staging, { recursive: true, force: true })
  }
}

async function main(args) {
  assert.ok(args[0] && !args[0].startsWith('--'), 'Pass an explicit optimized-release recipe JSON')
  const options = {
    recipeFile: path.resolve(args[0]),
    blender: process.env.BLENDER_PATH,
    onStage: stage => console.error(`[weapon-workflow] ${stage.name}: ${stage.ms} ms${stage.passed ? '' : ' (failed)'}`),
  }
  let reportFile
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--verify-only') {
      options.verifyOnly = true
    }
    else if (args[i] === '--preview') {
      options.preview = true
    }
    else {
      const key = {
        '--blender': 'blender',
        '--out-root': 'outputRoot',
        '--work-root': 'workRoot',
        '--report': 'report',
      }[args[i]]
      assert.ok(key && args[i + 1] && !args[i + 1].startsWith('--'), `Unknown/missing option: ${args[i]}`)
      const value = args[++i]
      if (key === 'report')
        reportFile = path.resolve(value)
      else options[key] = value
    }
  }
  if (reportFile) {
    const outputRoot = options.outputRoot ?? (options.preview
      ? process.env.WEAPON_PREVIEW_ROOT ?? 'D:/opencode-temp/opencode/weapon-previews'
      : path.join(project, 'public/weapons'))
    for (const root of [
      path.join(project, 'public'),
      path.resolve(outputRoot),
    ]) {
      const relative = path.relative(root, reportFile)
      assert.ok(relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative), 'Keep timing reports outside asset output directories')
    }
  }
  let report
  try {
    report = await publishOptimizedWeapon(options)
    console.log(JSON.stringify(report, null, 2))
  }
  catch (error) {
    report = { passed: false, failure: error.message, timings: error.timings }
    throw error
  }
  finally {
    if (reportFile) {
      await mkdir(path.dirname(reportFile), { recursive: true })
      await writeFile(reportFile, json(report))
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
