import { identifier, immutableFact } from '../../combat/facts.js'
import { lockChallengeConfig } from './config.js'

/** Command/consumption adapter only. Real hotboxes, surfaces and scene textures are phase four. */
export class RangePanelControl {
  #id
  #action
  #trace
  #readState
  #delta

  constructor({ id, action, trace, readState, delta = null }) {
    identifier(id, 'controlId')
    if (!['start', 'practice', 'sensitivity'].includes(action) || typeof trace !== 'function' || typeof readState !== 'function'
      || (action === 'sensitivity' && ![-0.1, -0.01, 0.01, 0.1].includes(delta))) {
      throw new TypeError('[RangePanel] Invalid control')
    }
    this.#id = id
    this.#action = action
    this.#trace = trace
    this.#readState = readState
    this.#delta = delta
  }

  captureIdentity() {
    const state = this.#readState()
    return immutableFact({
      control: {
        controlId: this.#id,
        action: this.#action,
        revision: state.revision,
        selection: state.selection,
        delta: this.#delta,
      },
    })
  }

  // The injected geometry must keep physical occlusion even while the control is disabled.
  trace(origin, direction, limit) { return this.#trace(origin, direction, limit) }

  prepareInteraction(entries, shot, time) {
    const state = this.#readState()
    if (!state.enabled || !state.ready)
      return null
    const entry = entries.find(({ impact }) => impact.control?.controlId === this.#id
      && impact.control.revision === state.revision && impact.control.action === this.#action)
    if (!entry)
      return null
    const control = entry.impact.control
    if (this.#action === 'start')
      lockChallengeConfig(control.selection, time.fixedDelta)
    return immutableFact({
      type: { start: 'StartRequested', practice: 'PracticeRequested', sensitivity: 'SensitivityRequested' }[this.#action],
      ...control,
      pelletIndex: entry.index,
      at: time.fixedElapsed,
      fixedTick: time.fixedTick,
    })
  }
}
