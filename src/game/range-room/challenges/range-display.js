import { Component } from '../../../engine/runtime/function/framework/index.js'
import { challengeRules } from './config.js'

const timeUpdatesPerSecond = 25
const twoDigits = number => String(number).padStart(2, '0')

/** The world panels and app HUD consume the same fields committed before rendering. */
export class RangeDisplay extends Component {
  static phases = ['presentation']
  #model = null
  #inputs = []
  #challenge
  #panels
  #effects
  #player
  #practiceVisible

  constructor({ challenge, panels, effects, player, practiceVisible }) {
    super()
    this.#challenge = challenge
    this.#panels = panels
    this.#effects = effects
    this.#player = player
    this.#practiceVisible = practiceVisible
  }

  read() { return this.#model }

  tick({ time }) {
    this.#effects.present(time.presentationTime)
    this.update(time.presentationTime)
  }

  update(at) {
    const session = this.#challenge.readPresentedSession()
    const selection = this.#challenge.selection
    const practice = this.#practiceVisible()
    const sensitivity = this.#player.lookSettings.read().sensitivity.toFixed(2)
    const ammoPolicy = this.#player.weapons.readHud()?.weapon?.ammoPolicy ?? null
    const control = this.#challenge.readControlState()
    const canAdjust = this.#player.enabled && control.enabled
    const config = session?.config ?? selection
    const shooting = config.mode === 'shooting-test'
    const seconds = shooting
      ? null
      : session?.result?.elapsed ?? Math.floor(Math.max(0, at - (session?.startedAt ?? at)) * timeUpdatesPerSecond) / timeUpdatesPerSecond
    const inputs = [
      session,
      selection,
      practice,
      sensitivity,
      ammoPolicy,
      control.ready,
      control.reason,
      canAdjust,
      seconds,
    ]
    if (inputs.every((value, index) => value === this.#inputs[index]))
      return
    this.#inputs = inputs
    const goal = config.goal ?? (shooting ? challengeRules.opportunities : config.targetKills)
    const kills = session?.kills ?? 0
    const settled = session?.settled ?? 0
    const timeLabel = seconds === null
      ? null
      : seconds.toFixed(2)
    const columns = shooting
      ? [
          {
            label: '得分',
            value: twoDigits(kills),
          },
          {
            label: '剩余',
            value: twoDigits(goal - settled),
          },
        ]
      : [
          { label: '击杀', value: `${kills}/${goal}` },
          { label: '用时 · 秒', value: timeLabel },
        ]
    this.#model = Object.freeze({
      revision: (this.#model?.revision ?? 0) + 1,
      status: session?.status ?? 'idle',
      sessionId: session?.sessionId ?? null,
      mode: config.mode,
      difficulty: config.difficulty,
      armor: config.armor,
      goal,
      kills,
      settled,
      timeLabel,
      columns: Object.freeze(columns.map(Object.freeze)),
      practice,
      sensitivity,
      ammoPolicy,
      startReady: control.ready,
      reason: control.reason,
      canAdjust,
    })
    this.#panels.update(this.#model)
  }
}
