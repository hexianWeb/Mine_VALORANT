import { Disposer } from '../../../engine/runtime/core/disposer.js'
import { GameObject, MeshComponent } from '../../../engine/runtime/function/framework/index.js'
import { stepSensitivity } from '../../player/look-settings.js'
import { TrainingBotComponent } from '../../targets/training-bot.js'
import { challengeRules, defaultChallengeSelection } from './config.js'
import { createRangeKillEffects } from './kill-effects.js'
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

/** Mount one room's challenge objects into the normal Level tick. Practice bots and templates are borrowed. */
export function mountRoomChallenges({
  addObject,
  scene,
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
}) {
  const owned = new Disposer()
  try {
    let challenge
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
    const effects = owned.add(createRangeKillEffects({ scene, document, capacity: concurrency * 4 }))
    // One full replacement batch can coexist with the retiring bodies.
    const handles = Array.from({ length: concurrency * 2 }, () => {
      const object = owned.add(botAssets.instantiate({
        scene,
        targets,
        position: collision.spawn.position,
        scale,
        practice: false,
        onKillPresented: effects.start,
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
      clearEffects: effects.clear,
    }))
    challenge.prepare(defaultChallengeSelection)
    const display = object.addComponent(new RangeDisplay({
      challenge,
      panels,
      effects,
      player,
      practiceVisible: () => practiceBots.some(bot => bot.requireComponent(MeshComponent).root.visible),
    }))
    addObject(object)
    display.update(0)

    return {
      challenge,
      readHud: () => display.read(),
      readDiagnostics() {
        const bots = handles.map(({ bot }) => bot.snapshot())
        return {
          ...challenge.snapshot(),
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
