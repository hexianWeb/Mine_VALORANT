import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import validator from 'gltf-validator'
import { weaponAudioProfiles } from '../../src/game/weapons/definitions/audio.js'
import { decodeAtlas } from './gun-atlas.mjs'
import { accessorBytes, compatibilityFor, pngSize, readGlb, sha256, validateWeaponPackage } from './package-validation.mjs'
import { defaultPreviewRoot } from './preview-assets.mjs'
import { installWeaponPackage } from './publish.mjs'

const project = fileURLToPath(new URL('../../', import.meta.url))
const [recipeFile, blender, mode] = process.argv.slice(2)
assert.ok(recipeFile && blender && (mode === '--preview' || mode === '--install'), 'Usage: node tools/weapons/publish-bulldog.mjs <pinned-recipe.json> <blender.exe> --preview|--install')
const preview = mode === '--preview'
const recipeBytes = await readFile(recipeFile)
const recipe = JSON.parse(recipeBytes)
assert.equal(recipe.schemaVersion, 1)
assert.equal(recipe.weaponId, 'bulldog')
assert.match(recipe.assetVersion, /^v[1-9]\d*$/u)
assert.equal(recipe.scene, '10_BullDog')
assert.ok(recipe.armFitting === undefined || recipe.armFitting === 'authored-sleeve-stretch')
const depthScale = recipe.viewDepthScale ?? 1
assert.ok(Number.isFinite(depthScale) && depthScale > 0 && depthScale <= 1)
const source = path.resolve(project, recipe.source)
const texture = path.resolve(project, recipe.texture)
const armReference = path.resolve(project, recipe.armReference)
const textureBytes = await readFile(texture)
assert.equal(sha256(await readFile(source)), recipe.sourceSha256)
assert.equal(sha256(textureBytes), recipe.textureSha256)
assert.equal(sha256(await readFile(armReference)), recipe.armReferenceSha256)
assert.deepEqual(pngSize(textureBytes), { width: 256, height: 256 })
decodeAtlas(textureBytes)
const contract = JSON.parse(await readFile(new URL('./arm-contract.json', import.meta.url), 'utf8'))
const armTexture = await readFile(path.join(project, contract.atlas))
assert.equal(sha256(armTexture), contract.textureSha256)
decodeAtlas(armTexture)
const audioBank = weaponAudioProfiles[recipe.temporaryAudioFrom]
assert.ok(audioBank)
for (const cue of Object.values(audioBank.cues))
  assert.equal(sha256(await readFile(path.join(project, `public${cue.url}`))), cue.sha256)

await mkdir(defaultPreviewRoot, { recursive: true })
const root = await mkdtemp(path.join(defaultPreviewRoot, preview ? 'candidate-bulldog-' : 'release-bulldog-'))
const directory = path.join(root, recipe.weaponId, recipe.assetVersion)
const output = path.join(directory, 'model.glb')
const report = path.join(directory, 'source-audit.json')
const json = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
function descriptor(url, bytes) {
  return {
    url,
    bytes: bytes.length,
    sha256: sha256(bytes),
  }
}
await mkdir(path.join(directory, 'skins'), { recursive: true })
await mkdir(path.join(directory, 'textures'), { recursive: true })
const request = path.join(root, 'export-request.json')
await writeFile(request, json({
  ...recipe,
  source,
  texture,
  armReference,
  output,
  report,
}))
await new Promise((resolve, reject) => {
  const child = spawn(blender, [
    '--background',
    '--factory-startup',
    '--disable-autoexec',
    '--python-exit-code',
    '1',
    '--python',
    path.join(project, 'tools/weapons/export_bulldog.py'),
    '--',
    request,
  ], {
    stdio: 'inherit',
    windowsHide: true,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  })
  child.once('error', reject)
  child.once('exit', (code) => {
    if (code === 0)
      resolve()
    else
      reject(new Error(`Bulldog Blender export exited ${code}`))
  })
})
assert.equal(sha256(await readFile(source)), recipe.sourceSha256)
assert.equal(sha256(await readFile(texture)), recipe.textureSha256)
assert.equal(sha256(await readFile(armReference)), recipe.armReferenceSha256)
const audit = JSON.parse(await readFile(report, 'utf8'))
assert.equal(audit.sourceSha256, recipe.sourceSha256)
assert.equal(audit.textureSha256, recipe.textureSha256)
assert.equal(audit.armReferenceSha256, recipe.armReferenceSha256)
assert.equal(audit.poseSamples.length, 9)
if (recipe.armFitting) {
  for (const side of ['Left', 'Right']) {
    const fit = audit.armFitting[`Arms_${side}`]
    assert.equal(fit.palmBone, `${side.toLowerCase()}_wrist`)
    assert.equal(fit.cuffBone, `${side.toLowerCase()}_sleeve`)
    const lengths = fit.lengthSamples.map(sample => sample.length)
    assert.equal(lengths.length, audit.poseSamples.length)
    assert.ok(Math.max(...lengths) - Math.min(...lengths) > 0.05, `Missing ${side} sleeve deformation`)
  }
}
const model = await readFile(output)
const glb = readGlb(model)
const { doc, binary } = glb
const meshes = [
  'Weapon_Body',
  'Weapon_Magazine',
  'Arms_Left',
  'Arms_Right',
]
assert.deepEqual(Object.keys(audit.partitionTriangles), meshes)
const hashes = doc.images.map((image) => {
  const { byteOffset = 0, byteLength } = doc.bufferViews[image.bufferView]
  return sha256(binary.subarray(byteOffset, byteOffset + byteLength))
})
assert.deepEqual(new Set(hashes), new Set([recipe.textureSha256, contract.textureSha256]))
for (const clip of doc.animations.filter(a => ['reload_empty', 'reload_tactical'].includes(a.name))) {
  const stepBones = clip.channels
    .filter(channel => channel.target.path === 'scale' && clip.samplers[channel.sampler].interpolation === 'STEP')
    .map(channel => doc.nodes[channel.target.node].name)
  assert.ok(['magazine', 'magazine_incoming', 'magazine_outgoing'].every(name => stepBones.includes(name)), clip.name)
}
for (const [name, frames] of Object.entries(recipe.clipFrames ?? {}))
  assert.equal(audit.clips.find(clip => clip.name === name)?.duration, frames / 60)
if (recipe.drawCharge || recipe.authoredDrawFrames) {
  const draw = doc.animations.find(clip => clip.name === 'draw')
  const handle = draw?.channels.find(c => c.target.path === 'translation' && doc.nodes[c.target.node].name === 'charging_handle')
  assert.ok(handle, 'Draw must animate the charging handle')
  const sampler = draw.samplers[handle.sampler]
  const values = accessorBytes(glb, sampler.output)
  const count = doc.accessors[sampler.input].count
  // Cubic keys store in-tangent, value, out-tangent. Only positions measure travel.
  const offset = i => sampler.interpolation === 'CUBICSPLINE'
    ? i * 36 + 12
    : i * 12
  const start = [0, 4, 8].map(axis => values.readFloatLE(offset(0) + axis))
  const travel = Array.from({ length: count }, (_, i) => Math.hypot(...start.map((v, axis) => v - values.readFloatLE(offset(i) + axis * 4))))
  assert.ok(Math.max(...travel) > 0.05, 'Draw charge has no visible travel')
  assert.ok(travel.at(-1) < 1e-4, 'Draw charge does not return to rest')
  if (recipe.authoredDrawFrames)
    assert.equal(audit.clips.find(clip => clip.name === 'draw')?.duration, recipe.authoredDrawFrames / 60)
}
const compatibility = compatibilityFor(glb)
const skinId = 'original'
const textureName = `${recipe.textureSha256}.png`
const skin = json({
  schemaVersion: 1,
  weaponId: recipe.weaponId,
  assetVersion: recipe.assetVersion,
  skinId,
  compatibility,
  materials: {
    weapon: {
      map: {
        ...descriptor(`../textures/${textureName}`, textureBytes),
        ...pngSize(textureBytes),
        colorSpace: 'srgb',
        flipY: false,
        magFilter: 'nearest',
        minFilter: 'nearest',
        generateMipmaps: false,
      },
    },
  },
})
const verticalFov = audit.view.cameraFov
const aimVerticalFov = 2 * Math.atan(Math.tan(verticalFov * Math.PI / 360) / recipe.adsZoom) * 180 / Math.PI
const [mountX, mountY, mountZ] = audit.view.mountOffset
const manifest = {
  schemaVersion: 1,
  weaponId: recipe.weaponId,
  assetVersion: recipe.assetVersion,
  defaultSkinId: skinId,
  model: descriptor('model.glb', model),
  compatibility,
  view: {
    unitsPerMeter: 1,
    up: 'Y',
    forward: '-Z',
    mountOffset: [mountX, mountY, mountZ * depthScale],
    verticalFov,
    aimVerticalFov,
    source: depthScale === 1
      ? '10_BullDog Camera_FP'
      : '10_BullDog Camera_FP with runtime view depth adjustment',
  },
  meshes,
  armContract: { version: contract.version, textureSha256: contract.textureSha256 },
  materials: {
    weapon: ['Weapon_Skin'],
    armsLeft: ['Character_Left'],
    armsRight: ['Character_Right'],
  },
  sockets: { muzzle: 'muzzle_tip', sight: 'sight_line' },
  clips: audit.clips,
  actions: recipe.actions,
  requiredActions: Object.keys(recipe.actions),
  skins: {
    [skinId]: descriptor(`skins/${skinId}.json`, skin),
  },
  provenance: {
    ...(preview
      ? { preview: true }
      : {}),
    authoring: { format: 'Blender from Blockbench', scene: recipe.scene, sha256: recipe.sourceSha256 },
    armReferenceSha256: recipe.armReferenceSha256,
    ...(recipe.armFitting
      ? { armFitting: recipe.armFitting }
      : {}),
    ...(recipe.viewDepthScale === undefined
      ? {}
      : { viewDepthScale: depthScale }),
    temporaryAudioFrom: recipe.temporaryAudioFrom,
    recipeSha256: sha256(recipeBytes),
  },
}
await writeFile(path.join(directory, `skins/${skinId}.json`), skin)
await writeFile(path.join(directory, `textures/${textureName}`), textureBytes)
await writeFile(path.join(directory, 'release-recipe.json'), recipeBytes)
await writeFile(path.join(directory, 'manifest.json'), json(manifest))
const result = await validateWeaponPackage(directory, {
  validator,
  poseSamples: audit.poseSamples,
  profile: preview ? 'preview' : 'release',
})
await writeFile(path.join(directory, 'validation.json'), json(result))
const target = path.join(project, 'public/weapons', recipe.weaponId, recipe.assetVersion)
if (preview) {
  result.directory = directory
  result.previewUrl = `/weapon-preview.html?candidate=${path.basename(root)}&weapon=${recipe.weaponId}&version=${recipe.assetVersion}&skin=${skinId}`
}
else {
  await installWeaponPackage(directory, target)
  result.directory = target
}
console.log(JSON.stringify(result, null, 2))
