import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { decodeAtlas } from './gun-atlas.mjs'
import { inspectWeaponPackage, sha256, validateWeaponModel } from './package-validation.mjs'
import { createWorkflowTiming } from './workflow-timing.mjs'

const toolchainFiles = [
  './iteration-validation.mjs',
  './package-validation.mjs',
  './gun-atlas.mjs',
  './arm-contract.json',
  './export_blender.py',
  './optimized_geometry.py',
  './arm_contract.py',
  '../../src/game/weapons/assets/weapon-materials.js',
  '../../package.json',
  '../../package-lock.json',
  '../../node_modules/three/package.json',
]

export async function iterationToolchainFingerprint(files = toolchainFiles.map(file => new URL(file, import.meta.url))) {
  const hashes = await Promise.all(files.map(async file => sha256(await readFile(file))))
  return sha256(JSON.stringify({ node: process.version, hashes }))
}

/** Only external skins/version/provenance may change without invalidating model checks. */
export function iterationModelKey(manifest, poseSamples, toolchain) {
  const modelInputs = { ...manifest }
  for (const key of [
    'skins',
    'defaultSkinId',
    'assetVersion',
    'provenance',
  ])
    delete modelInputs[key]
  return sha256(JSON.stringify({
    schemaVersion: 1,
    profile: 'preview',
    toolchain,
    modelInputs,
    poseSamples,
  }))
}

async function readCache(file, key) {
  try {
    const cached = JSON.parse(await readFile(file, 'utf8'))
    if (cached.schemaVersion === 1 && cached.key === key && cached.report?.profile === 'preview'
      && cached.report.publishable === false && cached.reportSha256 === sha256(JSON.stringify(cached.report))) {
      return cached.report
    }
  }
  catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError))
      throw error
  }
  return null
}

async function writeCache(file, key, report) {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify({
      schemaVersion: 1,
      key,
      report,
      reportSha256: sha256(JSON.stringify(report)),
    }), { flag: 'wx' })
    await rename(temporary, file)
  }
  finally {
    await rm(temporary, { force: true })
  }
}

/** No Blender and no browser. Fresh hashes/PNG decoding always run; only model work is cached. */
export async function validateWeaponIteration(directory, {
  cacheRoot = 'D:/opencode-temp/opencode/weapon-validation-cache',
  cache = true,
  onStage,
} = {}) {
  const timing = createWorkflowTiming(onStage)
  try {
    const inspection = await timing.measure('resources-and-bindings', () => inspectWeaponPackage(directory))
    await timing.measure('decode-png', () => {
      const images = [...inspection.textures]
      for (const image of inspection.glb.doc.images) {
        const view = inspection.glb.doc.bufferViews[image.bufferView]
        images.push(inspection.glb.binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength))
      }
      const decoded = new Set()
      for (const bytes of images) {
        const hash = sha256(bytes)
        if (!decoded.has(hash)) {
          decodeAtlas(bytes)
          decoded.add(hash)
        }
      }
    })
    const audit = JSON.parse(await readFile(path.join(directory, 'source-audit.json'), 'utf8'))
    const poseSamples = audit.poseSamples ?? []
    const toolchain = await timing.measure('toolchain-fingerprint', () => iterationToolchainFingerprint())
    const key = iterationModelKey(inspection.manifest, poseSamples, toolchain)
    const file = path.join(cacheRoot, `${key}.json`)
    let report = cache
      ? await timing.measure('model-cache-read', () => readCache(file, key))
      : null
    const hit = report !== null
    if (!hit) {
      report = await timing.measure('model-preview-checks', () => validateWeaponModel(inspection, { profile: 'preview', poseSamples }))
      if (cache)
        await timing.measure('model-cache-write', () => writeCache(file, key, report))
    }
    return {
      ...report,
      modelCache: { hit, key },
      timings: timing.snapshot(),
    }
  }
  catch (error) {
    error.timings = timing.snapshot()
    throw error
  }
}
