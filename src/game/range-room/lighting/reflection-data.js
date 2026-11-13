import * as THREE from 'three/webgpu'

export const roomReflectionDefinition = Object.freeze({
  id: 'range-room-main-v1',
  size: 256,
  position: Object.freeze([0.5, 10.5, 5.5]),
  min: Object.freeze([-22.0874, 9, -6.8332]),
  max: Object.freeze([21.7254, 18, 18.98]),
  near: 0.05,
  far: 160,
  sky: 0.35,
  direct: 1,
  emissive: 0, // RectAreaLight owns the direct lamp highlight; black faces still occlude.
})

export const reflectionEncoding = 'webgpu-cube-camera-r187-rgba16f-le'

export async function hashReflectionBytes(bytes) {
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('')
}

export async function reflectionSource(roomManifest, skyboxUrl, signal) {
  const response = await fetch(skyboxUrl, { signal })
  if (!response.ok)
    throw new Error(`[Reflection] Sky HTTP ${response.status}`)
  return {
    version: 1,
    three: THREE.REVISION,
    room: await hashReflectionBytes(new TextEncoder().encode(JSON.stringify(roomManifest))),
    sky: await hashReflectionBytes(await response.arrayBuffer()),
    capture: roomReflectionDefinition,
    encoding: reflectionEncoding,
  }
}

export function validateReflectionManifest(manifest, source) {
  const definition = roomReflectionDefinition
  if (manifest?.version !== 1 || manifest.id !== definition.id
    || manifest.encoding !== reflectionEncoding
    || JSON.stringify(manifest.source) !== JSON.stringify(source)
    || manifest.bytes !== 6 * definition.size ** 2 * 8
    || typeof manifest.url !== 'string' || !manifest.url.length
    || !/^[a-f0-9]{64}$/u.test(manifest.sha256 ?? '')) {
    throw new Error('[Reflection] Invalid or stale reflection manifest; rebake the static room')
  }
  return manifest
}

/** Raw WebGPU layer rows are uploaded unchanged: no PNG conversion, V flip or face swap. */
export function reflectionCubeFromBytes(bytes, size = roomReflectionDefinition.size) {
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength !== 6 * size ** 2 * 8)
    throw new Error('[Reflection] Invalid HDR cube byte length')
  const view = new DataView(bytes)
  const data = new Uint16Array(bytes.byteLength / 2)
  for (let i = 0; i < data.length; i++) {
    data[i] = view.getUint16(i * 2, true)
    if (!Number.isFinite(THREE.DataUtils.fromHalfFloat(data[i])))
      throw new TypeError('[Reflection] Non-finite HDR cube value')
  }
  const stride = size * size * 4
  const faces = Array.from({ length: 6 }, (_, i) => {
    const face = new THREE.DataTexture(data.subarray(i * stride, (i + 1) * stride), size, size, THREE.RGBAFormat, THREE.HalfFloatType)
    face.colorSpace = THREE.LinearSRGBColorSpace
    return face
  })
  const cube = new THREE.CubeTexture(faces)
  cube.type = THREE.HalfFloatType
  cube.colorSpace = THREE.LinearSRGBColorSpace
  cube.generateMipmaps = true
  cube.minFilter = THREE.LinearMipmapLinearFilter
  cube.magFilter = THREE.LinearFilter
  cube.needsUpdate = true
  return cube
}
