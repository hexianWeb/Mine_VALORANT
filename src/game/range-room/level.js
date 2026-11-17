import * as THREE from 'three/webgpu'
import { Disposer } from '../../engine/runtime/core/disposer.js'
import { GameObject, Level, MeshComponent, TransformComponent } from '../../engine/runtime/function/framework/index.js'
import { createEnvironmentProxy } from '../../engine/runtime/function/render/sky-environment.js'
import { stepSensitivity } from '../player/look-settings.js'
import { PlayerFootsteps } from '../player/player-footsteps.js'
import { createPlayer, PlayerComponent } from '../player/player.js'
import { ShotTargets } from '../targets/shot-targets.js'
import { loadTrainingBotAssets, TrainingBotComponent } from '../targets/training-bot.js'
import { rangePurchaseSlots } from '../weapons/armory-catalog.js'
import { WeaponAssets } from '../weapons/assets/weapon-assets.js'
import { classicDefinition } from '../weapons/definitions/classic.js'
import { rangeLoadout } from '../weapons/player-weapons.js'
import { loadRoomAssets } from './assets/room-assets.js'
import { challengeRules, defaultChallengeSelection } from './challenges/config.js'
import { createRangeKillEffects } from './challenges/kill-effects.js'
import { RangeChallengeComponent } from './challenges/range-challenge.js'
import { RangeDisplay } from './challenges/range-display.js'
import { prepareRoomSpawnLayout } from './challenges/room-spawn-layout.js'
import { createRangeWorldPanels } from './challenges/world-panels.js'
import { loadCollisionLayer } from './collision.js'
import { rangeRoomConfig } from './config.js'
import { createRoomGround, roomGroundTextures } from './ground.js'
import { createProbeLighting } from './lighting/probe-lighting.js'
import { loadRoomReflection } from './lighting/reflection-probe.js'
import { createRoomLights } from './lighting/room-lights.js'
import { createRoomShadows } from './lighting/room-shadows.js'

const bodyHideDelay = 0.05

/** A complete level, usable without editor UI and without a renderer for asset-only loading. */
export class RangeRoomLevel extends Level {
  room = null
  lights = null
  ground = null
  probes = null
  collision = null
  player = null
  trainingBot = null
  trainingBots = []
  challenge = null
  shadows = null
  environmentProxy = null
  reflection = null
  ready = false
  #loading = false
  #probesLoading = false
  #weaponAssets = null
  #shotTargets = new ShotTargets()
  #controller = new AbortController()
  #bindings = new Disposer()
  #rangePanels
  #rangeEffects
  #rangeDisplay
  #spawnLayout
  #challengeBots = []
  #practiceEnabled = true

  constructor({
    scene,
    camera,
    resources,
    input = null,
    physics = null,
    render = null,
    audio = null,
    particles = null,
    fixedDelta = 1 / 60,
    maxAnisotropy = 16,
    config = {},
  }) {
    super({ scene })
    this.camera = camera
    this.resources = resources
    this.input = input
    this.physics = physics
    this.render = render
    this.audio = audio
    this.particles = particles
    this.fixedDelta = fixedDelta
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
          let botAssets = null
          if (settings.trainingBot) {
            botAssets = this.disposer.add(await loadTrainingBotAssets({
              resources,
              audio: this.audio,
              registerMovementObstacle: this.collision.registerMovementObstacle,
              signal: token,
            }))
            token.throwIfAborted()
            const { skins = [settings.trainingBot.skin ?? 'purple'], spacing = 2.4, ...placement } = settings.trainingBot
            for (const [index, skin] of skins.entries()) {
              const position = [...placement.position]
              // Front view from -Z: blue, yellow, purple from left to right.
              position[0] += ((skins.length - 1) / 2 - index) * spacing
              this.trainingBots.push(this.addObject(botAssets.instantiate({
                ...placement,
                position,
                skin,
                scene,
                targets: this.#shotTargets,
              })))
            }
            // Keep the legacy single-target handle on the center preview bot.
            this.trainingBot = this.trainingBots[Math.floor(this.trainingBots.length / 2)] ?? null
          }
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
            weapons = {
              assets,
              scene,
              layer: this.render.viewmodel,
              audio: this.audio,
              particles: this.particles,
              shotTargets: this.#shotTargets,
              fixedDelta: this.fixedDelta,
              ammoPolicy: 'infinite-reserve',
              loadout: rangeLoadout,
              purchaseSlots: rangePurchaseSlots,
              meleeSlot: 'tertiary',
              armoryAccess: () => this.challenge?.armoryRestriction(),
              onShotResolved: (result, context) => this.challenge?.onShotResolved(result, context),
            }
            // Prewarm shared data only. VisualPrepared requires motion ticks after load completes.
            const initial = classicDefinition.assets
            await assets.load({ weaponId: initial.modelId, assetVersion: initial.assetVersion, skinId: initial.defaultSkinId }).catch((error) => {
              token.throwIfAborted()
              console.error('[Range room] Initial weapon unavailable; select its slot to retry', error)
            })
            token.throwIfAborted()
          }
          const footsteps = this.audio
            ? new PlayerFootsteps({ audio: this.audio, resources, signal: token })
            : null
          const playerObject = this.addObject(createPlayer({
            camera,
            collision: this.collision,
            input: this.input,
            physics: this.physics,
            weapons,
            footsteps,
            onLifecycle: ({ type, at }) => {
              if (!this.disposed)
                this.challenge?.cancel(type, at)
            },
          }))
          this.player = playerObject.requireComponent(PlayerComponent)
          this.setPlayerEnabled(true)
          if (weapons && botAssets)
            this.#loadChallenges(botAssets)
        }
      }
      if (this.render) {
        this.shadows = this.#bindings.add(createRoomShadows({
          scene,
          renderer: this.render.renderer,
          roots: [room.root],
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

  #setPracticeEnabled(enabled, at) {
    this.#practiceEnabled = enabled
    for (const object of this.trainingBots)
      object.requireComponent(TrainingBotComponent).setPracticeEnabled(enabled, at)
  }

  #loadChallenges(assets) {
    const { scene, player, collision } = this
    const document = this.render.renderer.domElement.ownerDocument
    const scale = this.settings.trainingBot.scale ?? 1
    const panels = this.#rangePanels = this.disposer.add(createRangeWorldPanels({
      document,
      scene,
      targets: this.#shotTargets,
      readControl: (action) => {
        const state = this.challenge.readControlState()
        return action === 'start'
          ? state
          : { ...state, ready: player.enabled && state.enabled }
      },
      anisotropy: this.settings.textureAnisotropy,
    }))
    const { cells, diagnostics } = prepareRoomSpawnLayout({
      collision,
      room: this.room.root,
      surfaces: panels.surfaces,
      geometry: assets.spawnGeometry,
      scale,
      player: player.settings,
    })
    this.#spawnLayout = diagnostics
    const { concurrency } = challengeRules
    // The live loadout's shortest fire interval is longer than the 0.05 s
    // body hold. Allow one full batch of retiring bodies alongside N live bots.
    const poolSize = concurrency * 2
    const effects = this.#rangeEffects = this.disposer.add(createRangeKillEffects({
      scene,
      document,
      capacity: concurrency * 4,
    }))
    for (let index = 0; index < poolSize; index++) {
      const object = this.addObject(assets.instantiate({
        scene,
        targets: this.#shotTargets,
        position: collision.spawn.position,
        scale,
        practice: false,
        onKillPresented: effects.start,
      }))
      this.#challengeBots.push({
        id: object.id,
        bot: object.requireComponent(TrainingBotComponent),
      })
    }
    const free = new Set(this.#challengeBots)
    const pool = {
      acquire(count) {
        const batch = [...free].slice(0, count)
        for (const handle of batch) free.delete(handle)
        return batch
      },
      release: handle => free.add(handle),
      available: () => free.size,
      clearPresentation: (at, reason) => {
        for (const { bot } of this.#challengeBots) {
          if (!bot.disposed)
            bot.invalidateSpawn(at, reason)
        }
      },
    }
    const object = new GameObject({ name: 'Range challenges', mobility: 'static' })
    this.challenge = object.addComponent(new RangeChallengeComponent({
      cells,
      pool,
      random: Math.random,
      fixedDelta: this.fixedDelta,
      bodyHideDelay,
      spawnScale: scale,
      canStart: () => player.enabled && player.weapons.canStartChallenge(),
      setPracticeEnabled: (enabled, at) => this.#setPracticeEnabled(enabled, at),
      onPracticeRequested: (command, time) => this.#setPracticeEnabled(!this.#practiceEnabled, time.fixedElapsed),
      onSensitivityRequested: command => stepSensitivity(player.lookSettings, command.delta),
      clearEffects: effects.clear,
    }))
    this.challenge.prepare(defaultChallengeSelection)
    this.#rangeDisplay = object.addComponent(new RangeDisplay({
      challenge: this.challenge,
      panels,
      effects,
      player,
      practiceVisible: () => this.trainingBots.some(object => object.requireComponent(MeshComponent).root.visible),
    }))
    this.addObject(object)
    this.#rangeDisplay.update(0)
  }

  readChallengeHud() { return this.#rangeDisplay?.read() ?? null }

  readChallengeDiagnostics() {
    if (!this.challenge || this.disposed)
      return null
    const targets = this.#challengeBots.map(({ bot }) => bot.snapshot())
    return {
      ...this.challenge.snapshot(),
      layout: this.#spawnLayout,
      panel: this.#rangePanels.snapshot(),
      display: this.readChallengeHud(),
      effects: this.#rangeEffects.snapshot(),
      poolSize: this.#challengeBots.length,
      hittable: targets.filter(target => target.combat.eligible),
      visible: targets.filter(target => target.poses.visible),
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
      trainingBot: this.trainingBot?.getComponent(TrainingBotComponent)?.snapshot() ?? null,
      trainingBots: this.trainingBots.map(object => object.getComponent(TrainingBotComponent)?.snapshot()).filter(Boolean),
      ground: this.ground?.snapshot() ?? null,
    }
  }

  dispose() {
    if (this.disposed)
      return
    this.ready = false
    this.challenge?.cancel('unload')
    this.#controller.abort()
    // Restore shadow/probe material bindings before object-owned GPU resources.
    this.#bindings.dispose()
    super.dispose()
  }
}
