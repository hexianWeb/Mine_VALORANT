import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import validator from 'gltf-validator'
import { accessorBytes, compatibilityFor, pngSize, readGlb, sha256, validateWeaponPackage } from './package-validation.mjs'
import { installWeaponPackage } from './publish.mjs'

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const json = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
function resource(url, bytes) {
  return {
    url,
    sha256: sha256(bytes),
    bytes: bytes.length,
  }
}

/** Authored metadata is a separate, explicitly pinned source contract, never a promoted preview. */
export async function readPinnedAuthoring(reference, root = project) {
  assert.ok(reference && typeof reference.path === 'string', 'Missing pinned input path')
  assert.match(reference.sha256, /^[a-f0-9]{64}$/, 'Missing pinned input SHA-256')
  const filename = path.resolve(root, reference.path)
  const relative = path.relative(root, filename)
  assert.ok(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), 'Input escapes project')
  const bytes = await readFile(filename)
  assert.equal(sha256(bytes), reference.sha256, `Pinned input changed: ${reference.path}`)
  return { filename, bytes }
}

/** Older pinned authoring defaults to 2048; smaller originals must declare their exact size. */
export function validateAuthoredTexture(bytes, skin) {
  assert.deepEqual(pngSize(bytes), skin.textureSize ?? { width: 2048, height: 2048 })
}

/** Resolve authored thresholds onto the actual normalized GLB Float32 key times (STEP-safe). */
export function authoredControlProfile(metadata, glb) {
  if (metadata.runtimeControls === undefined) {
    assert.equal(metadata.ammoDisplay, undefined, 'Ammo display requires declared controls')
    return {}
  }
  const runtimeControls = structuredClone(metadata.runtimeControls)
  if (!metadata.ammoDisplay)
    return { runtimeControls }
  const ammoDisplay = structuredClone(metadata.ammoDisplay)
  const control = runtimeControls[ammoDisplay.control]
  assert.ok(control && Array.isArray(control.tracks), 'Missing ammo control whitelist')
  const animation = glb.doc.animations.find(animation => animation.name === control.clip)
  assert.ok(animation, `Missing control clip: ${control.clip}`)
  const times = []
  for (const channel of animation.channels) {
    const node = glb.doc.nodes[channel.target.node]
    if (channel.target.path !== 'scale' || !control.tracks.includes(`${node.name}.scale`))
      continue
    const index = animation.samplers[channel.sampler].input
    const accessor = glb.doc.accessors[index]
    assert.equal(accessor.type, 'SCALAR')
    assert.equal(accessor.componentType, 5126)
    const bytes = accessorBytes(glb, index)
    for (let index = 0; index < accessor.count; index++)
      times.push(bytes.readFloatLE(index * 4))
  }
  assert.ok(times.length, 'No authored ammo control key times')
  for (const level of ammoDisplay.levels) {
    const nearest = times.reduce((best, time) => Math.abs(time - level.time) < Math.abs(best - level.time)
      ? time
      : best)
    assert.ok(Number.isFinite(level.time) && Math.abs(nearest - level.time) < 1e-6, 'Ammo level is not an authored control boundary')
    level.time = nearest
  }
  return { runtimeControls, ammoDisplay }
}

export async function publishAuthoredWeapon({
  recipeFile,
  blender,
  outputRoot = path.join(project, 'public/weapons'),
  workRoot = 'D:/opencode-temp/opencode',
}) {
  assert.ok(blender, 'Pass an explicit background Blender executable')
  const started = performance.now()
  const recipeBytes = await readFile(recipeFile)
  const recipe = JSON.parse(recipeBytes)
  assert.equal(recipe.schemaVersion, 1)
  assert.equal(recipe.sourceContract, 'blender-actions-with-temporary-public-runtime')
  for (const key of ['weaponId', 'assetVersion'])
    assert.match(recipe[key], /^[\w-]+$/, `Invalid ${key}`)
  const metadataInput = await readPinnedAuthoring(recipe.authoring)
  const runtimeInput = await readPinnedAuthoring(recipe.runtimeProfile)
  const metadata = JSON.parse(metadataInput.bytes)
  const runtime = JSON.parse(runtimeInput.bytes)
  assert.equal(metadata.weaponId, recipe.weaponId)
  assert.equal(runtime.definition.id, recipe.weaponId)
  assert.equal(runtime.definition.assets.assetVersion, recipe.assetVersion)
  assert.equal(runtime.provenance.status, 'temporary-public-reference')
  assert.equal(runtime.originalRuntimeManifestAvailable, false)
  assert.ok(!metadata.provenance?.preview && !metadata.model, 'Use authoring facts, not a preview model/manifest')
  const base = metadata.skins[recipe.defaultSkinId]
  assert.ok(base, 'Missing default authoring skin')
  assert.deepEqual(Object.keys(metadata.skins), runtime.definition.assets.skinIds)
  const inputs = new Map()
  const textures = new Map()
  for (const [skinId, skin] of Object.entries(metadata.skins)) {
    inputs.set(skin.source.path, await readPinnedAuthoring(skin.source))
    const texture = await readPinnedAuthoring(skin.texture)
    validateAuthoredTexture(texture.bytes, skin)
    textures.set(skinId, texture)
    for (const key of ['geometryUV', 'rig', 'clipSet'])
      assert.equal(skin.authoringSignature[key], base.authoringSignature[key], `Incompatible ${skinId}: ${key}`)
  }
  for (const cue of Object.values(runtime.audio.cues)) {
    assert.ok(cue.url.startsWith('/audio/'), 'Expected explicit public audio input')
    await readPinnedAuthoring({ path: `public${cue.url}`, sha256: cue.sha256 })
  }
  await mkdir(workRoot, { recursive: true })
  const staging = await mkdtemp(path.join(workRoot, 'weapon-authored-'))
  try {
    for (const folder of ['skins', 'textures'])
      await mkdir(path.join(staging, folder))
    const metadataFile = path.join(staging, 'authoring-metadata.json')
    await writeFile(metadataFile, metadataInput.bytes)
    const request = {
      blend: inputs.get(base.source.path).filename,
      texture: textures.get(recipe.defaultSkinId).filename,
      sourceManifest: metadataFile,
      scene: recipe.scene,
      meshes: recipe.meshes,
      armatures: recipe.armatures,
      clipCount: metadata.clips.length,
      output: path.join(staging, 'model.glb'),
      report: path.join(staging, 'source-audit.json'),
    }
    if (recipe.authoringAdapter)
      request.authoringAdapter = recipe.authoringAdapter
    const requestFile = path.join(staging, 'export-request.json')
    await writeFile(requestFile, json(request))
    const exportStarted = performance.now()
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
        requestFile,
      ], { windowsHide: true, stdio: 'inherit' })
      child.once('error', reject)
      child.once('exit', code => code === 0
        ? resolve()
        : reject(new Error(`Blender exited ${code}`)))
    })
    const blenderMs = performance.now() - exportStarted
    for (const [sourcePath, input] of inputs)
      assert.equal(sha256(await readFile(input.filename)), sha256(input.bytes), `Source changed during export: ${sourcePath}`)
    const audit = JSON.parse(await readFile(request.report, 'utf8'))
    assert.equal(audit.sourceSha256, base.source.sha256)
    assert.equal(audit.textureSha256, base.texture.sha256)
    const bytes = await readFile(request.output)
    const glb = readGlb(bytes)
    const compatibility = compatibilityFor(glb)
    const controlProfile = authoredControlProfile(metadata, glb)
    const skins = {}
    for (const [skinId, texture] of textures) {
      const textureName = `${sha256(texture.bytes)}.png`
      await writeFile(path.join(staging, 'textures', textureName), texture.bytes)
      const skinBytes = json({
        schemaVersion: 1,
        weaponId: recipe.weaponId,
        assetVersion: recipe.assetVersion,
        skinId,
        compatibility,
        materials: {
          weapon: {
            map: {
              ...resource(`../textures/${textureName}`, texture.bytes),
              ...pngSize(texture.bytes),
              colorSpace: 'srgb',
              flipY: false,
              magFilter: 'nearest',
              minFilter: 'nearest',
              generateMipmaps: false,
            },
          },
        },
      })
      await writeFile(path.join(staging, 'skins', `${skinId}.json`), skinBytes)
      skins[skinId] = resource(`skins/${skinId}.json`, skinBytes)
    }
    const contract = JSON.parse(await readFile(path.join(project, 'tools/weapons/arm-contract.json'), 'utf8'))
    await writeFile(path.join(staging, 'runtime-profile.json'), runtimeInput.bytes)
    await writeFile(path.join(staging, 'release-recipe.json'), recipeBytes)
    await rm(requestFile)
    const manifest = {
      schemaVersion: 1,
      weaponId: recipe.weaponId,
      assetVersion: recipe.assetVersion,
      model: resource('model.glb', bytes),
      compatibility,
      armContract: { version: contract.version, textureSha256: contract.textureSha256 },
      clips: metadata.clips,
      actions: recipe.actions,
      requiredActions: recipe.requiredActions,
      materials: recipe.materials,
      meshes: recipe.meshes,
      sockets: recipe.sockets,
      defaultSkinId: recipe.defaultSkinId,
      skins,
      view: metadata.view,
      ...controlProfile,
      runtimeProfile: resource('runtime-profile.json', runtimeInput.bytes),
      provenance: {
        kind: recipe.sourceContract,
        sourceBlend: base.source.path,
        sourceBlendSha256: audit.sourceSha256,
        sourceTextureSha256: audit.textureSha256,
        authoringMetadataSha256: recipe.authoring.sha256,
        runtimeProfileSha256: recipe.runtimeProfile.sha256,
        releaseRecipeSha256: sha256(recipeBytes),
        originalRuntimeManifestAvailable: false,
        gameplayParameters: 'temporary-public-reference',
        exportScene: recipe.scene,
        blenderVersion: audit.blenderVersion,
      },
    }
    await writeFile(path.join(staging, 'manifest.json'), json(manifest))
    const report = await validateWeaponPackage(staging, { validator, poseSamples: audit.poseSamples })
    await writeFile(path.join(staging, 'validation.json'), json(report))
    const target = path.join(path.resolve(outputRoot), recipe.weaponId, recipe.assetVersion)
    await installWeaponPackage(staging, target)
    return {
      ...report,
      directory: target,
      timings: { blenderMs, totalMs: performance.now() - started },
    }
  }
  finally {
    assert.equal(path.dirname(staging), path.resolve(workRoot))
    assert.ok(path.basename(staging).startsWith('weapon-authored-'))
    await rm(staging, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [recipeFile, blender] = process.argv.slice(2)
  publishAuthoredWeapon({ recipeFile, blender }).then(report => console.log(JSON.stringify(report, null, 2))).catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
