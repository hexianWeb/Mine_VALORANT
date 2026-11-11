import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { float, positionLocal } from 'three/tsl'
import * as THREE from 'three/webgpu'
import { createTextureSampling } from '../src/engine/runtime/function/render/material/texture-sampling.js'
import { NormalPrepass } from '../src/engine/runtime/function/render/passes/normal-prepass.js'
import { renderConfig, validateEffects } from '../src/engine/runtime/function/render/render-config.js'
import { FrameStatistics } from '../src/engine/runtime/function/render/render-profiler.js'
import { decodeEXR } from '../src/engine/runtime/resource/loader/decode-exr.js'
import { parseEXRData } from '../src/engine/runtime/resource/loader/exr-data.js'

test('normal prepass retains cutouts, normals and deformation without changing source PBR materials', () => {
  const source = new THREE.MeshStandardNodeMaterial({ alphaTest: 0.5, side: THREE.DoubleSide })
  source.map = new THREE.Texture()
  source.normalMap = new THREE.Texture()
  source.positionNode = positionLocal.add(1)
  source.opacityNode = float(0.8)
  const prepass = new NormalPrepass(new THREE.Scene(), new THREE.PerspectiveCamera())
  const normal = prepass.materialFor(source)
  assert.equal(normal.map, source.map)
  assert.equal(normal.normalMap, source.normalMap)
  assert.equal(normal.alphaTest, 0.5)
  assert.equal(normal.side, THREE.DoubleSide)
  assert.equal(normal.positionNode, source.positionNode)
  assert.equal(normal.opacityNode, source.opacityNode)
  assert.equal(normal.lights, false)
  assert.equal(source.lights, true)
  assert.equal(prepass.transparent, false)
  source.alphaTest = 0
  assert.equal(prepass.materialFor(source), normal)
  assert.equal(normal.map, null)
  assert.ok(source.map.isTexture)
  let disposed = 0
  normal.addEventListener('dispose', () => disposed++)
  source.dispose()
  assert.equal(disposed, 1)
  assert.equal(prepass.materials.size, 0)
  prepass.dispose()
  assert.equal(disposed, 1)
  source.map.dispose()
  source.normalMap.dispose()
})

test('steady-state statistics exclude warmup and discard old configurations', () => {
  const stats = new FrameStatistics(3, 2)
  for (const value of [500, 100, 1, 2, 3, 4]) stats.add(value)
  assert.deepEqual(stats.snapshot(), {
    samples: 3,
    warmupRemaining: 0,
    p50: 3,
    p95: 4,
    p99: 4,
  })
  stats.reset()
  assert.equal(stats.snapshot().p50, null)
  assert.equal(stats.snapshot().warmupRemaining, 2)
})

test('AO resolution accepts linked or independent denoise and rejects invalid controls', () => {
  for (const scale of [null, 0.25, 0.5, 0.75, 1])
    assert.doesNotThrow(() => validateEffects({ ...renderConfig, denoiseResolutionScale: scale }))
  for (const scale of [-1, 0, 2, Number.NaN, 'auto'])
    assert.throws(() => validateEffects({ ...renderConfig, denoiseResolutionScale: scale }))
  assert.throws(() => validateEffects({ ...renderConfig, ao: 'false' }))
})

test('prepared EXR mip chain is reused without cloning base pixels or changing HDR/UV encoding', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../public/lighting/range-room/manifest.json', import.meta.url)))
  const bytes = fs.readFileSync(new URL(`../public/lighting/range-room/atlases/${manifest.atlases[0].id}.exr`, import.meta.url))
  const parsed = parseEXRData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), 2)
  const source = new THREE.DataTexture(parsed.data, parsed.width, parsed.height, parsed.format, parsed.type)
  source.mipmaps = parsed.mipmaps
  source.colorSpace = parsed.colorSpace
  const samplers = createTextureSampling()
  const atlas = samplers.atlas(source)
  assert.equal(atlas.image.data, parsed.data)
  assert.equal(atlas.mipmaps[1], parsed.mipmaps[1])
  assert.equal(atlas.type, THREE.HalfFloatType)
  assert.equal(atlas.colorSpace, THREE.LinearSRGBColorSpace)
  assert.equal(atlas.flipY, false)
  assert.deepEqual(atlas.mipmaps.map(mip => mip.width), [parsed.width, parsed.width / 2, parsed.width / 4])
  samplers.dispose()
  source.dispose()
})

test('cancelling EXR decoding terminates its worker and rejects with AbortError', async () => {
  const previous = globalThis.Worker
  let terminations = 0
  globalThis.Worker = class {
    postMessage() {}
    terminate() { terminations++ }
  }
  try {
    const controller = new AbortController()
    const pending = decodeEXR(new ArrayBuffer(8), { signal: controller.signal })
    controller.abort()
    await assert.rejects(pending, { name: 'AbortError' })
    assert.equal(terminations, 1)
    await assert.rejects(decodeEXR(new ArrayBuffer(8), { signal: controller.signal }), { name: 'AbortError' })
    assert.equal(terminations, 1)
  }
  finally {
    if (previous === undefined)
      delete globalThis.Worker
    else
      globalThis.Worker = previous
  }
})
