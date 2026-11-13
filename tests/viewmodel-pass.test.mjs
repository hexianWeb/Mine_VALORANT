import assert from 'node:assert/strict'
import test from 'node:test'
import { LightProbeGrid } from 'three/addons/lighting/LightProbeGrid.js'
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

test('world-space lighting preserves camera-local weapon poses and the independent projection', () => {
  const layer = createViewModelLayer()
  const world = new THREE.Scene()
  const rig = new THREE.Group()
  rig.position.set(5, 7, -3)
  rig.rotation.set(0.1, 0.7, 0)
  // The world camera need not belong to a Scene.
  const camera = new THREE.PerspectiveCamera(90, 2, 0.1, 400)
  rig.add(camera)
  camera.position.set(1, 2, 3)
  camera.rotation.set(-0.2, 0.4, 0)
  const root = new THREE.Object3D()
  root.position.set(0.3, -0.6, -1)
  root.rotation.set(0.2, -0.1, 0.3)
  root.updateMatrix()
  const local = root.matrix.clone()
  layer.scene.add(root)
  layer.setFov(45)
  const projection = layer.camera.projectionMatrix.clone()
  world.environment = new THREE.Texture()
  world.environmentIntensity = 0.35
  world.environmentRotation.set(0, 0.5, 0)
  const light = new THREE.RectAreaLight(0xFFEEDD, 4, 3, 8)
  world.add(light)
  const grid = new LightProbeGrid(10, 6, 10, 2, 2, 2)
  grid.position.set(5, 7, -3)
  grid.updateBoundingBox()
  world.add(grid)
  const bounds = grid.boundingBox.clone()
  const hidden = new THREE.Group()
  hidden.visible = false
  hidden.add(new THREE.PointLight())
  world.add(hidden)
  const excluded = new THREE.PointLight()
  excluded.layers.set(3)
  world.add(excluded)
  const pass = new ViewModelPass(layer, world, camera)
  pass.syncWorldLighting()
  layer.scene.updateMatrixWorld(true)
  layer.camera.updateMatrixWorld(true)
  const renderedLocal = layer.camera.matrixWorldInverse.clone().multiply(root.matrixWorld)
  for (let i = 0; i < 16; i++) assert.ok(Math.abs(renderedLocal.elements[i] - local.elements[i]) < 1e-12)
  assert.deepEqual(root.position.toArray(), [0.3, -0.6, -1])
  assert.deepEqual(layer.camera.projectionMatrix.elements, projection.elements)
  assert.equal(layer.camera.near, 0.005)
  assert.equal(layer.camera.far, 10)
  assert.equal(layer.scene.environment, world.environment)
  assert.equal(layer.scene.environmentIntensity, 0.35)
  assert.ok(layer.scene.environmentRotation.equals(world.environmentRotation))
  assert.deepEqual(pass.worldLights, [light, grid])
  assert.equal(light.parent, world)
  assert.equal(grid.parent, world)
  assert.ok(grid.boundingBox.equals(bounds))
  assert.notEqual(layer.camera, camera)
  let released = 0
  for (const resource of [world.environment, light, grid])
    resource.addEventListener('dispose', () => released++)
  pass.dispose()
  layer.dispose()
  assert.equal(released, 0, 'borrowed world lights, probe atlases and environment belong to the world')
  grid.dispose()
  light.dispose()
  world.environment.dispose()
})

test('borrowed lights follow visibility, removal and cached lighting restores without stale entries', () => {
  const world = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera()
  const layer = createViewModelLayer()
  const local = layer.scene.children.find(child => child.isAmbientLight)
  const pass = new ViewModelPass(layer, world, camera)
  const node = pass.lighting.getNode(layer.scene)
  const previous = new THREE.PointLight()
  world.add(previous)
  pass.syncWorldLighting()
  node.setLights([local])
  assert.deepEqual(new Set(node.getLights()), new Set([local, previous]))
  for (let index = 0; index < 4; index++) {
    pass.lighting.beginRender(layer.scene)
    world.clear()
    const current = new THREE.PointLight()
    world.add(current)
    pass.syncWorldLighting()
    node.setLights([local])
    pass.lighting.finishRender(layer.scene)
    assert.deepEqual(new Set(node.getLights()), new Set([local, current]))
    current.visible = false
    pass.syncWorldLighting()
    node.setLights(node.getLights())
    assert.deepEqual(node.getLights(), [local])
    current.dispose()
  }
  previous.dispose()
  pass.dispose()
  layer.dispose()
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
