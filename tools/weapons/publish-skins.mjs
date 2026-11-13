import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import validator from 'gltf-validator'
import { pngSize, sha256, validateWeaponPackage } from './package-validation.mjs'
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

/** A material-only release reuses the validated GLB but publishes a NEW immutable package. */
export async function publishSkinRelease({ baseDirectory, assetVersion, variants = [], outputRoot, workRoot = 'D:/opencode-temp/opencode' }) {
  const base = path.resolve(baseDirectory)
  const manifest = JSON.parse(await readFile(path.join(base, 'manifest.json'), 'utf8'))
  assert.match(manifest.weaponId, /^[\w-]+$/, 'Invalid weaponId')
  assert.match(assetVersion, /^[\w-]+$/, 'Invalid assetVersion')
  assert.notEqual(assetVersion, manifest.assetVersion, 'Skin changes need a new assetVersion')
  const audit = JSON.parse(await readFile(path.join(base, 'source-audit.json'), 'utf8'))
  await validateWeaponPackage(base, { validator, poseSamples: audit.poseSamples })
  await mkdir(workRoot, { recursive: true })
  const staging = await mkdtemp(path.join(workRoot, 'weapon-skins-'))
  try {
    await mkdir(path.join(staging, 'skins'))
    await mkdir(path.join(staging, 'textures'))
    await mkdir(path.join(staging, 'skin-audits'))
    await cp(path.join(base, manifest.model.url), path.join(staging, 'model.glb'))
    await cp(path.join(base, 'source-audit.json'), path.join(staging, 'source-audit.json'))
    const next = {
      ...manifest,
      assetVersion,
      model: { ...manifest.model, url: 'model.glb' },
      skins: {},
      provenance: {
        ...manifest.provenance,
        basePackage: {
          assetVersion: manifest.assetVersion,
          manifestSha256: sha256(await readFile(path.join(base, 'manifest.json'))),
        },
      },
    }
    async function addMap(textureBytes) {
      const textureName = `${sha256(textureBytes)}.png`
      await writeFile(path.join(staging, 'textures', textureName), textureBytes)
      return {
        ...resource(`../textures/${textureName}`, textureBytes),
        ...pngSize(textureBytes),
        colorSpace: 'srgb',
        flipY: false,
        magFilter: 'nearest',
        minFilter: 'nearest',
        generateMipmaps: false,
      }
    }
    async function addSkin(skinId, skin, textureBytes, { emissiveBytes, emissiveIntensity } = {}) {
      assert.match(skinId, /^[\w-]+$/, 'Invalid skinId')
      assert.ok(!Object.hasOwn(next.skins, skinId), `Duplicate skin: ${skinId}`)
      const material = { map: await addMap(textureBytes) }
      if (emissiveBytes)
        material.emissiveMap = await addMap(emissiveBytes)
      if (emissiveIntensity !== undefined)
        material.emissiveIntensity = emissiveIntensity
      const bytes = json({
        ...skin,
        schemaVersion: 1,
        weaponId: manifest.weaponId,
        assetVersion,
        skinId,
        compatibility: manifest.compatibility,
        materials: { weapon: material },
      })
      await writeFile(path.join(staging, 'skins', `${skinId}.json`), bytes)
      next.skins[skinId] = resource(`skins/${skinId}.json`, bytes)
    }
    for (const [skinId, descriptor] of Object.entries(manifest.skins)) {
      const filename = path.resolve(base, descriptor.url)
      const skin = JSON.parse(await readFile(filename, 'utf8'))
      assert.deepEqual(Object.keys(skin.materials), ['weapon'], 'This release recipe supports weapon variants only')
      const material = skin.materials.weapon
      await addSkin(skinId, skin, await readFile(path.resolve(path.dirname(filename), material.map.url)), {
        emissiveBytes: material.emissiveMap
          ? await readFile(path.resolve(path.dirname(filename), material.emissiveMap.url))
          : undefined,
        emissiveIntensity: material.emissiveIntensity,
      })
    }
    for (const variant of variants) {
      const proof = JSON.parse(await readFile(variant.auditFile, 'utf8'))
      const textureBytes = await readFile(variant.texture)
      assert.equal(proof.weaponId, manifest.weaponId, 'Wrong weapon audit')
      assert.equal(proof.base.sourceSha256, manifest.provenance.sourceBlendSha256, 'Wrong authoring base')
      assert.deepEqual(proof.compatibility, manifest.compatibility, 'Wrong published compatibility')
      for (const key of ['rig', 'geometryUV', 'clipSet'])
        assert.equal(proof.base[key], proof.skin[key], `Incompatible authoring variant: ${key}`)
      assert.equal(proof.skin.textureSha256, sha256(textureBytes), 'PNG changed since authoring audit')
      assert.equal(proof.skin.sourceSha256, sha256(await readFile(variant.sourceBlend)), 'Authoring variant changed since audit')
      const emissiveBytes = variant.emissiveMap
        ? await readFile(variant.emissiveMap)
        : undefined
      if (emissiveBytes)
        assert.equal(sha256(emissiveBytes), variant.emissiveMapSha256, 'Emissive PNG changed since release recipe')
      await addSkin(variant.skinId, {}, textureBytes, { emissiveBytes, emissiveIntensity: variant.emissiveIntensity })
      await writeFile(path.join(staging, 'skin-audits', `${variant.skinId}.json`), json({
        ...proof,
        ...(emissiveBytes
          ? {
              emissiveMapSha256: sha256(emissiveBytes),
            }
          : {}),
      }))
    }
    await writeFile(path.join(staging, 'manifest.json'), json(next))
    const report = await validateWeaponPackage(staging, { validator, poseSamples: audit.poseSamples })
    await writeFile(path.join(staging, 'validation.json'), json(report))
    const target = path.join(path.resolve(outputRoot ?? path.dirname(path.dirname(base))), manifest.weaponId, assetVersion)
    await installWeaponPackage(staging, target)
    return {
      ...report,
      assetVersion,
      skins: Object.keys(next.skins),
      directory: target,
    }
  }
  finally {
    assert.equal(path.dirname(path.resolve(staging)), path.resolve(workRoot))
    assert.ok(path.basename(staging).startsWith('weapon-skins-'))
    await rm(staging, { recursive: true, force: true })
  }
}

async function main(args) {
  assert.equal(args.length, 1, 'Pass one explicit release recipe JSON')
  const recipe = JSON.parse(await readFile(path.resolve(args[0]), 'utf8'))
  for (const key of ['baseDirectory', 'outputRoot', 'workRoot']) {
    if (recipe[key])
      recipe[key] = path.resolve(project, recipe[key])
  }
  for (const variant of recipe.variants ?? []) {
    for (const key of ['auditFile', 'texture', 'sourceBlend']) variant[key] = path.resolve(project, variant[key])
    if (variant.emissiveMap)
      variant.emissiveMap = path.resolve(project, variant.emissiveMap)
  }
  console.log(JSON.stringify(await publishSkinRelease(recipe), null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
