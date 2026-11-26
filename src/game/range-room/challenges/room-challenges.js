import { Vector3, WebGPUCoordinateSystem } from 'three/webgpu'
import { Disposer } from '../../../engine/runtime/core/disposer.js'
import { GameObject, MeshComponent } from '../../../engine/runtime/function/framework/index.js'
import { intersectRayBox } from '../../../engine/runtime/function/physics/ray-box.js'
import { stepSensitivity } from '../../player/look-settings.js'
import { TrainingBotComponent } from '../../targets/training-bot.js'
import { challengeRules, defaultChallengeSelection } from './config.js'
import { FlowEffectComponent } from './flow-controller.js'
import { createRangeKillEffects } from './kill-effects.js'
import { KillFeedback } from './kill-feedback.js'
import { RangeChallengeComponent } from './range-challenge.js'
import { RangeDisplay } from './range-display.js'
import { prepareRoomSpawnLayout } from './room-spawn-layout.js'
import { createRangeWorldPanels } from './world-panels.js'

const bodyHideDelay = 0.05

function createTargetPool(handles) {
  const free = new Set(handles)
  return {
    acquire(count) {
      const batch = [...free].slice(0, count)
      for (const handle of batch) free.delete(handle)
      return batch
    },
    release: handle => free.add(handle),
    available: () => free.size,
    clearPresentation(at, reason) {
      for (const { bot } of handles) {
        if (!bot.disposed)
          bot.invalidateSpawn(at, reason)
      }
    },
  }
}

// Sample only until first exposure. This is a head/chest sightline proxy, not GPU pixel visibility.
function createProjector(camera, boxes) {
  const point = new Vector3()
  const eye = new Vector3()
  const projected = new Vector3()
  const origin = []
  const direction = []
  return (spawn, [x, y, z]) => {
    camera.getWorldPosition(eye).toArray(origin)
    point.set(spawn.position[0] + x, spawn.position[1] + y, spawn.position[2] + z)
    projected.copy(point).project(camera)
    if (Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1 || projected.z > 1
      || projected.z < (camera.coordinateSystem === WebGPUCoordinateSystem
        ? 0
        : -1)) {
      return null
    }
    const distance = point.sub(eye).length()
    point.normalize().toArray(direction)
    if (boxes.some(box => intersectRayBox(origin, direction, box, distance)))
      return null
    return {
      id: spawn.spawnId,
      point: [spawn.position[0] + x, spawn.position[1] + y, spawn.position[2] + z],
      x: (projected.x + 1) / 2,
      y: (1 - projected.y) / 2,
      distance: projected.x ** 2 + projected.y ** 2,
    }
  }
}

/** Mount one room's challenge objects into the normal Level tick. Practice bots and templates are borrowed. */
export function mountRoomChallenges({
  addObject,
  scene,
  camera,
  document,
  roomRoot,
  collision,
  targets,
  player,
  botAssets,
  practiceBots,
  scale,
  anisotropy,
  fixedDelta,
  audio,
  resources,
  render = null,
  particles = null,
  signal,
}) {
  const owned = new Disposer()
  try {
    let challenge
    let flow = null
    const readWorldTimeScale = () => flow?.worldTimeScale ?? 1
    const panels = owned.add(createRangeWorldPanels({
      document,
      scene,
      targets,
      anisotropy,
      readControl(action) {
        const state = challenge.readControlState()
        return action === 'start'
          ? state
          : { ...state, ready: player.enabled && state.enabled }
      },
    }))
    const { cells, diagnostics } = prepareRoomSpawnLayout({
      collision,
      room: roomRoot,
      surfaces: panels.surfaces,
      geometry: botAssets.spawnGeometry,
      scale,
      player: player.settings,
    })
    const { concurrency } = challengeRules
    const project = createProjector(camera, collision.world.boxes)
    const effects = owned.add(createRangeKillEffects({ scene, document, capacity: concurrency * 4 }))
    // One full replacement batch can coexist with the retiring bodies.
    const handles = Array.from({ length: concurrency * 2 }, () => {
      const object = owned.add(botAssets.instantiate({
        scene,
        targets,
        position: collision.spawn.position,
        scale,
        practice: false,
        readWorldTimeScale,
        onKillPresented: (fact, at) => effects.start(fact, at),
      }))
      addObject(object)
      return {
        id: object.id,
        bot: object.requireComponent(TrainingBotComponent),
      }
    })
    let practiceEnabled = true
    const setPracticeEnabled = (enabled, at) => {
      practiceEnabled = enabled
      for (const object of practiceBots)
        object.requireComponent(TrainingBotComponent).setPracticeEnabled(enabled, at)
    }

    // Last in, first out: disposing this GO cancels the session while its bots and effects are live.
    const object = owned.add(new GameObject({ name: 'Range challenges', mobility: 'static' }))
    const feedback = object.addComponent(new KillFeedback({ audio, resources, signal }))
    challenge = object.addComponent(new RangeChallengeComponent({
      cells,
      pool: createTargetPool(handles),
      random: Math.random,
      fixedDelta,
      bodyHideDelay,
      spawnScale: scale,
      canStart: () => player.enabled && player.weapons.canStartChallenge(),
      setPracticeEnabled,
      onPracticeRequested: (_command, time) => setPracticeEnabled(!practiceEnabled, time.fixedElapsed),
      onSensitivityRequested: command => stepSensitivity(player.lookSettings, command.delta),
      onKillsSettled: (result, haoqiMultiplier) => feedback.receive(result, haoqiMultiplier),
      onFlowEvent: (type, reason) => flow?.onFlowEvent(type, reason),
      clearEffects() {
        effects.clear()
        feedback.clear()
        flow?.reset()
      },
      inView: spawn => diagnostics.aimPoints.some(offset => project(spawn, offset)),
      projectHead: spawn => project(spawn, diagnostics.aimPoints[0]),
      activeWeapon: () => player.weapons.activeDefinitionId,
    }))
    challenge.prepare(defaultChallengeSelection)
    flow = object.addComponent(new FlowEffectComponent({
      challenge,
      player,
      render,
      particles,
      botAssets,
      audio,
      resources,
      signal,
    }))
    const display = object.addComponent(new RangeDisplay({
      challenge,
      panels,
      effects,
      player,
      practiceVisible: () => practiceBots.some(bot => bot.requireComponent(MeshComponent).root.visible),
      readWorldTimeScale,
    }))
    addObject(object)
    display.update(0)

    return {
      challenge,
      onShotResolved: (result, context) => challenge.onShotResolved(result, context),
      readHud: () => display.read(),
      readKillFeedback: () => feedback.read(),
      readDiagnostics() {
        const bots = handles.map(({ bot }) => bot.snapshot())
        return {
          ...challenge.snapshot(),
          flow: flow.snapshot(),
          layout: diagnostics,
          panel: panels.snapshot(),
          display: display.read(),
          effects: effects.snapshot(),
          poolSize: handles.length,
          hittable: bots.filter(bot => bot.combat.eligible),
          visible: bots.filter(bot => bot.poses.visible),
        }
      },
      dispose: () => owned.dispose(),
    }
  }
  catch (error) {
    owned.dispose()
    throw error
  }
}
