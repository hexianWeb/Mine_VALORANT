import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import validator from 'gltf-validator'
import { accessorBytes, compatibilityFor, readGlb, sha256, validateArmContract, validateWeaponPackage } from './package-validation.mjs'
import { installWeaponPackage } from './publish.mjs'

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const releases = {
  classic: { from: 'v2', to: 'v3', model: '51781534ff3fbfc3a469a97183bc937c1274b6397d28f6c218b627f91fb3fcc8' },
  phantom: { from: 'v1', to: 'v2', model: '5b4d94dfc68a9cb238167dd9eef1e06c15a3d93c0d0f3de8a78102f923bd1494' },
}
const json = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
function resource(url, bytes) {
  return {
    url,
    sha256: sha256(bytes),
    bytes: bytes.length,
  }
}

/** Rewrite only arm UV bytes and the two arm PNGs in a pinned, previously validated GLB. */
export function remapArms(bytes, atlas, contract, expectedModelSha256) {
  assert.equal(sha256(bytes), expectedModelSha256, 'Unexpected base GLB: no unverified arm remapping')
  assert.equal(sha256(atlas), contract.textureSha256, 'Unexpected arm atlas')
  const { doc, binary: original } = readGlb(bytes)
  const binary = Buffer.from(original)
  assert.equal(doc.buffers.length, 1)
  assert.ok(!doc.extensionsUsed?.length, 'Unsupported GLB extensions')
  const imageIndices = []
  const textureIndices = []
  for (const side of ['Left', 'Right']) {
    const mesh = doc.meshes.find(item => item.name === `Arms_${side}`)
    assert.ok(mesh && mesh.primitives.length === 1, `Missing arm mesh: ${side}`)
    const primitive = mesh.primitives[0]
    assert.equal(doc.materials[primitive.material]?.name, `Character_${side}`)
    const index = doc.accessors[primitive.indices]
    assert.equal(index.componentType, 5123)
    const indices = accessorBytes({ doc, binary }, primitive.indices)
    assert.deepEqual(contract.indices, contract.indices.map((_, i) => indices.readUInt16LE(i * 2)), `Unexpected arm topology: ${side}`)
    const uvIndex = primitive.attributes.TEXCOORD_0
    const uv = doc.accessors[uvIndex]
    assert.ok(uv.type === 'VEC2' && uv.componentType === 5126 && uv.count === contract.sides[side].length && !uv.sparse)
    assert.equal(doc.accessors.filter(accessor => accessor.bufferView === uv.bufferView).length, 1, 'Arm UV buffer is shared')
    const view = doc.bufferViews[uv.bufferView]
    const offset = (view.byteOffset ?? 0) + (uv.byteOffset ?? 0)
    const stride = view.byteStride ?? 8
    for (const [i, coordinates] of contract.sides[side].entries()) {
      binary.writeFloatLE(coordinates[0], offset + stride * i)
      binary.writeFloatLE(1 - coordinates[1], offset + stride * i + 4)
    }
    if (uv.min || uv.max) {
      const values = contract.sides[side].map(([u, v]) => [u, 1 - v])
      uv.min = [0, 1].map(axis => Math.min(...values.map(value => value[axis])))
      uv.max = [0, 1].map(axis => Math.max(...values.map(value => value[axis])))
    }
    const textureIndex = doc.materials[primitive.material].pbrMetallicRoughness?.baseColorTexture?.index
    assert.ok(Number.isInteger(textureIndex))
    const texture = doc.textures[textureIndex]
    assert.ok(texture && Number.isInteger(texture.source))
    imageIndices.push(texture.source)
    textureIndices.push(textureIndex)
  }
  assert.equal(doc.textures[textureIndices[0]].sampler, doc.textures[textureIndices[1]].sampler, 'Arm samplers differ')
  const [keptImage, removedImage] = imageIndices
  assert.notEqual(keptImage, removedImage, 'Expected two source arm images')
  for (const [index, texture] of doc.textures.entries()) {
    if (imageIndices.includes(texture.source))
      assert.ok(textureIndices.includes(index), 'An arm image is used by another texture')
  }
  const oldImages = doc.images
  const keptView = oldImages[keptImage].bufferView
  const removedView = oldImages[removedImage].bufferView
  assert.notEqual(keptView, removedView)
  assert.ok(!doc.accessors.some(accessor => accessor.bufferView === keptView || accessor.bufferView === removedView))
  assert.ok(oldImages.every((image, index) => index === removedImage || image.bufferView !== removedView))
  doc.textures[textureIndices[1]].source = keptImage
  const imageMap = new Map()
  doc.images = oldImages.filter((_, index) => index !== removedImage)
  oldImages.forEach((_, index) => {
    if (index !== removedImage)
      imageMap.set(index, imageMap.size)
  })
  for (const texture of doc.textures) texture.source = imageMap.get(texture.source)
  doc.images[imageMap.get(keptImage)].name = 'Character_Arms_32'

  const usedViews = new Set([
    ...doc.accessors.filter(accessor => accessor.bufferView !== undefined).map(accessor => accessor.bufferView),
    ...oldImages.map(image => image.bufferView),
  ])
  assert.equal(usedViews.size, doc.bufferViews.length, 'Unexpected GLB buffer-view references')
  const viewMap = new Map()
  const chunks = []
  const views = []
  let length = 0
  for (const [index, oldView] of doc.bufferViews.entries()) {
    if (index === removedView)
      continue
    const padding = (4 - (length % 4)) % 4
    if (padding)
      chunks.push(Buffer.alloc(padding))
    length += padding
    const start = oldView.byteOffset ?? 0
    const data = index === keptView
      ? atlas
      : binary.subarray(start, start + oldView.byteLength)
    viewMap.set(index, views.length)
    views.push({ ...oldView, byteOffset: length, byteLength: data.length })
    chunks.push(data)
    length += data.length
  }
  for (const accessor of doc.accessors) {
    if (accessor.bufferView !== undefined)
      accessor.bufferView = viewMap.get(accessor.bufferView)
  }
  for (const image of doc.images) image.bufferView = viewMap.get(image.bufferView)
  doc.bufferViews = views
  const padding = (4 - (length % 4)) % 4
  if (padding)
    chunks.push(Buffer.alloc(padding))
  const packed = Buffer.concat(chunks)
  doc.buffers = [
    { byteLength: packed.length },
  ]
  const encoded = Buffer.from(JSON.stringify(doc))
  const jsonPadding = (4 - (encoded.length % 4)) % 4
  const header = Buffer.alloc(20)
  header.writeUInt32LE(0x46546C67, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(28 + encoded.length + jsonPadding + packed.length, 8)
  header.writeUInt32LE(encoded.length + jsonPadding, 12)
  header.writeUInt32LE(0x4E4F534A, 16)
  const binaryHeader = Buffer.alloc(8)
  binaryHeader.writeUInt32LE(packed.length, 0)
  binaryHeader.writeUInt32LE(0x004E4942, 4)
  const output = Buffer.concat([
    header,
    encoded,
    Buffer.alloc(jsonPadding, 0x20),
    binaryHeader,
    packed,
  ])
  validateArmContract(readGlb(output), { version: contract.version, textureSha256: contract.textureSha256 }, contract)
  return output
}

async function runSkinAudit(blender, manifest, output) {
  assert.ok(blender, 'Pass --blender to audit the Sakura authoring variant')
  const args = [
    '--background',
    '--factory-startup',
    '--disable-autoexec',
    '--python-exit-code',
    '1',
    '--python',
    path.join(project, 'tools/weapons/audit_skin_blender.py'),
    '--',
    '--manifest',
    manifest,
    '--base-blend',
    path.join(project, 'skin_work_folder/classic_skin_work/Classic_Smite_Animated.blend'),
    '--skin-blend',
    path.join(project, 'skin_work_folder/classic_skin_work/Classic_Sakura_Animated.blend'),
    '--texture',
    path.join(project, 'skin_work_folder/classic_skin_work/classic_sakura_weapon.png'),
    '--out',
    output,
  ]
  await new Promise((resolve, reject) => {
    const child = spawn(blender, args, { windowsHide: true, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', code => code === 0
      ? resolve()
      : reject(new Error(`Skin audit exited ${code}`)))
  })
}

/** Publish immutable derived versions without inventing the unavailable original source-pack metadata. */
export async function publishArmReleases({ blender, outputRoot = path.join(project, 'public/weapons'), workRoot = 'D:/opencode-temp/opencode', weapons = ['classic', 'phantom'] } = {}) {
  assert.equal(new Set(weapons).size, weapons.length, 'Duplicate weapons')
  const contract = JSON.parse(await readFile(path.join(project, 'tools/weapons/arm-contract.json'), 'utf8'))
  const atlas = await readFile(path.join(project, contract.atlas))
  const migration = JSON.parse(await readFile(path.join(project, 'tools/weapons/arm-migration-evidence.json'), 'utf8'))
  await mkdir(workRoot, { recursive: true })
  const staging = await mkdtemp(path.join(workRoot, 'weapon-arms-'))
  const prepared = []
  try {
    for (const weaponId of weapons) {
      const release = releases[weaponId]
      assert.ok(release, `Unknown weapon: ${weaponId}`)
      const base = path.join(project, 'public/weapons', weaponId, release.from)
      const baseManifestBytes = await readFile(path.join(base, 'manifest.json'))
      const manifest = JSON.parse(baseManifestBytes)
      const audit = JSON.parse(await readFile(path.join(base, 'source-audit.json'), 'utf8'))
      await validateWeaponPackage(base, { validator, poseSamples: audit.poseSamples })
      assert.equal(manifest.model.sha256, release.model, 'Unexpected base package')
      const entry = migration.find(item => item.file === manifest.provenance.sourceBlend)
      assert.ok(entry && entry.before === manifest.provenance.sourceBlendSha256, 'Missing source migration evidence')
      assert.equal(entry.after, sha256(await readFile(path.join(project, entry.file))), 'Source changed since arm migration')
      assert.ok(entry.samples.Left > 0 && entry.samples.Right > 0, 'Missing arm texel checks')
      const directory = path.join(staging, weaponId, release.to)
      await mkdir(path.join(directory, 'skins'), { recursive: true })
      await mkdir(path.join(directory, 'textures'), { recursive: true })
      const oldBytes = await readFile(path.join(base, manifest.model.url))
      const modelBytes = remapArms(oldBytes, atlas, contract, release.model)
      const compatibility = compatibilityFor(readGlb(modelBytes))
      assert.equal(compatibility.rig, manifest.compatibility.rig, 'Arm conversion changed the rig')
      assert.equal(compatibility.clipSet, manifest.compatibility.clipSet, 'Arm conversion changed animation bytes')
      const next = {
        ...manifest,
        assetVersion: release.to,
        model: resource('model.glb', modelBytes),
        compatibility,
        armContract: { version: contract.version, textureSha256: contract.textureSha256 },
        skins: {},
        provenance: {
          ...manifest.provenance,
          sourceBlendSha256: entry.after,
          basePackage: {
            assetVersion: release.from,
            manifestSha256: sha256(baseManifestBytes),
            modelSha256: release.model,
          },
          modelDerivation: 'arm-uv-and-atlas-only-from-validated-package',
        },
      }
      await writeFile(path.join(directory, 'model.glb'), modelBytes)
      for (const [skinId, descriptor] of Object.entries(manifest.skins)) {
        const filename = path.join(base, descriptor.url)
        const skin = JSON.parse(await readFile(filename, 'utf8'))
        assert.deepEqual(Object.keys(skin.materials), ['weapon'], 'Unexpected skin material roles')
        const texture = await readFile(path.resolve(path.dirname(filename), skin.materials.weapon.map.url))
        const textureName = `${sha256(texture)}.png`
        await writeFile(path.join(directory, 'textures', textureName), texture)
        const bytes = json({
          ...skin,
          assetVersion: release.to,
          compatibility,
          materials: {
            weapon: {
              map: {
                ...skin.materials.weapon.map,
                ...resource(`../textures/${textureName}`, texture),
              },
            },
          },
        })
        await writeFile(path.join(directory, 'skins', `${skinId}.json`), bytes)
        next.skins[skinId] = resource(`skins/${skinId}.json`, bytes)
      }
      await writeFile(path.join(directory, 'source-audit.json'), json({
        ...audit,
        sourceSha256: entry.after,
        poseSamplesSourceSha256: audit.sourceSha256,
        armMigration: entry,
      }))
      await writeFile(path.join(directory, 'manifest.json'), json(next))
      if (weaponId === 'classic') {
        await mkdir(path.join(directory, 'skin-audits'))
        await runSkinAudit(blender, path.join(directory, 'manifest.json'), path.join(directory, 'skin-audits/sakura.json'))
      }
      const report = await validateWeaponPackage(directory, { validator, poseSamples: audit.poseSamples })
      await writeFile(path.join(directory, 'validation.json'), json(report))
      prepared.push({
        directory,
        weaponId,
        version: release.to,
        report,
      })
    }
    for (const item of prepared)
      await installWeaponPackage(item.directory, path.join(outputRoot, item.weaponId, item.version))
    return prepared.map(({ weaponId, version, report }) => ({ weaponId, version, ...report }))
  }
  finally {
    assert.equal(path.dirname(path.resolve(staging)), path.resolve(workRoot))
    assert.ok(path.basename(staging).startsWith('weapon-arms-'))
    await rm(staging, { recursive: true, force: true })
  }
}

async function main(args) {
  const options = { blender: process.env.BLENDER_PATH, weapons: [] }
  for (let i = 0; i < args.length; i++) {
    const key = args[i]
    if (['--blender', '--out-root', '--work-root'].includes(key)) {
      assert.ok(args[i + 1] && !args[i + 1].startsWith('--'), `Missing value: ${key}`)
      options[{ '--blender': 'blender', '--out-root': 'outputRoot', '--work-root': 'workRoot' }[key]] = args[++i]
    }
    else {
      assert.ok(!key.startsWith('--'), `Unknown option: ${key}`)
      options.weapons.push(key)
    }
  }
  if (!options.weapons.length)
    delete options.weapons
  console.log(JSON.stringify(await publishArmReleases(options), null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
