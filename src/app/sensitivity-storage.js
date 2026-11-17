import { validSensitivity } from '../game/player/look-settings.js'

export const sensitivityStorageKey = 'mc-valorant.mouse-sensitivity.v1'

/** Storage is optional/untrusted. Only committed, validated player values are saved. */
export function bindSensitivityStorage({ settings, getStorage }) {
  let storage
  let saved
  let result = 'local'
  try {
    storage = getStorage()
    const raw = storage?.getItem(sensitivityStorageKey)
    const value = raw === null || raw?.trim() === ''
      ? NaN
      : Number(raw)
    if (validSensitivity(value)) {
      saved = Math.round(value * 100) / 100
      result = 'restored'
      settings.request(saved)
    }
  }
  catch {
    result = 'unavailable'
  }
  const off = settings.subscribe((state) => {
    if (state.pending || state.sensitivity === saved)
      return
    try {
      if (!storage)
        throw new Error('Storage unavailable')
      storage.setItem(sensitivityStorageKey, String(state.sensitivity))
      saved = state.sensitivity
      result = 'saved'
    }
    catch {
      result = 'unavailable'
    }
  })
  return {
    read: () => result,
    dispose: off,
  }
}
