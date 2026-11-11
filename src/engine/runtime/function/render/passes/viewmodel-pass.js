import { context, vec4 } from 'three/tsl'
import * as THREE from 'three/webgpu'

/** Render-owned stable layer. Game owns and disposes the visual roots attached to scene. */
export function createViewModelLayer({ aspect = 1, lightIntensity = 3 } = {}) {
  if (!Number.isFinite(aspect) || aspect <= 0)
    throw new RangeError('[Viewmodel] aspect must be positive and finite')
  if (!Number.isFinite(lightIntensity) || lightIntensity < 0)
    throw new RangeError('[Viewmodel] light intensity must be nonnegative and finite')
  const scene = new THREE.Scene()
  scene.name = 'Viewmodel'
  const camera = new THREE.PerspectiveCamera(70, aspect, 0.005, 10)
  const light = new THREE.AmbientLight(0xFFFFFF, lightIntensity)
  light.name = 'Viewmodel ambient'
  scene.add(light)
  scene.visible = false
  let enabled = false
  let disposed = false
  const assertLive = () => {
    if (disposed)
      throw new Error('[Viewmodel] Layer is disposed')
  }
  return Object.freeze({
    scene,
    camera,
    get enabled() { return enabled },
    setEnabled(value) {
      assertLive()
      if (typeof value !== 'boolean')
        throw new TypeError('[Viewmodel] enabled must be a boolean')
      enabled = value
      scene.visible = value
    },
    setFov(degrees) {
      assertLive()
      if (!Number.isFinite(degrees) || degrees <= 0 || degrees >= 180)
        throw new RangeError('[Viewmodel] FOV must be between 0 and 180 degrees')
      camera.fov = degrees
      camera.updateProjectionMatrix()
    },
    resize(nextAspect) {
      assertLive()
      if (!Number.isFinite(nextAspect) || nextAspect <= 0)
        throw new RangeError('[Viewmodel] aspect must be positive and finite')
      camera.aspect = nextAspect
      camera.updateProjectionMatrix()
    },
    setLightIntensity(value) {
      assertLive()
      if (!Number.isFinite(value) || value < 0)
        throw new RangeError('[Viewmodel] light intensity must be nonnegative and finite')
      light.intensity = value
    },
    dispose() {
      if (disposed)
        return
      disposed = true
      enabled = false
      scene.visible = false
      scene.clear()
      light.dispose()
    },
  })
}

/** Both render targets contain linear premultiplied RGB; do not multiply view RGB twice. */
export function compositeViewModel(world, view) {
  return vec4(
    view.rgb.add(world.rgb.mul(view.a.oneMinus())),
    view.a.add(world.a.mul(view.a.oneMinus())),
  )
}

/** Independent depth and transparent HDR. Ordinary transparent blending yields premultiplied pixels. */
export class ViewModelPass extends THREE.PassNode {
  constructor(layer) {
    super(THREE.PassNode.COLOR, layer.scene, layer.camera, { samples: 0, depthBuffer: true })
    this.name = 'Viewmodel HDR color'
    this.layer = layer
    this.lighting = new THREE.Lighting()
    this.contextNode = context({
      getAO: () => null,
    })
    this.disposed = false
  }

  updateBefore(frame) {
    if (this.disposed)
      return
    const { renderer } = frame
    const color = renderer.getClearColor(new THREE.Color())
    const alpha = renderer.getClearAlpha()
    const previousTarget = renderer.getRenderTarget()
    const previousMRT = renderer.getMRT()
    const rendererState = {}
    for (const key of [
      'autoClear',
      'autoClearColor',
      'autoClearDepth',
      'autoClearStencil',
      'transparent',
      'opaque',
      'lighting',
      'contextNode',
    ])
      rendererState[key] = renderer[key]
    const sceneState = {
      background: this.scene.background,
      backgroundNode: this.scene.backgroundNode,
      overrideMaterial: this.scene.overrideMaterial,
      name: this.scene.name,
      visible: this.scene.visible,
    }
    const cameraMask = this.camera.layers.mask
    try {
      renderer.setClearColor(0x000000, 0)
      this.scene.background = null
      this.scene.backgroundNode = null
      this.scene.visible = this.layer.enabled
      super.updateBefore(frame)
    }
    finally {
      renderer.setRenderTarget(previousTarget)
      renderer.setMRT(previousMRT)
      Object.assign(renderer, rendererState)
      Object.assign(this.scene, sceneState)
      this.camera.layers.mask = cameraMask
      renderer.setClearColor(color, alpha)
    }
  }

  dispose() {
    if (this.disposed)
      return
    this.disposed = true
    this.lighting.dispose()
    super.dispose()
  }
}
