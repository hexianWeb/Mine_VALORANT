export const skinPreferencesStorageKey = 'mc-valorant.weapon-skins.v1'

/** Storage is optional and untrusted; the controller validates skins against its catalog. */
export function createSkinPreferences({ getStorage } = {}) {
  const selected = new Map()
  let storage
  try {
    storage = getStorage?.()
    const raw = storage?.getItem(skinPreferencesStorageKey)
    const saved = raw
      ? JSON.parse(raw)
      : null
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      for (const [definitionId, skinId] of Object.entries(saved)) {
        if (definitionId && definitionId.trim() === definitionId
          && typeof skinId === 'string' && skinId && skinId.trim() === skinId) {
          selected.set(definitionId, skinId)
        }
      }
    }
  }
  catch {
    // A denied or corrupt store must not prevent gameplay.
  }
  return {
    read: () => Object.fromEntries(selected),
    set(definitionId, skinId) {
      if (selected.get(definitionId) === skinId)
        return
      selected.set(definitionId, skinId)
      try {
        storage?.setItem(skinPreferencesStorageKey, JSON.stringify(Object.fromEntries(selected)))
      }
      catch {
        // Keep the preference in memory even when the browser cannot save it.
      }
    },
  }
}
