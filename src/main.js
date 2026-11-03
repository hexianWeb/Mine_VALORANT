import * as THREE from 'three/webgpu'
import { Pane } from 'tweakpane'
import { Engine } from './engine/index.js'
import { createNodeMaterial } from './material.js'
import './style.css'

const canvas = document.querySelector('.webgl')
const panelElement = document.querySelector('.debug-panel')
const unsupportedElement = document.querySelector('.unsupported')

async function createGame() {
  if (!navigator.gpu) {
    canvas.hidden = true
    panelElement.hidden = true
    unsupportedElement.hidden = false
    return null
  }

  const engine = new Engine()

  const scene = new THREE.Scene()
  const params = {
    background: '#0d1117',
    colorTop: '#7c3aed',
    colorBottom: '#22d3ee',
    metalness: 0.65,
    roughness: 0.22,
    rotationSpeed: 0.35,
    wireframe: false,
  }
  scene.background = new THREE.Color(params.background)

  const camera = new THREE.PerspectiveCamera(45, engine.size.aspect, 0.1, 100)
  camera.position.set(0, 0, 4.5)

  const geometry = new THREE.TorusKnotGeometry(1, 0.3, 192, 32)
  const { material, uniforms } = createNodeMaterial({
    colorTop: params.colorTop,
    colorBottom: params.colorBottom,
    metalness: params.metalness,
    roughness: params.roughness,
  })
  const mesh = new THREE.Mesh(geometry, material)
  scene.add(mesh)

  scene.add(new THREE.HemisphereLight('#ffffff', '#172033', 1.8))
  const keyLight = new THREE.DirectionalLight('#ffffff', 4)
  keyLight.position.set(3, 4, 5)
  scene.add(keyLight)

  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    canvas,
    forceWebGL: false,
  })
  renderer.setPixelRatio(engine.size.pixelRatio)
  renderer.setSize(engine.size.width, engine.size.height)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.15
  await renderer.init()

  const pane = engine.disposer.add(new Pane({
    container: panelElement,
    title: 'WebGPU Render',
  }))

  const appearanceFolder = pane.addFolder({ title: 'Appearance' })
  appearanceFolder.addBinding(params, 'colorTop', { label: 'Top color' })
    .on('change', ({ value }) => uniforms.colorTop.value.set(value))
  appearanceFolder.addBinding(params, 'colorBottom', { label: 'Bottom color' })
    .on('change', ({ value }) => uniforms.colorBottom.value.set(value))
  appearanceFolder.addBinding(params, 'metalness', {
    label: 'Metalness',
    min: 0,
    max: 1,
    step: 0.01,
  })
    .on('change', ({ value }) => { uniforms.metalness.value = value })
  appearanceFolder.addBinding(params, 'roughness', {
    label: 'Roughness',
    min: 0,
    max: 1,
    step: 0.01,
  })
    .on('change', ({ value }) => { uniforms.roughness.value = value })
  appearanceFolder.addBinding(params, 'wireframe', { label: 'Wireframe' })
    .on('change', ({ value }) => {
      material.wireframe = value
      material.needsUpdate = true
    })

  const sceneFolder = pane.addFolder({ title: 'Scene' })
  sceneFolder.addBinding(params, 'background', { label: 'Background' })
    .on('change', ({ value }) => scene.background.set(value))
  sceneFolder.addBinding(params, 'rotationSpeed', {
    label: 'Rotation',
    min: 0,
    max: 2,
    step: 0.01,
  })
  sceneFolder.addBinding(engine.time, 'timeScale', {
    label: 'Time scale',
    min: 0,
    max: 3,
    step: 0.01,
  })

  engine.addSystem('gameplay', {
    name: 'spin',
    update: ({ time }) => {
      mesh.rotation.x = time.elapsed * params.rotationSpeed * 0.35
      mesh.rotation.y = time.elapsed * params.rotationSpeed
    },
  })

  const offResize = engine.size.on('resize', ({ width, height, pixelRatio, aspect }) => {
    camera.aspect = aspect
    camera.updateProjectionMatrix()
    renderer.setPixelRatio(pixelRatio)
    renderer.setSize(width, height)
  })

  engine.addSystem('render', {
    name: 'render',
    update: () => renderer.render(scene, camera),
    dispose: () => {
      offResize()
      geometry.dispose()
      material.dispose()
      renderer.dispose()
    },
  })

  engine.start()
  return engine
}

let engine = null

createGame()
  .then((created) => { engine = created })
  .catch((error) => {
    console.error(error)
    canvas.hidden = true
    panelElement.hidden = true
    unsupportedElement.hidden = false
    unsupportedElement.textContent = 'WebGPU 初始化失败，请检查浏览器与显卡支持。'
  })

if (import.meta.hot) {
  import.meta.hot.dispose(() => engine?.destroy())
}
