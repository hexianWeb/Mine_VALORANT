import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import http from 'node:http'
import test from 'node:test'
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'
import * as THREE from 'three/webgpu'
import { WorldManager } from '../src/engine/runtime/function/framework/world/world-manager.js'
import { nextFrame } from '../src/engine/runtime/platform/next-frame.js'
import { loaders } from '../src/engine/runtime/resource/loader/loaders.js'
import { ResourceManager } from '../src/engine/runtime/resource/resource-manager.js'

const flush = () => new Promise(resolve => setImmediate(resolve))

async function serve(t, handler) {
  const server = http.createServer(handler)
  t.after(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${server.address().port}`
}

test('cancellation settles before a non-cooperative loader and isolates same-name retries', async (t) => {
  const requests = []
  t.mock.method(loaders, 'texture', (entry, manager) => {
    const pending = Promise.withResolvers()
    requests.push({ ...pending, signal: entry.options.signal, manager })
    return pending.promise
  })
  const resources = new ResourceManager()
  t.after(() => resources.dispose())
  const errors = []
  resources.on('error', event => errors.push(event))
  const entry = { name: 'image', type: 'texture', url: '/image.png' }
  const cancelled = resources.load([entry])
  const rejection = assert.rejects(cancelled, { name: 'AbortError' })
  resources.unload(entry.name)
  await rejection
  assert.equal(requests[0].signal.aborted, true)
  assert.equal(requests[0].manager.abortController.signal.aborted, true)

  const retry = resources.load([entry])
  const late = new THREE.Texture()
  let releases = 0
  late.addEventListener('dispose', () => releases++)
  requests[0].resolve(late)
  await flush()
  assert.equal(releases, 1)
  assert.equal(resources.has(entry.name), false)
  assert.equal(requests[1].signal.aborted, false)
  const fresh = new THREE.Texture()
  requests[1].resolve(fresh)
  await retry
  assert.equal(resources.get(entry.name, 'texture'), fresh)
  assert.deepEqual(errors, [])
})

test('signals cancel the shared pending task, but no longer own completed cache entries', async (t) => {
  const pending = Promise.withResolvers()
  let starts = 0
  t.mock.method(loaders, 'json', () => {
    starts++
    return pending.promise
  })
  const resources = new ResourceManager()
  t.after(() => resources.dispose())
  const entry = { name: 'shared', type: 'json', url: '/shared.json' }
  const controller = new AbortController()
  const first = assert.rejects(resources.load([entry]), { name: 'AbortError' })
  const second = assert.rejects(resources.load([entry], { signal: controller.signal }), { name: 'AbortError' })
  controller.abort()
  await Promise.all([first, second])
  assert.equal(starts, 1)
  pending.resolve({ old: true })
  await flush()

  const completed = new AbortController()
  await resources.load([entry], { signal: completed.signal })
  completed.abort()
  assert.equal(resources.has(entry.name), true)
  await assert.rejects(resources.load([], { signal: completed.signal }), { name: 'AbortError' })
})

test('one failed asset does not cancel its batch siblings and can be retried', async (t) => {
  const pending = Promise.withResolvers()
  let attempts = 0
  t.mock.method(loaders, 'json', async (entry) => {
    if (entry.name === 'slow')
      return pending.promise
    if (++attempts === 1)
      throw new Error('invalid JSON')
    return { repaired: true }
  })
  const resources = new ResourceManager()
  t.after(() => resources.dispose())
  const bad = { name: 'bad', type: 'json', url: '/bad.json' }
  const slow = { name: 'slow', type: 'json', url: '/slow.json' }
  await assert.rejects(resources.load([bad, slow]), /invalid JSON/)
  await resources.load([bad])
  pending.resolve({ complete: true })
  await resources.load([slow])
  assert.deepEqual(resources.get('bad', 'json'), { repaired: true })
  assert.deepEqual(resources.get('slow', 'json'), { complete: true })
})

test('all resource types abort real HTTP downloads without waiting for the server', { timeout: 5000 }, async (t) => {
  const expected = 12 // six single-file types plus six cubemap faces
  const arrived = Promise.withResolvers()
  const closed = Promise.withResolvers()
  let requests = 0
  let closures = 0
  const base = await serve(t, (_request, response) => {
    response.on('close', () => {
      if (++closures === expected)
        closed.resolve()
    })
    if (++requests === expected)
      arrived.resolve()
  })
  const entries = [
    'json',
    'binary',
    'texture',
    'gltf',
    'hdr',
    'exr',
  ].map(type => ({ name: type, type, url: `${base}/${type}` }))
  entries.push({
    name: 'cube',
    type: 'cubeTexture',
    url: Array.from({ length: 6 }, (_, i) => `${base}/face-${i}`),
  })
  const resources = new ResourceManager()
  t.after(() => resources.dispose())
  const controller = new AbortController()
  const rejected = assert.rejects(resources.load(entries, { signal: controller.signal }), { name: 'AbortError' })
  await arrived.promise
  controller.abort()
  await rejected
  await closed.promise
  assert.equal(requests, expected)
  assert.equal(closures, expected)
})

test('binary downloads preserve bytes and enforce SHA256 before caching', async (t) => {
  const bytes = Buffer.from('scope-owned sound bytes')
  const base = await serve(t, (_request, response) => response.end(bytes))
  const resources = new ResourceManager()
  t.after(() => resources.dispose())
  const hash = createHash('sha256').update(bytes).digest('hex')
  await resources.load([
    {
      name: 'sound',
      type: 'binary',
      url: `${base}/sound`,
      options: { sha256: hash },
    },
  ])
  assert.deepEqual(Buffer.from(resources.get('sound', 'binary')), bytes)
  await assert.rejects(resources.load([
    {
      name: 'bad',
      type: 'binary',
      url: `${base}/bad`,
      options: {
        sha256: '0'.repeat(64),
      },
    },
  ]), /SHA-256 mismatch/)
  assert.equal(resources.has('bad'), false)
})

test('a cancelled response body allows immediate same-URL retry and world reload', { timeout: 5000 }, async (t) => {
  const arrived = Promise.withResolvers()
  const closed = Promise.withResolvers()
  let requests = 0
  const base = await serve(t, (_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    if (++requests === 1) {
      response.on('close', () => closed.resolve())
      response.write('{"incomplete":')
      arrived.resolve()
    }
    else {
      response.end('{"fresh":true}')
    }
  })
  const resources = new ResourceManager()
  const world = new WorldManager()
  t.after(() => {
    world.dispose()
    resources.dispose()
  })
  const entry = { name: 'level', type: 'json', url: `${base}/level.json` }
  const factory = () => ({
    load: ({ signal }) => resources.load([entry], { signal }),
    dispose: () => resources.unload(entry.name),
  })
  const rejected = assert.rejects(world.loadLevel(factory), { name: 'AbortError' })
  await arrived.promise
  await world.unloadLevel()
  await rejected
  await world.loadLevel(factory)
  await closed.promise
  assert.deepEqual(resources.get(entry.name, 'json'), { fresh: true })
  assert.equal(world.state, 'ready')
  assert.equal(requests, 2)
})

test('GLTF external buffers are abortable and isolated when retried at the same URL', { timeout: 5000 }, async (t) => {
  // FileLoader's progress event is a browser global; its actual fetch remains unmocked.
  const progress = Object.getOwnPropertyDescriptor(globalThis, 'ProgressEvent')
  Object.defineProperty(globalThis, 'ProgressEvent', {
    configurable: true,
    value: class {
      constructor(_type, fields) {
        Object.assign(this, fields)
      }
    },
  })
  t.after(() => {
    if (progress)
      Object.defineProperty(globalThis, 'ProgressEvent', progress)
    else
      delete globalThis.ProgressEvent
  })
  const arrived = Promise.withResolvers()
  const closed = Promise.withResolvers()
  let buffers = 0
  const manifest = {
    asset: { version: '2.0' },
    buffers: [
      { uri: 'mesh.bin', byteLength: 12 },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 12 },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 1,
        type: 'VEC3',
        min: [1, 2, 3],
        max: [1, 2, 3],
      },
    ],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 0 },
            mode: 0,
          },
        ],
      },
    ],
    nodes: [
      { mesh: 0 },
    ],
    scenes: [
      {
        nodes: [0],
      },
    ],
    scene: 0,
  }
  const base = await serve(t, (request, response) => {
    if (request.url === '/model.gltf') {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify(manifest))
    }
    else if (++buffers === 1) {
      response.on('close', () => closed.resolve())
      arrived.resolve()
    }
    else {
      response.end(Buffer.from(new Float32Array([1, 2, 3]).buffer))
    }
  })
  const resources = new ResourceManager()
  t.after(() => resources.dispose())
  const entry = { name: 'model', type: 'gltf', url: `${base}/model.gltf` }
  const rejected = assert.rejects(resources.load([entry]), { name: 'AbortError' })
  await arrived.promise
  resources.unload(entry.name)
  const retry = resources.load([entry])
  await Promise.all([rejected, retry, closed.promise])
  const object = resources.get(entry.name, 'gltf').scene.children[0]
  assert.deepEqual(Array.from(object.geometry.attributes.position.array), [1, 2, 3])
  assert.equal(buffers, 2)
})

test('HDR parsing preserves official texture defaults with cancellable downloading', async (t) => {
  const header = Buffer.from('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 1\n')
  const bytes = Buffer.concat([
    header,
    Buffer.from([128, 64, 32, 129]),
  ])
  const url = `data:application/octet-stream;base64,${bytes.toString('base64')}`
  const resources = new ResourceManager()
  t.after(() => resources.dispose())
  await resources.load([
    { name: 'hdr', type: 'hdr', url },
  ])
  const actual = resources.get('hdr', 'hdr')
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const expected = new HDRLoader().createDataTexture(buffer)
  t.after(() => expected.dispose())
  for (const key of [
    'type',
    'colorSpace',
    'flipY',
    'generateMipmaps',
    'minFilter',
    'magFilter',
  ])
    assert.equal(actual[key], expected[key], key)
  assert.deepEqual(actual.image, expected.image)
  assert.equal(actual.mapping, THREE.EquirectangularReflectionMapping)
})

test('texture and cube decoding keep HTML images and release temporary URLs on success or abort', async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const images = []
  const revoked = []
  let autoComplete = true
  let decoded = Promise.withResolvers()
  class Image extends EventTarget {
    get src() { return this.url }

    set src(value) {
      this.url = value
      decoded.resolve()
      if (autoComplete)
        queueMicrotask(() => this.dispatchEvent(new Event('load')))
    }

    removeAttribute(name) {
      assert.equal(name, 'src')
      this.url = null
    }
  }
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElementNS() {
        const image = new Image()
        images.push(image)
        return image
      },
    },
  })
  t.mock.method(URL, 'createObjectURL', () => `blob:decode-${images.length}`)
  t.mock.method(URL, 'revokeObjectURL', url => revoked.push(url))
  t.after(() => {
    if (original)
      Object.defineProperty(globalThis, 'document', original)
    else
      delete globalThis.document
  })
  const url = 'data:image/png;base64,AA=='
  const resources = new ResourceManager()
  t.after(() => resources.dispose())
  await resources.load([
    { name: 'texture', type: 'texture', url },
    {
      name: 'cube',
      type: 'cubeTexture',
      url: Array.from({ length: 6 }).fill(url),
    },
  ])
  const texture = resources.get('texture', 'texture')
  const cube = resources.get('cube', 'cubeTexture')
  assert.equal(texture.image instanceof Image, true)
  assert.equal(texture.colorSpace, THREE.SRGBColorSpace)
  assert.equal(texture.flipY, true)
  assert.equal(cube.images.length, 6)
  assert.ok(cube.images.every(image => image instanceof Image))
  assert.equal(cube.colorSpace, THREE.SRGBColorSpace)
  assert.equal(cube.flipY, false)
  assert.equal(new Set(revoked).size, 7)

  autoComplete = false
  decoded = Promise.withResolvers()
  const pending = resources.load([
    { name: 'abort-decode', type: 'texture', url },
  ])
  const rejected = assert.rejects(pending, { name: 'AbortError' })
  await decoded.promise
  resources.unload('abort-decode')
  await rejected
  assert.equal(images.at(-1).url, null)
  assert.equal(new Set(revoked).size, 8)
  assert.equal(resources.has('abort-decode'), false)
})

test('GLTF still accepts self-contained data URLs', async (t) => {
  const resources = new ResourceManager()
  t.after(() => resources.dispose())
  const model = {
    asset: { version: '2.0' },
    scenes: [
      { nodes: [] },
    ],
    scene: 0,
  }
  const url = `data:model/gltf+json;base64,${Buffer.from(JSON.stringify(model)).toString('base64')}`
  await resources.load([
    { name: 'inline', type: 'gltf', url },
  ])
  assert.equal(resources.get('inline', 'gltf').scene.children.length, 0)
})

test('a hidden-tab frame wait rejects on abort and cancels its queued callback', async (t) => {
  const originals = new Map(['requestAnimationFrame', 'cancelAnimationFrame'].map(key => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ]))
  const callbacks = new Map()
  let id = 0
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    value: (callback) => {
      callbacks.set(++id, callback)
      return id
    },
  })
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    configurable: true,
    value: id => callbacks.delete(id),
  })
  t.after(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor)
        Object.defineProperty(globalThis, key, descriptor)
      else
        delete globalThis[key]
    }
  })
  const controller = new AbortController()
  const rejected = assert.rejects(nextFrame(controller.signal), { name: 'AbortError' })
  assert.equal(callbacks.size, 1)
  controller.abort()
  await rejected
  assert.equal(callbacks.size, 0)
  await assert.rejects(nextFrame(controller.signal), { name: 'AbortError' })
  assert.equal(callbacks.size, 0)
  const completed = new AbortController()
  const frame = nextFrame(completed.signal)
  callbacks.get(id)(42)
  assert.equal(await frame, 42)
  completed.abort()
})
