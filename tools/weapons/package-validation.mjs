import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

export function readGlb(bytes) {
  assert.equal(bytes.readUInt32LE(0), 0x46546C67, 'Expected GLB')
  assert.equal(bytes.readUInt32LE(4), 2, 'Expected glTF 2')
  assert.equal(bytes.readUInt32LE(8), bytes.length, 'GLB length mismatch')
  assert.equal(bytes.readUInt32LE(16), 0x4E4F534A, 'Expected JSON chunk')
  const end = 20 + bytes.readUInt32LE(12)
  assert.equal(bytes.readUInt32LE(end + 4), 0x004E4942, 'Expected BIN chunk')
  const doc = JSON.parse(bytes.subarray(20, end).toString())
  const binary = bytes.subarray(end + 8, end + 8 + bytes.readUInt32LE(end))
  assert.ok(doc.buffers.every(buffer => !buffer.uri), 'External buffers are not allowed')
  assert.ok(doc.images.every(image => !image.uri && image.mimeType === 'image/png'), 'Textures must be embedded PNGs')
  return { doc, binary }
}

export function accessorBytes(glb, index) {
  const accessor = glb.doc.accessors[index]
  assert.ok(accessor && !accessor.sparse, 'Expected a dense accessor')
  const widths = {
    SCALAR: 1,
    VEC2: 2,
    VEC3: 3,
    VEC4: 4,
    MAT4: 16,
  }
  const componentBytes = {
    5120: 1,
    5121: 1,
    5122: 2,
    5123: 2,
    5125: 4,
    5126: 4,
  }
  const width = widths[accessor.type] * componentBytes[accessor.componentType]
  assert.ok(width > 0, 'Unsupported accessor format')
  const view = glb.doc.bufferViews[accessor.bufferView]
  const stride = view.byteStride ?? width
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
  assert.ok(start + (accessor.count - 1) * stride + width <= glb.binary.length, 'Accessor exceeds binary')
  const result = Buffer.alloc(accessor.count * width)
  for (let index = 0; index < accessor.count; index++)
    glb.binary.copy(result, index * width, start + index * stride, start + index * stride + width)
  return result
}

function accessorSignature(glb, index) {
  const { componentType, type, count, normalized } = glb.doc.accessors[index]
  return {
    componentType,
    type,
    count,
    normalized: normalized ?? false,
    sha256: sha256(accessorBytes(glb, index)),
  }
}

export function compatibilityFor(glb) {
  const digest = value => sha256(JSON.stringify(value))
  return {
    rig: digest({
      nodes: glb.doc.nodes.map(({ name, children, matrix, translation, rotation, scale }) => ({
        name,
        children,
        matrix,
        translation,
        rotation,
        scale,
      })),
      skins: glb.doc.skins.map(skin => ({
        joints: skin.joints,
        inverseBindMatrices: accessorSignature(glb, skin.inverseBindMatrices),
      })),
    }),
    geometryUV: digest(glb.doc.meshes.map(mesh => ({
      name: mesh.name,
      primitives: mesh.primitives.map(primitive => ({
        indices: accessorSignature(glb, primitive.indices),
        attributes: Object.fromEntries(Object.entries(primitive.attributes).map(([key, index]) => [
          key,
          accessorSignature(glb, index),
        ])),
      })),
    }))),
    clipSet: digest(glb.doc.animations.map(animation => ({
      name: animation.name,
      channels: animation.channels,
      samplers: animation.samplers.map(sampler => ({
        interpolation: sampler.interpolation ?? 'LINEAR',
        input: accessorSignature(glb, sampler.input),
        output: accessorSignature(glb, sampler.output),
      })),
    }))),
  }
}

export function pngSize(bytes) {
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'Expected PNG')
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  }
}

/** Verify both anatomical mappings and the actual embedded shared atlas, not just their names. */
export function validateArmContract(glb, declaration, contract) {
  assert.equal(declaration.version, contract.version, 'Unsupported arm UV contract')
  assert.equal(declaration.textureSha256, contract.textureSha256, 'Arm atlas contract mismatch')
  const imageIndices = []
  for (const side of ['Left', 'Right']) {
    const mesh = glb.doc.meshes.find(item => item.name === `Arms_${side}`)
    assert.ok(mesh && mesh.primitives.length === 1, `Missing arm mesh: ${side}`)
    const primitive = mesh.primitives[0]
    assert.equal(glb.doc.materials[primitive.material]?.name, `Character_${side}`, `Wrong arm material: ${side}`)
    const indexAccessor = glb.doc.accessors[primitive.indices]
    const indexBytes = accessorBytes(glb, primitive.indices)
    assert.equal(indexAccessor.type, 'SCALAR')
    assert.equal(indexAccessor.count, contract.indices.length)
    assert.ok([5123, 5125].includes(indexAccessor.componentType), 'Unsupported arm index type')
    const actualIndices = contract.indices.map((_, index) => indexAccessor.componentType === 5123
      ? indexBytes.readUInt16LE(index * 2)
      : indexBytes.readUInt32LE(index * 4))
    assert.deepEqual(actualIndices, contract.indices, `Arm topology mismatch: ${side}`)
    const uvIndex = primitive.attributes.TEXCOORD_0
    const uvAccessor = glb.doc.accessors[uvIndex]
    assert.ok(uvAccessor && uvAccessor.type === 'VEC2' && uvAccessor.componentType === 5126
      && uvAccessor.count === contract.sides[side].length, `Invalid arm UV accessor: ${side}`)
    const uv = accessorBytes(glb, uvIndex)
    for (let index = 0; index < uvAccessor.count; index++) {
      assert.ok(Math.abs(uv.readFloatLE(index * 8) - contract.sides[side][index][0]) < 1e-6
        && Math.abs(uv.readFloatLE(index * 8 + 4) - (1 - contract.sides[side][index][1])) < 1e-6, `Arm UV mismatch: ${side} vertex ${index}`)
    }
    const material = glb.doc.materials[primitive.material]
    const texture = glb.doc.textures[material.pbrMetallicRoughness?.baseColorTexture?.index]
    const image = glb.doc.images[texture?.source]
    assert.ok(image && image.mimeType === 'image/png', `Missing arm atlas: ${side}`)
    const view = glb.doc.bufferViews[image.bufferView]
    const start = view.byteOffset ?? 0
    const bytes = glb.binary.subarray(start, start + view.byteLength)
    assert.deepEqual(pngSize(bytes), { width: contract.width, height: contract.height }, 'Wrong arm atlas dimensions')
    assert.equal(sha256(bytes), contract.textureSha256, `Wrong arm atlas pixels: ${side}`)
    imageIndices.push(texture.source)
  }
  assert.equal(imageIndices[0], imageIndices[1], 'Left and right must reference one embedded arm atlas')
}

async function readChecked(root, base, descriptor) {
  assert.ok(descriptor && typeof descriptor.url === 'string', 'Missing resource descriptor')
  const resolved = path.resolve(base, descriptor.url)
  assert.ok(resolved.startsWith(`${path.resolve(root)}${path.sep}`), 'Resource escapes package')
  const bytes = await readFile(resolved)
  assert.equal(bytes.length, descriptor.bytes, `Byte length mismatch: ${descriptor.url}`)
  assert.equal(sha256(bytes), descriptor.sha256, `SHA256 mismatch: ${descriptor.url}`)
  return bytes
}

/** Headless binding/pose checks use PNG dimensions only; browser checks decode and render pixels. */
export async function validateWeaponPackage(directory, { validator, poseSamples = [] } = {}) {
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'))
  assert.equal(manifest.schemaVersion, 1)
  const bytes = await readChecked(directory, directory, manifest.model)
  const glb = readGlb(bytes)
  assert.deepEqual(compatibilityFor(glb), manifest.compatibility, 'Model compatibility signature mismatch')
  if (manifest.armContract) {
    const contract = JSON.parse(await readFile(new URL('./arm-contract.json', import.meta.url), 'utf8'))
    validateArmContract(glb, manifest.armContract, contract)
  }
  assert.equal(new Set(glb.doc.nodes.map(node => node.name)).size, glb.doc.nodes.length, 'Duplicate node names')
  const clipNames = manifest.clips.map(clip => clip.name)
  assert.deepEqual(glb.doc.animations.map(clip => clip.name).sort(), [...clipNames].sort(), 'Clip set mismatch')
  for (const [role, name] of Object.entries(manifest.actions))
    assert.ok(clipNames.includes(name), `Missing action binding: ${role} -> ${name}`)
  for (const role of manifest.requiredActions)
    assert.ok(manifest.actions[role], `Missing required action role: ${role}`)
  const materialNames = new Set(glb.doc.materials.map(material => material.name))
  for (const [role, names] of Object.entries(manifest.materials)) {
    assert.ok(names.length > 0, `Empty material role: ${role}`)
    for (const name of names) assert.ok(materialNames.has(name), `Unbound material: ${name}`)
  }
  for (const name of Object.values(manifest.sockets))
    assert.ok(glb.doc.nodes.some(node => node.name === name), `Unbound socket: ${name}`)
  assert.ok(manifest.skins[manifest.defaultSkinId], 'Missing default skin')
  for (const [skinId, descriptor] of Object.entries(manifest.skins)) {
    const skinBytes = await readChecked(directory, directory, descriptor)
    const skin = JSON.parse(skinBytes)
    assert.equal(skin.schemaVersion, 1)
    assert.equal(skin.weaponId, manifest.weaponId)
    assert.equal(skin.assetVersion, manifest.assetVersion)
    assert.equal(skin.skinId, skinId)
    assert.deepEqual(skin.compatibility, manifest.compatibility, 'Incompatible skin')
    for (const [role, input] of Object.entries(skin.materials)) {
      assert.ok(manifest.materials[role], `Unknown skin material role: ${role}`)
      const texture = await readChecked(directory, path.dirname(path.resolve(directory, descriptor.url)), input.map)
      assert.deepEqual(pngSize(texture), { width: input.map.width, height: input.map.height })
      assert.equal(input.map.colorSpace, 'srgb')
      assert.equal(input.map.flipY, false)
    }
  }

  const globals = new Map(['self', 'createImageBitmap', 'ProgressEvent'].map(name => [
    name,
    Object.getOwnPropertyDescriptor(globalThis, name),
  ]))
  globalThis.self = globalThis
  globalThis.createImageBitmap = async blob => ({
    ...pngSize(Buffer.from(await blob.arrayBuffer())),
    close() {},
  })
  globalThis.ProgressEvent ??= class ProgressEvent {
    constructor(type, values) { Object.assign(this, { type, ...values }) }
  }
  let loaded
  let mixer
  try {
    loaded = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')
    mixer = new THREE.AnimationMixer(loaded.scene)
    const meshes = []
    loaded.scene.traverse((node) => {
      if (node.isMesh) {
        assert.ok(node.isSkinnedMesh, `Unexpected helper mesh: ${node.name}`)
        meshes.push(node)
      }
    })
    assert.deepEqual(meshes.map(mesh => mesh.name).sort(), [...manifest.meshes].sort(), 'Mesh role set mismatch')
    let tracks = 0
    let stepTracks = 0
    for (const clip of loaded.animations) {
      assert.ok(clip.validate(), `Invalid animation: ${clip.name}`)
      const spec = manifest.clips.find(item => item.name === clip.name)
      assert.ok(Math.abs(clip.duration - spec.duration) < 1e-4, `Duration mismatch: ${clip.name}`)
      for (const marker of spec.markers)
        assert.ok(marker.time >= 0 && marker.time <= clip.duration + 1e-6, `Marker outside clip: ${clip.name}`)
      for (const track of clip.tracks) {
        tracks++
        if (track.getInterpolation() === THREE.InterpolateDiscrete)
          stepTracks++
        const parsed = THREE.PropertyBinding.parseTrackName(track.name)
        assert.ok(THREE.PropertyBinding.findNode(loaded.scene, parsed.nodeName), `Unbound track: ${track.name}`)
        assert.ok(Math.abs(track.times[0]) < 1e-6, `Nonzero start: ${clip.name}/${track.name}`)
        assert.ok([...track.values].every(Number.isFinite), `Nonfinite track: ${track.name}`)
        if (spec.loop) {
          const size = track.getValueSize()
          const first = [
            ...track.values.subarray(0, size),
          ]
          const last = [
            ...track.values.subarray(-size),
          ]
          let difference = Math.max(...first.map((value, index) => Math.abs(value - last[index])))
          if (track.name.endsWith('.quaternion'))
            difference = Math.min(difference, Math.max(...first.map((value, index) => Math.abs(value + last[index]))))
          assert.ok(difference <= 0.001, `Loop seam: ${clip.name}/${track.name}`)
        }
      }
      const action = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1)
      action.clampWhenFinished = true
      for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
        action.reset().play()
        mixer.setTime(clip.duration * fraction)
        loaded.scene.updateMatrixWorld(true)
        for (const mesh of meshes) {
          mesh.skeleton.update()
          assert.ok([...mesh.skeleton.boneMatrices].every(Number.isFinite), `Nonfinite pose: ${clip.name}`)
        }
      }
      action.stop()
    }
    assert.ok(stepTracks > 0, 'Authored STEP channels were lost')
    for (const mesh of meshes) {
      const weights = mesh.geometry.attributes.skinWeight
      for (let index = 0; index < weights.count; index++) {
        const values = [
          weights.getX(index),
          weights.getY(index),
          weights.getZ(index),
          weights.getW(index),
        ]
        assert.equal(values.filter(value => value > 1e-6).length, 1, 'Expected rigid source weights')
        assert.ok(Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) < 1e-5, 'Invalid skin weights')
      }
    }
    let maxPoseBoundsError = 0
    for (const sample of poseSamples) {
      mixer.stopAllAction()
      const clip = loaded.animations.find(clip => clip.name === sample.clip)
      const action = mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce, 1)
      action.clampWhenFinished = true
      action.play()
      mixer.setTime(sample.time)
      loaded.scene.updateMatrixWorld(true)
      for (const mesh of meshes) {
        mesh.skeleton.update()
        const bounds = [
          [Infinity, Infinity, Infinity],
          [-Infinity, -Infinity, -Infinity],
        ]
        const vertex = new THREE.Vector3()
        for (let index = 0; index < mesh.geometry.attributes.position.count; index++) {
          vertex.fromBufferAttribute(mesh.geometry.attributes.position, index)
          mesh.applyBoneTransform(index, vertex).applyMatrix4(mesh.matrixWorld)
          for (let axis = 0; axis < 3; axis++) {
            bounds[0][axis] = Math.min(bounds[0][axis], vertex.getComponent(axis))
            bounds[1][axis] = Math.max(bounds[1][axis], vertex.getComponent(axis))
          }
        }
        maxPoseBoundsError = Math.max(maxPoseBoundsError, ...bounds.flat().map((value, index) => Math.abs(value - sample.bounds[mesh.name].flat()[index])))
      }
    }
    assert.ok(maxPoseBoundsError < 0.001, `Blender/Three pose mismatch: ${maxPoseBoundsError}`)
    let gltfIssues = null
    if (validator) {
      const result = await validator.validateBytes(new Uint8Array(bytes), { maxIssues: 100 })
      gltfIssues = result.issues
      assert.equal(gltfIssues.numErrors, 0, JSON.stringify(gltfIssues))
      assert.equal(gltfIssues.numWarnings, 0, JSON.stringify(gltfIssues))
    }
    return {
      weaponId: manifest.weaponId,
      clips: loaded.animations.length,
      meshes: meshes.length,
      tracks,
      stepTracks,
      poseSamples: poseSamples.length,
      maxPoseBoundsError,
      gltfIssues,
    }
  }
  finally {
    mixer?.stopAllAction()
    if (loaded) {
      mixer?.uncacheRoot(loaded.scene)
      const owned = new Set()
      loaded.scene.traverse((node) => {
        if (node.geometry)
          owned.add(node.geometry)
        if (node.skeleton)
          owned.add(node.skeleton)
        for (const material of Array.isArray(node.material)
          ? node.material
          : node.material
            ? [node.material]
            : []) {
          owned.add(material)
          for (const value of Object.values(material)) {
            if (value?.isTexture)
              owned.add(value)
          }
        }
      })
      for (const resource of owned) resource.dispose()
    }
    for (const [name, descriptor] of globals) {
      if (descriptor)
        Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
  }
}
