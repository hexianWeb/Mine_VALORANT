import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { validateManifest } from '../src/world/manifest.js'

export function validateRoomFiles(manifestPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  validateManifest(manifest)
  const assets = [manifest.model, ...manifest.atlases]
  let bytes = 0
  for (const asset of assets) {
    const file = fileURLToPath(new URL(asset.url, pathToFileURL(path.resolve(manifestPath))))
    const buffer = fs.readFileSync(file)
    const hash = createHash('sha256').update(buffer).digest('hex')
    if (hash !== asset.sha256)
      throw new Error(`${asset.id ?? 'model'}: SHA-256 mismatch`)
    bytes += buffer.length
  }
  const modelPath = fileURLToPath(new URL(manifest.model.url, pathToFileURL(path.resolve(manifestPath))))
  const model = fs.readFileSync(modelPath)
  if (model.readUInt32LE(0) !== 0x46546C67 || model.readUInt32LE(4) !== 2 || model.readUInt32LE(8) !== model.length)
    throw new Error('Invalid GLB header')
  const gltf = JSON.parse(model.subarray(20, 20 + model.readUInt32LE(12)).toString())
  let triangles = 0
  const counts = { 'baked-appearance': 0, 'realtime': 0, 'fixture-emissive': 0 }
  const nodeKeys = new Set(gltf.nodes.filter(n => n.mesh !== undefined).map(n => `${n.extras?.rangeRoomId}/${n.mesh}`))
  for (const binding of manifest.bindings) {
    const primitive = gltf.meshes[binding.meshIndex]?.primitives[binding.primitiveIndex]
    if (!nodeKeys.has(`${binding.receiverId}/${binding.meshIndex}`) || !primitive || primitive.material !== binding.materialIndex)
      throw new Error(`Missing or stale GLB binding ${binding.receiverId}`)
    if (binding.mode === 'baked-appearance' && primitive.attributes[`TEXCOORD_${binding.uvChannel}`] === undefined)
      throw new Error(`Missing atlas UV ${binding.receiverId}`)
    counts[binding.mode]++
    triangles += gltf.accessors[primitive.indices ?? primitive.attributes.POSITION].count / 3
  }
  const primitiveCount = gltf.nodes.filter(n => n.mesh !== undefined).reduce((sum, node) => sum + gltf.meshes[node.mesh].primitives.length, 0)
  if (primitiveCount !== manifest.bindings.length)
    throw new Error('Unclassified GLB primitives')
  const alphaModes = {}
  for (const material of gltf.materials) {
    const mode = material.alphaMode ?? 'OPAQUE'
    alphaModes[mode] = (alphaModes[mode] ?? 0) + 1
  }
  return {
    valid: true,
    modelBytes: model.length,
    assetBytes: bytes,
    meshNodes: nodeKeys.size,
    primitives: primitiveCount,
    triangles,
    atlases: manifest.atlases.length,
    counts,
    alphaModes,
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = validateRoomFiles(process.argv[2] ?? 'public/lighting/range-room/manifest.json')
  console.log(JSON.stringify(report, null, 2))
}
