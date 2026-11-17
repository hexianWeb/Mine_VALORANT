import { EventEmitter } from '../../engine/runtime/core/events.js'
import { playerConfig } from './config.js'

export const sensitivityLimits = Object.freeze({
  default: playerConfig.sensitivity,
  min: 0.01,
  max: 5,
  fine: 0.01,
  coarse: 0.1,
})

export function validSensitivity(value) {
  return typeof value === 'number' && Number.isFinite(value)
    && value >= sensitivityLimits.min && value <= sensitivityLimits.max
}

export function stepSensitivity(settings, delta) {
  const value = Math.round((settings.read().requested + delta) * 100) / 100
  return settings.request(Math.min(sensitivityLimits.max, Math.max(sensitivityLimits.min, value)))
}

/** Player-owned settings. UI requests are coalesced and committed at a valid fixed step. */
export function createLookSettings(initial = sensitivityLimits.default) {
  const events = new EventEmitter()
  let closed = false
  const sensitivity = validSensitivity(initial)
    ? initial
    : sensitivityLimits.default
  let state = Object.freeze({
    sensitivity,
    requested: sensitivity,
    pending: false,
    revision: 0,
  })
  const publish = (patch) => {
    state = Object.freeze({
      ...state,
      ...patch,
      revision: state.revision + 1,
    })
    events.emit('change', state)
  }
  return {
    read: () => state,
    subscribe: callback => events.on('change', callback),
    request(value) {
      if (closed || !validSensitivity(value))
        return false
      const requested = Math.round(value * 100) / 100
      if (state.requested !== requested)
        publish({ requested, pending: requested !== state.sensitivity })
      return true
    },
    commit() {
      if (!closed && state.pending)
        publish({ sensitivity: state.requested, pending: false })
    },
    dispose() {
      closed = true
      events.clear()
    },
  }
}
