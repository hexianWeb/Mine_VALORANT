import { context, vec4 } from 'three/tsl'
import * as THREE from 'three/webgpu'

/** Add borrowed world lights without reparenting them or duplicating probe atlases. */
class ViewModelLightsNode extends THREE.LightsNode {
  constructor(getWorldLights) {
    super()
    this.getWorldLights = getWorldLights
    this.borrowed = new WeakSet()
  }

  setLights(lights) {
    // Lighting.beginRender/finishRender restore earlier arrays. Strip previously borrowed
    // entries first, so removed/hidden world lights cannot accumulate in that cache.
    const world = this.getWorldLights()
    for (const light of world) this.borrowed.add(light)
    const local = lights.filter(light => !this.borrowed.has(light))
    const combined = new Set([
      ...local,
      ...world,
    ])
    return super.setLights(Array.from(combined))
  }
}

class ViewModelLighting extends THREE.Lighting {
  constructor(getWorldLights) {
    super()
    this.getWorldLights = getWorldLights
  }

  createNode() {
    return new ViewModelLightsNode(this.getWorldLights)
  }
}

/** Render-owned stable layer. Game owns and disposes the visual roots attached to scene. */
export function createViewModelLayer({ aspect = 1, lightIntensity = 0.18 } = {}) {
  if (!Number.isFinite(aspect) || aspect <= 0)
    throw new RangeError('[Viewmodel] aspect must be positive and finite')
  if (!Number.isFinite(lightIntensity) || lightIntensity < 0)
    throw new RangeError('[Viewmodel] light intensity must be nonnegative and finite')
  const scene = new THREE.Scene()
  scene.name = 'Viewmodel'
  const camera = new THREE.PerspectiveCamera(70, aspect, 0.005, 10)
  const light = new THREE.AmbientLight(0xFFFFFF, lightIntensity)
  light.name = 'Viewmodel readability fill'
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
      scene.environment = null // Borrowed from the world; never dispose it here.
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
  constructor(layer, worldScene = null, worldCamera = null) {
    super(THREE.PassNode.COLOR, layer.scene, layer.camera, { samples: 0, depthBuffer: true })
    this.name = 'Viewmodel HDR color'
    this.layer = layer
    this.worldScene = worldScene
    this.worldCamera = worldCamera
    this.worldLights = []
    this.lighting = new ViewModelLighting(() => this.worldLights)
    this.contextNode = context({
      getAO: () => null,
    })
    this.disposed = false
  }

  syncWorldLighting() {
    if (!this.worldScene || !this.worldCamera)
      return
    this.worldCamera.updateWorldMatrix(true, false)
    // Keep the game-owned roots camera-local, but render their actual world-space positions
    // and normals. Probe bounds, light directions and environment reflections then agree
    // with the room, while the view camera retains its independent FOV and depth range.
    this.worldCamera.matrixWorld.decompose(this.scene.position, this.scene.quaternion, this.scene.scale)
    this.camera.position.copy(this.scene.position)
    this.camera.quaternion.copy(this.scene.quaternion)
    this.camera.scale.copy(this.scene.scale)
    this.scene.environment = this.worldScene.environment
    this.scene.environmentIntensity = this.worldScene.environmentIntensity
    this.scene.environmentRotation.copy(this.worldScene.environmentRotation)
    this.worldLights.length = 0
    this.worldScene.traverseVisible((object) => {
      if (!object.isLight || !this.worldCamera.layers.test(object.layers))
        return
      object.updateWorldMatrix(true, false)
      object.target?.updateWorldMatrix(true, false)
      this.worldLights.push(object)
    })
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
      this.syncWorldLighting()
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
    this.worldLights.length = 0
    super.dispose()
  }
}
