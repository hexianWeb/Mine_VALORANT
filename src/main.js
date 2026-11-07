import * as THREE from 'three/webgpu'
import { createDebugPanel } from './debug-panel.js'
import { Engine, ResourceManager } from './engine/index.js'
import { renderConfig } from './engine/systems/render/config.js'
import { createRenderSystem } from './engine/systems/render/index.js'
import { createRoomInspection } from './room-inspection.js'
import { createRangeRoom } from './world/range-room.js'
import './style.css'

const canvas = document.querySelector('.webgl')
const status = document.querySelector('.loading')
const unsupported = document.querySelector('.unsupported')
let engine = null
let cancelled = false

async function startRoom() {
  if (!navigator.gpu)
    throw new Error('当前浏览器不支持 WebGPU，请使用最新版 Chrome 或 Edge。')
  engine = new Engine({ maxPixelRatio: renderConfig.maxPixelRatio })
  const resources = engine.disposer.add(new ResourceManager())
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x161B24)
  const camera = new THREE.PerspectiveCamera(50, engine.size.aspect, 0.05, 400)
  const parameters = new URLSearchParams(location.search)
  const config = { ...renderConfig }
  config.trackTimestamp = parameters.get('profile') === '1'
  // Deterministic validation variants; the user-requested panel edits these same settings.
  if (parameters.get('ao') === '0')
    config.ao = false
  if (parameters.get('aa') === 'none')
    config.aa = 'none'
  const render = await createRenderSystem({
    engine,
    canvas,
    scene,
    camera,
    config,
  })
  if (cancelled) {
    render.dispose()
    return
  }
  engine.addSystem('render', render)
  const world = engine.disposer.add(createRangeRoom({
    scene,
    camera,
    resources,
    maxAnisotropy: render.renderer.getMaxAnisotropy(),
    config: parameters.get('lighting') === 'appearance'
      ? { manifestUrl: '/lighting/range-room/manifest.json' }
      : {},
  }))
  const room = await world.load()
  if (cancelled)
    return
  const inspection = engine.disposer.add(createRoomInspection({
    engine,
    scene,
    camera,
    canvas,
    renderer: render.renderer,
    room,
  }))
  const controls = inspection.orbit
  const panel = engine.disposer.add(createDebugPanel(render, document.querySelector('.debug-panel'), world.snapshot().lightingMode))
  const snapshot = () => {
    const renderState = render.snapshot()
    const worldState = world.snapshot()
    return {
      ...renderState,
      ...worldState,
      inspection: inspection.snapshot(),
      ready: renderState.ready && worldState.ready,
      config: {
        ...renderState.config,
        ...worldState.config,
      },
    }
  }
  // Runtime inspection/test surface.
  globalThis.__RANGE_ROOM__ = {
    engine,
    render,
    world,
    room,
    scene,
    camera,
    controls,
    inspection,
    panel,
    ready: true,
    snapshot,
    pickPixel(x, y) {
      const ray = new THREE.Raycaster()
      ray.setFromCamera(new THREE.Vector2(x / canvas.width * 2 - 1, 1 - y / canvas.height * 2), camera)
      const hit = ray.intersectObjects(scene.children, true)[0]
      return hit
        ? { mode: hit.object.material.userData.roomMode, name: hit.object.name }
        : null
    },
  }
  status.hidden = true
  engine.events.on('error', ({ error }) => showError(error))
  engine.start()
  console.debug('[Range room] loaded', snapshot())
}

function showError(error) {
  status.hidden = true
  unsupported.hidden = false
  unsupported.textContent = `练枪房加载失败：${error?.message ?? error}`
  console.error('[Range room]', error)
}

startRoom().catch((error) => {
  engine?.destroy()
  if (!cancelled)
    showError(error)
})

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    cancelled = true
    engine?.destroy()
    delete globalThis.__RANGE_ROOM__
  })
}
