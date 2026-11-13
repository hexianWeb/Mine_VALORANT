import { context } from 'three/tsl'
import * as THREE from 'three/webgpu'
import { makeCaptureScene } from './probe-lighting.js'
import { reflectionEncoding, reflectionSource, roomReflectionDefinition } from './reflection-data.js'

/** Developer bake only. Never called by normal loading or weapon/skin changes. */
export async function captureRoomReflection({ renderer, room, scene, skyboxUrl, signal }) {
  const source = await reflectionSource(room.manifest, skyboxUrl, signal)
  const definition = roomReflectionDefinition
  const capture = makeCaptureScene(room, scene)
  const target = new THREE.CubeRenderTarget(definition.size, {
    type: THREE.HalfFloatType,
    colorSpace: THREE.LinearSRGBColorSpace,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
  })
  const camera = new THREE.CubeCamera(definition.near, definition.far, target)
  camera.position.fromArray(definition.position)
  const previous = {
    toneMapping: renderer.toneMapping,
    outputColorSpace: renderer.outputColorSpace,
    contextNode: renderer.contextNode,
    autoClear: renderer.autoClear,
    autoClearColor: renderer.autoClearColor,
    autoClearDepth: renderer.autoClearDepth,
    autoClearStencil: renderer.autoClearStencil,
  }
  const oldTarget = renderer.getRenderTarget()
  const oldFace = renderer.getActiveCubeFace()
  const oldMip = renderer.getActiveMipmapLevel()
  const oldMRT = renderer.getMRT()
  const oldColor = renderer.getClearColor(new THREE.Color())
  const oldAlpha = renderer.getClearAlpha()
  try {
    signal?.throwIfAborted()
    capture.configure(definition)
    capture.scene.name = 'Static room reflection capture'
    renderer.toneMapping = THREE.NoToneMapping
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace
    renderer.contextNode = context({
      getAO: () => null,
    })
    renderer.autoClear = renderer.autoClearColor = renderer.autoClearDepth = renderer.autoClearStencil = true
    renderer.setMRT(null)
    renderer.setClearColor(0, 1)
    camera.update(renderer, capture.scene)
    const bytes = new Uint8Array(6 * definition.size ** 2 * 8)
    const view = new DataView(bytes.buffer)
    const stats = []
    for (let face = 0; face < 6; face++) {
      signal?.throwIfAborted()
      const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, definition.size, definition.size, 0, face)
      let maximum = 0
      let sum = 0
      for (let i = 0; i < pixels.length; i++) {
        const value = THREE.DataUtils.fromHalfFloat(pixels[i])
        if (!Number.isFinite(value))
          throw new TypeError('[Reflection] Capture produced non-finite HDR')
        view.setUint16((face * pixels.length + i) * 2, pixels[i], true)
        if (i % 4 !== 3) {
          maximum = Math.max(maximum, value)
          sum += value
        }
      }
      stats.push({ face, rgbMax: maximum, rgbMean: sum / (definition.size ** 2 * 3) })
    }
    let binary = ''
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
    return {
      version: 1,
      id: definition.id,
      encoding: reflectionEncoding,
      source,
      stats,
      base64: btoa(binary),
    }
  }
  finally {
    Object.assign(renderer, previous)
    renderer.setMRT(oldMRT)
    renderer.setRenderTarget(oldTarget, oldFace, oldMip)
    renderer.setClearColor(oldColor, oldAlpha)
    capture.dispose()
    target.dispose()
  }
}
