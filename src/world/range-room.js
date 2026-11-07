import * as THREE from 'three/webgpu'
import { loadRoomAssets } from './room-assets.js'
import { createRoomLights } from './room-lights.js'
import { createEnvironmentProxy } from './sky-environment.js'

export const rangeRoomConfig = Object.freeze({
  manifestUrl: '/lighting/range-room-lightmap/manifest.json',
  textureAnisotropy: 16,
  atlasMaxMipLevel: 2,
  skyboxUrl: '/hdr/skybox-day.png',
  environmentIntensity: 0.35,
  corridorLighting: true,
})

/** Owns room content and loading; register dispose before awaiting load(). */
export function createRangeRoom({ scene, camera, resources, maxAnisotropy = 16, config = {} }) {
  const settings = {
    ...rangeRoomConfig,
    ...config,
  }
  settings.textureAnisotropy = Math.min(settings.textureAnisotropy, maxAnisotropy)
  const skyName = 'range-room:skybox-day'
  const previousEnvironment = scene.environment
  const previousBackground = scene.background
  const previousEnvironmentIntensity = scene.environmentIntensity
  const controller = new AbortController()
  let room = null
  let lights = null
  let skyLoaded = false
  let environmentProxy = null
  let disposed = false
  let loading = false

  const world = {
    async load() {
      if (loading || room || disposed)
        throw new Error('[Range room] Already loaded/loading or disposed; create a new room instance to reload')
      loading = true
      try {
        const result = await loadRoomAssets({
          resources,
          manifestUrl: settings.manifestUrl,
          signal: controller.signal,
          sampling: { anisotropy: settings.textureAnisotropy, atlasMaxMipLevel: settings.atlasMaxMipLevel },
        })
        if (disposed) {
          result.dispose()
          throw new DOMException('Room was disposed during loading', 'AbortError')
        }
        room = result
        scene.add(room.root)
        camera.position.fromArray(room.manifest.camera.position)
        camera.quaternion.fromArray(room.manifest.camera.quaternion)
        camera.fov = room.manifest.camera.fov
        camera.near = room.manifest.camera.near
        camera.far = room.manifest.camera.far
        camera.updateProjectionMatrix()
        await resources.load([
          {
            name: skyName,
            type: 'texture',
            url: settings.skyboxUrl,
          },
        ])
        controller.signal.throwIfAborted()
        const sky = resources.get(skyName, 'texture')
        sky.mapping = THREE.EquirectangularReflectionMapping
        sky.colorSpace = THREE.SRGBColorSpace
        scene.background = sky
        environmentProxy = createEnvironmentProxy(sky)
        scene.environment = environmentProxy
        scene.environmentIntensity = settings.environmentIntensity
        skyLoaded = true
        lights = createRoomLights(room.manifest, { corridorLighting: settings.corridorLighting, environmentLoaded: skyLoaded })
        scene.add(lights.root)
        if (lights.corridor.points.length)
          room.enableCorridorLighting(lights.corridor)
        return room
      }
      catch (error) {
        world.dispose()
        throw error
      }
      finally {
        loading = false
      }
    },
    setCorridorLighting(enabled) {
      if (!lights || disposed)
        throw new Error('[Range room] Room is not ready')
      lights.setCorridorEnabled(enabled)
    },
    setRuntimeLighting(enabled) {
      if (!lights || disposed)
        throw new Error('[Range room] Room is not ready')
      lights.setEnabled(enabled)
      scene.environmentIntensity = enabled ? settings.environmentIntensity : 0
    },
    snapshot() {
      return {
        ready: !!lights && !disposed,
        room: room?.manifest.id,
        lightingMode: room?.manifest.schemaVersion === 4
          ? 'lightmap'
          : 'baked-appearance',
        counts: room?.counts,
        atlasCount: room?.atlases.size,
        atlasBytes: room
          ? Array.from(room.atlases.values()).reduce((sum, atlas) => sum + atlas.mipmaps.reduce((bytes, mip) => bytes + mip.data.byteLength, 0), 0)
          : 0,
        bounds: room
          ? {
              min: room.bounds.min.toArray(),
              max: room.bounds.max.toArray(),
            }
          : null,
        lights: lights?.root.children.map(light => ({
          name: light.name,
          type: light.type,
          intensity: light.intensity,
        })),
        config: settings,
        skybox: skyLoaded ? settings.skyboxUrl : null,
        environmentSize: environmentProxy
          ? [environmentProxy.image.width, environmentProxy.image.height]
          : null,
        sampling: room
          ? {
              textureCount: room.samplers.snapshot().length,
              anisotropy: settings.textureAnisotropy,
              atlasMipLevels: Array.from(room.atlases.values(), atlas => atlas.mipmaps.length),
              atlasDecoders: Array.from(room.atlases.values(), atlas => atlas.userData.decode),
              atlasFilter: 'linear / trilinear',
              surfaceFilter: 'nearest (no interpolation)',
              surfaceAnisotropy: 1,
            }
          : null,
        lightCalibration: 'initial fit; RectAreaLight shadows/Spread unavailable; visual acceptance required',
      }
    },
    dispose() {
      if (disposed)
        return
      disposed = true
      controller.abort()
      lights?.dispose()
      room?.dispose()
      scene.background = previousBackground
      scene.environment = previousEnvironment
      scene.environmentIntensity = previousEnvironmentIntensity
      resources.unload(skyName)
      environmentProxy?.dispose()
    },
  }
  return world
}
