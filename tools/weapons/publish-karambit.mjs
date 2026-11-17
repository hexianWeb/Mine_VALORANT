import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import validator from 'gltf-validator'
import { AnimationMixer, Quaternion, Vector3 } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { compatibilityFor, pngSize, readGlb, sha256, validateWeaponPackage } from './package-validation.mjs'
import { installWeaponPackage } from './publish.mjs'

const workspace = fileURLToPath(new URL('../../', import.meta.url))
const [recipePath, authorPath, exportPath, candidate, install] = process.argv.slice(2)
assert.ok(recipePath && authorPath && exportPath && candidate && (install === undefined || install === '--install'), 'Usage: node tools/weapons/publish-karambit.mjs <recipe.json> <bbmodel> <Blockbench GLB> <candidate dir> [--install]')
const recipe = JSON.parse(await readFile(path.resolve(recipePath)))
const dest = path.resolve(candidate)
const releaseRoot = path.join(workspace, 'public', 'weapons')
assert.ok(!dest.startsWith(releaseRoot + path.sep) && dest !== releaseRoot, 'Stage the package outside public/weapons')
const author = await readFile(authorPath)
const source = await readFile(exportPath)
assert.equal(sha256(author), recipe.source.bbmodelSha256)
assert.equal(sha256(source), recipe.source.glbSha256)

const { doc, binary } = readGlb(source)
const scene = doc.scenes[doc.scene]
assert.equal(scene.nodes.length, 1)
const [exportRoot] = scene.nodes
const merged = doc.nodes[exportRoot]
assert.equal(merged.children.length, 1)
assert.equal(doc.meshes.length, 1)
assert.equal(doc.meshes[merged.mesh].primitives.length, 2)

function imageFor(primitive) {
  const textureId = doc.materials[primitive.material].pbrMetallicRoughness.baseColorTexture.index
  const view = doc.bufferViews[doc.images[doc.textures[textureId].source].bufferView]
  const from = view.byteOffset ?? 0
  return binary.subarray(from, from + view.byteLength)
}

// Keep the skeleton's original translation on its own parent. Root skinned mesh nodes
// have identity transforms so glTF and Three agree about which coordinates skinning owns.
const parts = doc.meshes[merged.mesh].primitives
const arm = parts.find(part => pngSize(imageFor(part)).width === 256)
const knife = parts.find(part => pngSize(imageFor(part)).width === 32)
assert.ok(arm && knife, 'Expected the embedded Steve texture and Prime palette')
doc.materials[arm.material].name = 'Character_Right'
doc.materials[knife.material].name = 'Weapon_Skin'
doc.meshes = [
  {
    name: 'Arms_Right',
    primitives: [arm],
  },
  {
    name: 'Weapon_Body',
    primitives: [knife],
  },
]
doc.nodes[exportRoot] = { name: 'Arms_Right', mesh: 0, skin: merged.skin }
const weaponNode = doc.nodes.push({ name: 'Weapon_Body', mesh: 1, skin: merged.skin }) - 1
const basis = { name: 'ViewmodelBasis', translation: merged.translation, children: merged.children }
const basisNode = doc.nodes.push(basis) - 1
scene.nodes = [exportRoot, weaponNode, basisNode]

// A single authored key holds a fixed local offset for the entire action.
for (const clip of doc.animations) {
  for (const sampler of clip.samplers) {
    if (doc.accessors[sampler.input].count === 1)
      sampler.interpolation = 'STEP'
  }
}

function encode() {
  const json = Buffer.from(JSON.stringify(doc))
  const jsonLength = Math.ceil(json.length / 4) * 4
  const header = Buffer.alloc(20 + jsonLength + 8, 0x20)
  header.writeUInt32LE(0x46546C67, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(header.length + binary.length, 8)
  header.writeUInt32LE(jsonLength, 12)
  header.writeUInt32LE(0x4E4F534A, 16)
  json.copy(header, 20)
  header.writeUInt32LE(binary.length, 20 + jsonLength)
  header.writeUInt32LE(0x004E4942, 24 + jsonLength)
  return Buffer.concat([header, binary])
}

async function idleArm(bytes, name, mount = [0, 0, 0]) {
  const model = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')
  model.scene.position.fromArray(mount)
  const clip = model.animations.find(clip => clip.name === name)
  const mixer = new AnimationMixer(model.scene)
  mixer.clipAction(clip).play()
  mixer.update(0)
  model.scene.updateMatrixWorld(true)
  const mesh = model.scene.getObjectByName('Arms_Right')
  const vertices = new Set(mesh.geometry.index.array)
  const points = [...vertices].map(i => mesh.localToWorld(mesh.getVertexPosition(i, new Vector3())))
  const depths = points.map(p => p.z)
  const middle = (Math.min(...depths) + Math.max(...depths)) * 0.5
  const mean = samples => samples.reduce((sum, p) => sum.add(p), new Vector3()).divideScalar(samples.length)
  const wrist = mean(points.filter(p => p.z < middle))
  const cuff = mean(points.filter(p => p.z >= middle))
  return {
    wrist,
    cuff,
    direction: wrist.clone().sub(cuff).normalize(),
  }
}

// Measure the existing runtime idle and the candidate using the same skinned vertices.
globalThis.self = globalThis
globalThis.createImageBitmap = async blob => ({
  ...pngSize(Buffer.from(await blob.arrayBuffer())),
  close() {},
})
globalThis.ProgressEvent ??= class ProgressEvent {
  constructor(type, data) { Object.assign(this, { type, ...data }) }
}
const referenceDir = path.join(workspace, recipe.reference.package)
const classic = await readFile(path.join(referenceDir, 'model.glb'))
assert.equal(sha256(classic), recipe.reference.glbSha256)
const classicManifest = JSON.parse(await readFile(path.join(referenceDir, 'manifest.json')))
const target = await idleArm(classic, classicManifest.actions.idle, classicManifest.view.mountOffset)
const original = await idleArm(encode(), recipe.actions.idle)
assert.ok(original.direction.dot(target.direction) > 0, 'The right arm faces the opposite direction')
const alignment = new Quaternion().setFromUnitVectors(original.direction, target.direction)
basis.rotation = alignment.toArray()
const bytes = encode()
const rotated = await idleArm(bytes, recipe.actions.idle)
const mountOffset = target.wrist.clone().sub(rotated.wrist).toArray()
const placed = await idleArm(bytes, recipe.actions.idle, mountOffset)
assert.ok(placed.wrist.z < -0.005 && placed.wrist.z < placed.cuff.z, 'The wrist must be forward of the camera and cuff')
assert.ok(placed.wrist.distanceTo(target.wrist) < 1e-5)
assert.ok(placed.direction.angleTo(target.direction) < 1e-5)

const { weaponId, assetVersion, defaultSkinId, actions } = recipe
function descriptor(url, bytes) {
  return {
    url,
    bytes: bytes.length,
    sha256: sha256(bytes),
  }
}
const compatibility = compatibilityFor(readGlb(bytes))
const palette = imageFor(knife)
const skinPath = `skins/${defaultSkinId}`
const json = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
const skin = json({
  schemaVersion: 1,
  weaponId,
  assetVersion,
  skinId: defaultSkinId,
  compatibility,
  materials: {
    weapon: {
      map: {
        ...descriptor('palette.png', palette),
        ...pngSize(palette),
        colorSpace: 'srgb',
        flipY: false,
        magFilter: 'nearest',
        minFilter: 'nearest',
        generateMipmaps: false,
      },
    },
  },
})
const manifest = {
  schemaVersion: 1,
  weaponId,
  assetVersion,
  defaultSkinId,
  compatibility,
  model: descriptor('model.glb', bytes),
  view: { ...classicManifest.view, mountOffset },
  meshes: ['Arms_Right', 'Weapon_Body'],
  materials: {
    armsRight: ['Character_Right'],
    weapon: ['Weapon_Skin'],
  },
  sockets: {},
  clips: doc.animations.map(clip => ({
    name: clip.name,
    duration: Math.max(...clip.samplers.map(s => doc.accessors[s.input].max[0])),
    loop: clip.name === actions.idle,
    markers: [],
    controlBones: [],
  })),
  actions,
  requiredActions: Object.keys(actions),
  skins: {
    [defaultSkinId]: descriptor(`${skinPath}/skin.json`, skin),
  },
  provenance: { authoring: recipe.source, alignmentReference: recipe.reference },
}

await mkdir(dest)
await mkdir(path.join(dest, skinPath), { recursive: true })
await Promise.all([
  writeFile(path.join(dest, 'model.glb'), bytes),
  writeFile(path.join(dest, skinPath, 'skin.json'), skin),
  writeFile(path.join(dest, skinPath, 'palette.png'), palette),
  writeFile(path.join(dest, 'manifest.json'), json(manifest)),
])
const validation = await validateWeaponPackage(dest, { validator })
const alignmentReport = {
  originalAngleDegrees: original.direction.angleTo(target.direction) * 180 / Math.PI,
  alignedAngleDegrees: placed.direction.angleTo(target.direction) * 180 / Math.PI,
  wrist: placed.wrist.toArray(),
  cuff: placed.cuff.toArray(),
}
await writeFile(path.join(dest, 'validation.json'), json({ ...validation, alignment: alignmentReport }))
if (install)
  await installWeaponPackage(dest, path.join(releaseRoot, weaponId, assetVersion))
console.log(JSON.stringify({
  candidate: dest,
  installed: !!install,
  alignment: alignmentReport,
  validation,
}, null, 2))
