import * as THREE from 'three/webgpu'
import { Disposer } from '../../engine/runtime/core/disposer.js'
import { GameObject, Level, MeshComponent, TransformComponent } from '../../engine/runtime/function/framework/index.js'
import { createEnvironmentProxy } from '../../engine/runtime/function/render/sky-environment.js'
import { createPlayer, PlayerComponent } from '../player/player.js'
import { WeaponAssets } from '../weapons/assets/weapon-assets.js'
import { classicDefinition } from '../weapons/definitions/classic.js'
import { loadRoomAssets } from './assets/room-assets.js'
import { loadCollisionLayer } from './collision.js'
import { rangeRoomConfig } from './config.js'
import { createFloatingTeapot } from './floating-teapot.js'
import { createRoomGround, roomGroundTextures } from './ground.js'
import { createProbeLighting } from './lighting/probe-lighting.js'
import { loadRoomReflection } from './lighting/reflection-probe.js'
import { createRoomLights } from './lighting/room-lights.js'
import { createRoomShadows } from './lighting/room-shadows.js'

/** A complete level, usable without editor UI and without a renderer for asset-only loading. */
export class RangeRoomLevel extends Level {
  room = null
  lights = null
  ground = null
  probes = null
  collision = null
  player = null
  teapot = null
  shadows = null
  environmentProxy = null
  reflection = null
  ready = false
  #loading = false
  #probesLoading = false
  #weaponAssets = null
  #controller = new AbortController()
  #bindings = new Disposer()

  constructor({ scene, camera, resources, input = null, physics = null, render = null, audio = null, maxAnisotropy = 16, config = {} }) {
    super({ scene })
    this.camera = camera
    this.resources = resources
    this.input = input
    this.physics = physics
    this.render = render
    this.audio = audio
    this.settings = {
      ...rangeRoomConfig,
      ...config,
    }
    this.settings.textureAnisotropy = Math.min(this.settings.textureAnisotropy, maxAnisotropy)
    const previous = {
      background: scene.background,
      environment: scene.environment,
      environmentIntensity: scene.environmentIntensity,
    }
    this.disposer.add(() => Object.assign(scene, previous))
  }

  async load({ signal, onProgress } = {}) {
    if (this.#loading || this.room || this.disposed)
      throw new Error('[RangeRoomLevel] Already loaded/loading or disposed; create a new level to reload')
    this.#loading = true
    const token = signal
      ? AbortSignal.any([signal, this.#controller.signal])
      : this.#controller.signal
    const { scene, camera, resources, settings } = this
    try {
      token.throwIfAborted()
      this.room = await loadRoomAssets({
        resources,
        manifestUrl: settings.manifestUrl,
        signal: token,
        sampling: { anisotropy: settings.textureAnisotropy, atlasMaxMipLevel: settings.atlasMaxMipLevel },
      })
      if (token.aborted) {
        this.room.dispose()
        token.throwIfAborted()
      }
      const room = this.room
      this.#addMesh('Room', room)
      camera.position.fromArray(room.manifest.camera.position)
      camera.quaternion.fromArray(room.manifest.camera.quaternion)
      for (const key of ['fov', 'near', 'far']) camera[key] = room.manifest.camera[key]
      camera.updateProjectionMatrix()
      const skyName = 'range-room:skybox-day'
      this.disposer.add(() => {
        resources.unload(skyName)
        for (const texture of roomGroundTextures) resources.unload(texture.name)
      })
      await resources.load([
        { name: skyName, type: 'texture', url: settings.skyboxUrl },
        ...roomGroundTextures,
      ], { signal: token })
      token.throwIfAborted()
      const sky = resources.get(skyName, 'texture')
      sky.mapping = THREE.EquirectangularReflectionMapping
      sky.colorSpace = THREE.SRGBColorSpace
      scene.background = sky
      this.environmentProxy = this.disposer.add(createEnvironmentProxy(sky))
      scene.environment = this.environmentProxy
      scene.environmentIntensity = settings.environmentIntensity
      this.lights = this.disposer.add(createRoomLights(room.manifest, { environmentLoaded: true }))
      scene.add(this.lights.root)
      this.ground = createRoomGround({
        bounds: room.bounds,
        quartzTexture: resources.get(roomGroundTextures[0].name, 'texture'),
        grassTexture: resources.get(roomGroundTextures[1].name, 'texture'),
        environment: this.environmentProxy,
        anisotropy: settings.textureAnisotropy,
      })
      this.#addMesh('Ground', this.ground)
      camera.far = Math.max(camera.far, this.ground.viewDistance)
      camera.updateProjectionMatrix()
      if (this.render && settings.probes && room.manifest.schemaVersion === 4)
        await this.loadProbes(this.render.renderer, onProgress, token)
      if (this.render && room.manifest.schemaVersion === 4) {
        try {
          this.reflection = this.disposer.add(await loadRoomReflection({
            renderer: this.render.renderer,
            room,
            skyboxUrl: settings.skyboxUrl,
            signal: token,
            preview: settings.reflectionPreview,
          }))
          if (this.reflection.preview)
            scene.add(this.reflection.preview.root)
        }
        catch (error) {
          token.throwIfAborted()
          console.warn('[Range room] Indoor reflection unavailable; using sky', error)
        }
      }
      token.throwIfAborted()
      if (this.input && this.physics) {
        try {
          this.collision = await loadCollisionLayer({
            ground: this.ground.snapshot(),
            signal: token,
          })
        }
        catch (error) {
          token.throwIfAborted()
          console.error('[Range room] Collision layer unavailable; observation only', error)
        }
        token.throwIfAborted()
        if (this.collision) {
          let weapons = null
          if (this.render?.viewmodel) {
            const assets = this.disposer.add(new WeaponAssets({
              resources,
              scopeId: 'range-room-weapons',
              signal: token,
              audio: this.audio,
              reflectionTexture: this.reflection?.texture,
            }))
            this.#weaponAssets = assets
            assets.setReflectionEnabled(this.lights.root.visible)
            weapons = { assets, layer: this.render.viewmodel, audio: this.audio }
            // Prewarm shared data only. VisualPrepared requires motion ticks after load completes.
            const initial = classicDefinition.assets
            await assets.load({ weaponId: initial.modelId, assetVersion: initial.assetVersion, skinId: initial.defaultSkinId }).catch((error) => {
              token.throwIfAborted()
              console.error('[Range room] Initial weapon unavailable; select its slot to retry', error)
            })
            token.throwIfAborted()
          }
          const playerObject = this.addObject(createPlayer({
            camera,
            collision: this.collision,
            input: this.input,
            physics: this.physics,
            weapons,
          }))
          this.player = playerObject.requireComponent(PlayerComponent)
          this.setPlayerEnabled(true)
        }
      }
      if (this.render) {
        this.teapot = this.addObject(createFloatingTeapot({
          scene,
          center: new THREE.Vector3().fromArray(settings.center),
          radius: new THREE.Vector2().fromArray(settings.orbitRadius),
        }))
        const mesh = this.teapot.requireComponent(MeshComponent).root
        this.probes?.bindRoot(mesh)
        this.shadows = this.#bindings.add(createRoomShadows({
          scene,
          renderer: this.render.renderer,
          roots: [room.root, mesh],
          position: new THREE.Vector3().fromArray(settings.shadowPosition),
          target: new THREE.Vector3().fromArray(settings.shadowTarget),
        }))
      }
      this.ready = true
      return room
    }
    catch (error) {
      this.dispose()
      throw error
    }
    finally {
      this.#loading = false
    }
  }

  #addMesh(name, asset) {
    const object = new GameObject({ name, mobility: 'static' })
    const { root } = asset
    object.addComponent(new TransformComponent({ position: root.position, quaternion: root.quaternion, scale: root.scale }))
    object.addComponent(new MeshComponent({
      root,
      scene: this.scene,
      release: () => asset.dispose(),
    }))
    return this.addObject(object)
  }

  async loadProbes(renderer, onProgress, signal = this.#controller.signal) {
    if (!this.room || !this.lights || this.disposed || this.probes || this.#probesLoading)
      throw new Error('[RangeRoomLevel] Probes cannot be loaded in the current state')
    this.#probesLoading = true
    const token = AbortSignal.any([signal, this.#controller.signal])
    try {
      this.probes = this.#bindings.add(await createProbeLighting({
        scene: this.scene,
        renderer,
        room: this.room,
        lights: this.lights,
        skyboxUrl: this.settings.skyboxUrl,
        signal: token,
        onProgress,
      }))
      token.throwIfAborted()
      if (this.teapot)
        this.probes.bindRoot(this.teapot.requireComponent(MeshComponent).root)
      return this.probes
    }
    finally {
      this.#probesLoading = false
    }
  }

  setPlayerEnabled(enabled) {
    this.player?.setEnabled(enabled)
    this.input?.setEnabled(enabled && !!this.player)
  }

  setRuntimeLighting(enabled) {
    if (!this.lights || this.disposed)
      throw new Error('[Range room] Room is not ready')
    this.lights.setEnabled(enabled)
    this.probes?.setRuntimeEnabled(enabled)
    this.ground?.setLightingEnabled(enabled)
    this.scene.environmentIntensity = enabled ? this.settings.environmentIntensity : 0
    this.#weaponAssets?.setReflectionEnabled(enabled)
  }

  snapshot() {
    const room = this.room
    return {
      ready: this.ready && !this.disposed,
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
      lights: this.lights?.root.children.map(light => ({ name: light.name, type: light.type, intensity: light.intensity })),
      config: this.settings,
      skybox: this.environmentProxy ? this.settings.skyboxUrl : null,
      environmentSize: this.environmentProxy
        ? [this.environmentProxy.image.width, this.environmentProxy.image.height]
        : null,
      sampling: room
        ? {
            textureCount: room.samplers.snapshot().length,
            anisotropy: this.settings.textureAnisotropy,
            atlasMipLevels: Array.from(room.atlases.values(), atlas => atlas.mipmaps.length),
            atlasDecoders: Array.from(room.atlases.values(), atlas => atlas.userData.decode),
            atlasFilter: 'linear / trilinear',
            surfaceFilter: 'lightmap albedo: pixel-sharp / trilinear; other surfaces: nearest',
            lightmapAlbedoAnisotropy: this.settings.textureAnisotropy,
            otherSurfaceAnisotropy: 1,
          }
        : null,
      lightCalibration: 'initial fit; RectAreaLight shadows/Spread unavailable; visual acceptance required',
      probes: this.probes?.getDebugState() ?? null,
      reflection: this.reflection?.getDebugState() ?? null,
      reflectionPreview: this.reflection?.preview?.getDebugState() ?? null,
      ground: this.ground?.snapshot() ?? null,
    }
  }

  dispose() {
    if (this.disposed)
      return
    this.ready = false
    this.#controller.abort()
    // Restore shadow/probe material bindings before object-owned GPU resources.
    this.#bindings.dispose()
    super.dispose()
  }
}
