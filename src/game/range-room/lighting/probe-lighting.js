import { LightProbeGridHelper } from 'three/addons/helpers/LightProbeGridHelper.js'
import { LightProbeGrid } from 'three/addons/lighting/LightProbeGrid.js'
import * as THREE from 'three/webgpu'
import { nextFrame } from '../../../engine/runtime/platform/next-frame.js'
import { atlasLayout, probeCaptureDefaults, probeLightingDefaults, probeSourceKey, readProbeAtlas, sha256, uploadProbeAtlas, validateCapture, validateProbeVolumes } from './probe-data.js'
import { createProbeEnvironment } from './probe-environment.js'
import { createRoomLights } from './room-lights.js'

const sameCapture = (a, b) => !!a && Object.keys(probeCaptureDefaults).every(key => a[key] === b[key])

function makeGrid(volume) {
  const grid = new LightProbeGrid(...volume.max.map((value, i) => value - volume.min[i]), ...volume.resolution)
  grid.name = volume.id
  grid.position.fromArray(volume.min.map((value, i) => (value + volume.max[i]) / 2))
  grid.priority = volume.priority
  grid.updateBoundingBox()
  return grid
}

/** Separate static scene: no inspection prop, shadow key, LPV markers, AO or grading. */
function makeCaptureScene(room, scene) {
  const captureScene = new THREE.Scene()
  captureScene.background = scene.background
  captureScene.environment = scene.environment
  captureScene.backgroundRotation.copy(scene.backgroundRotation)
  captureScene.environmentRotation.copy(scene.environmentRotation)
  const root = room.root.clone(true)
  const materials = new Map()
  const fixtures = []
  root.traverse((object) => {
    if (!object.isMesh)
      return
    const source = object.material
    if (!materials.has(source)) {
      let material
      if (source.isMeshPhysicalNodeMaterial) {
        // r187 NodeMaterial.copy visits the deprecated iridescenceThicknessRange
        // accessor. The PBR copy path uses its current minimum/maximum properties.
        material = new THREE.MeshPhysicalNodeMaterial()
        THREE.MeshPhysicalMaterial.prototype.copy.call(material, source)
        for (const key of Object.keys(source)) {
          if (key.endsWith('Node'))
            material[key] = source[key]
        }
      }
      else {
        material = source.clone()
      }
      materials.set(source, material)
      if (source.userData.roomMode === 'fixture-emissive') {
        fixtures.push({
          material,
          color: source.color.clone(),
        })
      }
    }
    object.material = materials.get(source)
    object.castShadow = false
    object.receiveShadow = false
  })
  const lights = createRoomLights(room.manifest, { environmentLoaded: true })
  captureScene.add(root, lights.root)
  return {
    scene: captureScene,
    configure(config) {
      captureScene.backgroundIntensity = config.sky
      captureScene.environmentIntensity = config.sky
      lights.setIntensityScale(config.direct)
      // Black source faces still occlude; hiding them would open holes in the ceiling.
      for (const fixture of fixtures)
        fixture.material.color.copy(fixture.color).multiplyScalar(config.emissive)
    },
    dispose() {
      lights.dispose()
      for (const material of materials.values())
        material.dispose()
      captureScene.clear()
    },
  }
}

/** Owns volume lights, stable atlas textures, static capture scene and visual controls. */
export async function createProbeLighting({ scene, renderer, room, lights, skyboxUrl, signal, onProgress, url = '/lighting/range-room-probes/volumes.json' }) {
  const base = new URL(url, globalThis.location.href)
  const response = await fetch(base, { signal })
  if (!response.ok)
    throw new Error(`[Probes] Volume manifest HTTP ${response.status}`)
  const definitions = validateProbeVolumes(await response.json())
  signal?.throwIfAborted()
  const sourceKey = probeSourceKey(room.manifest, definitions, skyboxUrl)
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  const root = new THREE.Group()
  root.name = 'LightProbeVolumes'
  const lightRoot = new THREE.Group()
  const helperRoot = new THREE.Group()
  root.add(lightRoot, helperRoot)
  scene.add(root)
  const environment = createProbeEnvironment()
  const capture = makeCaptureScene(room, scene)
  environment.bindRoot(room.root)
  const settings = { ...probeLightingDefaults }
  const captureSettings = { ...probeCaptureDefaults }
  const subscribers = new Set()
  const volumes = definitions.map((definition, i) => {
    const grid = makeGrid(definition)
    lightRoot.add(grid)
    const bounds = new THREE.Box3Helper(grid.boundingBox, [0x39C8E8, 0xE8AB39, 0x83D76B][i % 3])
    bounds.name = `${definition.id}:bounds`
    bounds.material.depthTest = false
    bounds.material.transparent = true
    bounds.material.opacity = 0.7
    bounds.raycast = () => {}
    bounds.userData.probeHelper = true
    const helper = new LightProbeGridHelper(grid, 0.16)
    helper.name = `${definition.id}:samples`
    helper.raycast = () => {}
    helper.userData.probeHelper = true
    helperRoot.add(bounds, helper)
    return {
      definition,
      grid,
      bounds,
      helper,
      bakeGrid: null,
      intensity: 1,
      data: null,
    }
  })
  let runtimeEnabled = true
  let disposed = false
  let ready = false
  let busy = false
  let progress = 0
  let source = 'pending'
  let lastCapture = null
  let lastBakeMs = null
  let error = null
  const total = definitions.reduce((sum, v) => sum + v.resolution.reduce((a, b) => a * b, 1), 0)
  const apply = () => {
    lightRoot.visible = settings.enabled && runtimeEnabled && ready
    for (const volume of volumes) {
      volume.grid.intensity = settings.intensity * volume.intensity
      volume.bounds.visible = settings.showBounds
      volume.helper.visible = settings.showProbes && ready
    }
    environment.update(settings.skyDiffuse, settings.skySpecular)
    lights.setIntensityScale(settings.direct)
  }
  const assertReady = () => {
    if (disposed)
      throw new Error('[Probes] Already disposed')
  }
  let api
  const emit = () => {
    const state = api.getDebugState()
    onProgress?.(state)
    for (const listener of subscribers)
      listener(state)
  }
  api = {
    root,
    bindRoot: root => environment.bindRoot(root),
    getDebugState() {
      return {
        ...settings,
        capture: { ...captureSettings },
        volumes: volumes.map(v => ({
          ...v.definition,
          intensity: v.intensity,
          probes: v.grid.resolution.x * v.grid.resolution.y * v.grid.resolution.z,
          atlasBytes: atlasLayout(v.definition.resolution).bytes,
        })),
        ready,
        busy,
        progress,
        dirty: !sameCapture(lastCapture, captureSettings),
        source,
        total,
        lastBakeMs,
        lastCapture: lastCapture
          ? { ...lastCapture }
          : null,
        error,
      }
    },
    subscribe(listener) {
      subscribers.add(listener)
      return () => subscribers.delete(listener)
    },
    setLighting(changes) {
      assertReady()
      for (const [key, value] of Object.entries(changes)) {
        if (!(key in probeLightingDefaults) || (typeof probeLightingDefaults[key] === 'boolean'
          ? typeof value !== 'boolean'
          : !Number.isFinite(value) || value < 0 || value > 4)) {
          throw new Error(`[Probes] Invalid lighting ${key}`)
        }
      }
      Object.assign(settings, changes)
      apply()
      emit()
    },
    setVolumeIntensity(id, value) {
      assertReady()
      const volume = volumes.find(v => v.definition.id === id)
      if (!volume || !Number.isFinite(value) || value < 0 || value > 4)
        throw new Error('[Probes] Invalid volume intensity')
      volume.intensity = value
      apply()
      emit()
    },
    setRuntimeEnabled(value) {
      runtimeEnabled = !!value
      apply()
    },
    setCapture(changes) {
      assertReady()
      if (busy)
        throw new Error('[Probes] Wait for the current capture')
      if (Object.keys(changes).some(key => !(key in probeCaptureDefaults)))
        throw new Error('[Probes] Unknown capture option')
      const next = {
        ...captureSettings,
        ...changes,
      }
      validateCapture(next)
      Object.assign(captureSettings, next)
      emit()
    },
    reset() {
      assertReady()
      if (busy)
        throw new Error('[Probes] Wait for the current capture')
      Object.assign(settings, probeLightingDefaults)
      Object.assign(captureSettings, probeCaptureDefaults)
      error = null
      for (const volume of volumes)
        volume.intensity = 1
      apply()
      emit()
    },
    async rebake() {
      assertReady()
      if (busy)
        throw new Error('[Probes] Capture is already running')
      busy = true
      progress = 0
      error = null
      const config = { ...captureSettings }
      const started = performance.now()
      const data = []
      capture.configure(config)
      emit()
      try {
        let complete = 0
        for (const volume of volumes) {
          volume.bakeGrid ??= makeGrid(volume.definition)
          const count = volume.definition.resolution.reduce((a, b) => a * b, 1)
          for (let start = 0; start < count; start += 8) {
            await nextFrame(controller.signal)
            controller.signal.throwIfAborted()
            const previous = { toneMapping: renderer.toneMapping, outputColorSpace: renderer.outputColorSpace }
            try {
              renderer.toneMapping = THREE.NoToneMapping
              renderer.outputColorSpace = THREE.LinearSRGBColorSpace
              volume.bakeGrid.bake(renderer, capture.scene, {
                cubemapSize: config.cubemapSize,
                near: 0.05,
                far: 160,
                start,
                count: Math.min(8, count - start),
                bounces: 0,
              })
            }
            finally {
              Object.assign(renderer, previous)
            }
            complete += Math.min(8, count - start)
            progress = complete / total
            emit()
          }
          data.push(await readProbeAtlas(renderer, volume.bakeGrid, controller.signal))
        }
        controller.signal.throwIfAborted()
        // Commit in one synchronous turn; restore every atlas if any upload fails.
        try {
          for (const [index, volume] of volumes.entries())
            uploadProbeAtlas(renderer, volume.grid, data[index])
        }
        catch (caught) {
          for (const volume of volumes) {
            if (volume.data)
              uploadProbeAtlas(renderer, volume.grid, volume.data)
          }
          throw caught
        }
        for (const [index, volume] of volumes.entries())
          volume.data = data[index]
        ready = true
        lastCapture = config
        lastBakeMs = performance.now() - started
        source = 'live-capture'
        apply()
      }
      catch (caught) {
        error = caught.message
        throw caught
      }
      finally {
        busy = false
        if (!disposed)
          emit()
      }
      return api.getDebugState()
    },
    exportData() {
      assertReady()
      if (!ready || busy)
        throw new Error('[Probes] A completed capture is required')
      return {
        version: 1,
        sourceKey,
        capture: { ...lastCapture },
        volumes: volumes.map(v => ({
          id: v.definition.id,
          data: Array.from(v.data),
        })),
      }
    },
    dispose() {
      if (disposed)
        return
      disposed = true
      controller.abort()
      signal?.removeEventListener('abort', onAbort)
      subscribers.clear()
      root.removeFromParent()
      environment.dispose()
      capture.dispose()
      for (const volume of volumes) {
        volume.helper.dispose()
        volume.bounds.geometry.dispose()
        volume.bounds.material.dispose()
        volume.grid.dispose()
        volume.bakeGrid?.dispose()
        volume.data = null
      }
      root.clear()
    },
  }
  apply()
  try {
    const cacheURL = new URL('./cache.json', base)
    const cached = await fetch(cacheURL, { signal: controller.signal })
    if (cached.ok) {
      const cache = await cached.json()
      if (cache.version === 1 && cache.sourceKey === sourceKey && sameCapture(cache.capture, captureSettings)) {
        const bytesResponse = await fetch(new URL(cache.url, cacheURL), { signal: controller.signal })
        if (!bytesResponse.ok)
          throw new Error(`[Probes] SH cache HTTP ${bytesResponse.status}`)
        const bytes = await bytesResponse.arrayBuffer()
        if (await sha256(bytes) !== cache.sha256)
          throw new Error('[Probes] SH cache hash mismatch')
        controller.signal.throwIfAborted()
        for (const volume of volumes) {
          const entry = cache.volumes.find(v => v.id === volume.definition.id)
          const expected = atlasLayout(volume.definition.resolution).bytes
          if (!entry || entry.bytes !== expected || !Number.isInteger(entry.offset) || entry.offset % 2 || entry.offset < 0 || entry.offset + expected > bytes.byteLength)
            throw new Error('[Probes] Invalid SH cache layout')
          volume.data = new Uint16Array(bytes.slice(entry.offset, entry.offset + expected))
          uploadProbeAtlas(renderer, volume.grid, volume.data)
        }
        ready = true
        source = 'precomputed'
        lastCapture = { ...cache.capture }
        progress = 1
        apply()
        emit()
      }
    }
    else if (cached.status !== 404) {
      throw new Error(`[Probes] Cache manifest HTTP ${cached.status}`)
    }
    if (!ready)
      await api.rebake()
    return api
  }
  catch (caught) {
    api.dispose()
    throw caught
  }
}
