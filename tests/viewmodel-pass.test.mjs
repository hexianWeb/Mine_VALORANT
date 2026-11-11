import assert from 'node:assert/strict'
import test from 'node:test'
import { context } from 'three/tsl'
import * as THREE from 'three/webgpu'
import { createViewModelLayer, ViewModelPass } from '../src/engine/runtime/function/render/passes/viewmodel-pass.js'
import { renderConfig, validateEffects } from '../src/engine/runtime/function/render/render-config.js'
import { buildPipeline } from '../src/engine/runtime/function/render/render-pipeline.js'

test('viewmodel layer preserves scene roots and updates only its independent camera and light', () => {
  const layer = createViewModelLayer({ aspect: 2 })
  const scene = layer.scene
  const camera = layer.camera
  const root = new THREE.Object3D()
  root.position.set(0.4, -0.7, -1.3)
  scene.add(root)
  assert.equal(layer.enabled, false)
  assert.equal(camera.fov, 70)
  assert.equal(camera.near, 0.005)
  assert.equal(camera.far, 10)
  assert.deepEqual(camera.position.toArray(), [0, 0, 0])
  layer.setEnabled(true)
  layer.setFov(45)
  const projection = camera.projectionMatrix.clone()
  layer.resize(1)
  layer.setLightIntensity(5)
  assert.equal(layer.scene, scene)
  assert.equal(layer.camera, camera)
  assert.equal(camera.aspect, 1)
  assert.notDeepEqual(camera.projectionMatrix.elements, projection.elements)
  assert.equal(scene.children.find(child => child.isAmbientLight).intensity, 5)
  layer.setEnabled(false)
  assert.equal(root.parent, scene)
  assert.deepEqual(root.position.toArray(), [0.4, -0.7, -1.3])
  layer.dispose()
})

test('layer teardown detaches but never disposes game-owned geometry, material or texture', () => {
  const layer = createViewModelLayer()
  const geometry = new THREE.BoxGeometry()
  const material = new THREE.MeshBasicNodeMaterial()
  const texture = new THREE.Texture()
  material.map = texture
  const root = new THREE.Mesh(geometry, material)
  let released = 0
  for (const resource of [geometry, material, texture])
    resource.addEventListener('dispose', () => released++)
  layer.scene.add(root)
  layer.dispose()
  layer.dispose()
  assert.equal(layer.enabled, false)
  assert.equal(root.parent, null)
  assert.equal(released, 0)
  assert.throws(() => layer.setEnabled(true), /disposed/)
  assert.throws(() => layer.setFov(70), /disposed/)
  for (const resource of [geometry, material, texture]) resource.dispose()
  assert.equal(released, 3)
})

function rendererStub(render) {
  let target = { name: 'previous target' }
  let mrt = { name: 'previous MRT' }
  let clearColor = new THREE.Color(0.2, 0.3, 0.4)
  let clearAlpha = 0.75
  return {
    autoClear: false,
    autoClearColor: false,
    autoClearDepth: false,
    autoClearStencil: false,
    opaque: false,
    transparent: false,
    contextNode: context({
      getAO: () => 'world AO',
    }),
    lighting: { name: 'world lighting' },
    getOutputRenderTarget: () => null,
    getDrawingBufferSize: size => size.set(96, 48),
    getRenderTarget: () => target,
    setRenderTarget: (value) => { target = value },
    getMRT: () => mrt,
    setMRT: (value) => { mrt = value },
    getClearColor: result => result.copy(clearColor),
    getClearAlpha: () => clearAlpha,
    setClearColor(color, alpha) {
      clearColor = new THREE.Color().set(color)
      clearAlpha = alpha
    },
    render,
  }
}

for (const fail of [false, true]) {
  test(`view pass clears independent HDR/depth and restores renderer state${fail ? ' after a render failure' : ''}`, () => {
    const layer = createViewModelLayer()
    layer.setEnabled(true)
    layer.scene.background = new THREE.Color(0xFFFFFF)
    const pass = new ViewModelPass(layer)
    const priorBackground = layer.scene.background
    const renderer = rendererStub((scene, camera) => {
      assert.equal(scene, layer.scene)
      assert.equal(camera, layer.camera)
      assert.equal(scene.background, null)
      assert.equal(renderer.getClearAlpha(), 0)
      assert.deepEqual(renderer.getClearColor(new THREE.Color()).toArray(), [0, 0, 0])
      assert.equal(renderer.contextNode.getFlowContextData().getAO(), null)
      assert.equal(renderer.getRenderTarget(), pass.renderTarget)
      assert.equal(pass.renderTarget.depthBuffer, true)
      assert.equal(pass.renderTarget.texture.type, THREE.HalfFloatType)
      assert.equal(renderer.autoClearDepth, true)
      if (fail)
        throw new Error('intentional render failure')
    })
    const before = {
      target: renderer.getRenderTarget(),
      mrt: renderer.getMRT(),
      context: renderer.contextNode,
      lighting: renderer.lighting,
      color: renderer.getClearColor(new THREE.Color()),
    }
    if (fail)
      assert.throws(() => pass.updateBefore({ renderer }), /intentional/)
    else pass.updateBefore({ renderer })
    assert.equal(renderer.getRenderTarget(), before.target)
    assert.equal(renderer.getMRT(), before.mrt)
    assert.equal(renderer.contextNode, before.context)
    assert.equal(renderer.lighting, before.lighting)
    assert.equal(renderer.autoClear, false)
    assert.equal(renderer.autoClearDepth, false)
    assert.equal(renderer.getClearAlpha(), 0.75)
    assert.ok(renderer.getClearColor(new THREE.Color()).equals(before.color))
    assert.equal(layer.scene.background, priorBackground)
    assert.equal(layer.scene.name, 'Viewmodel')
    assert.equal(pass.renderTarget.width, 96)
    assert.equal(pass.renderTarget.height, 48)
    let releases = 0
    pass.renderTarget.addEventListener('dispose', () => releases++)
    pass.dispose()
    pass.dispose()
    assert.equal(releases, 1)
    assert.equal(layer.enabled, true, 'pipeline disposal must not destroy the persistent layer')
    layer.dispose()
  })
}

test('pipeline replacement retains the viewmodel scene while allocating separate render targets', () => {
  const layer = createViewModelLayer()
  const root = new THREE.Object3D()
  layer.scene.add(root)
  layer.setEnabled(true)
  const renderer = { toneMapping: THREE.ReinhardToneMapping, outputColorSpace: THREE.SRGBColorSpace }
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera()
  const first = buildPipeline(renderer, scene, camera, { ...renderConfig, ao: false, aa: 'none' }, null, layer)
  const before = first.snapshot()
  const second = buildPipeline(renderer, scene, camera, {
    ...renderConfig,
    ao: false,
    aa: 'none',
    aoView: 'ao',
  }, null, layer)
  first.dispose()
  const after = second.snapshot()
  assert.equal(root.parent, layer.scene)
  assert.equal(layer.enabled, true)
  assert.notEqual(before.scene.id, before.viewmodel.id)
  assert.notEqual(before.viewmodel.id, after.viewmodel.id)
  assert.equal(after.viewmodel.depthBuffer, true)
  assert.equal(after.composite.depthBuffer, false)
  assert.equal(after.composite.type, THREE.HalfFloatType)
  second.dispose()
  layer.dispose()
})

test('viewmodel controls reject invalid projection, enable and lighting inputs', () => {
  const layer = createViewModelLayer()
  for (const value of [0, -1, 180, Number.NaN, Infinity])
    assert.throws(() => layer.setFov(value), /FOV/)
  for (const value of [0, -1, Number.NaN])
    assert.throws(() => layer.resize(value), /aspect/)
  assert.throws(() => layer.setEnabled(1), /boolean/)
  for (const value of [-1, Infinity, Number.NaN]) {
    assert.throws(() => layer.setLightIntensity(value), /intensity/)
    assert.throws(() => validateEffects({ ...renderConfig, viewmodelLightIntensity: value }), /viewmodelLightIntensity/)
  }
  for (const value of [0, 3, 32])
    assert.doesNotThrow(() => validateEffects({ ...renderConfig, viewmodelLightIntensity: value }))
  layer.dispose()
})
