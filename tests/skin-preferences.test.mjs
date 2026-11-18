import assert from 'node:assert/strict'
import test from 'node:test'
import { classicDefinition } from '../src/game/weapons/definitions/classic.js'
import { phantomDefinition } from '../src/game/weapons/definitions/phantom.js'
import { EquipmentController } from '../src/game/weapons/equipment-controller.js'
import { createSkinPreferences, skinPreferencesStorageKey } from '../src/game/weapons/skin-preferences.js'

test('restoration ignores removed skins and unknown weapons without overriding valid preferences', () => {
  const storage = {
    getItem: () => JSON.stringify({
      classic: 'sakura',
      phantom: 'removed',
      unknown: 'skin',
      ignored: 5,
    }),
  }
  const preferences = createSkinPreferences({
    getStorage: () => storage,
  })
  const controller = new EquipmentController({
    definitions: [classicDefinition, phantomDefinition],
    loadout: [
      {
        id: 'secondary',
        weapon: { instanceId: 'pistol', definitionId: 'classic' },
      },
      {
        id: 'primary',
        weapon: { instanceId: 'rifle', definitionId: 'phantom' },
      },
    ],
    skinSelections: preferences.read(),
  })
  assert.equal(controller.readSlot('secondary').skinId, 'sakura')
  assert.equal(controller.readSlot('primary').skinId, phantomDefinition.assets.defaultSkinId)
  controller.dispose()
})

test('unavailable or corrupt browser storage never prevents skin selection', () => {
  for (const getStorage of [
    () => { throw new Error('denied') },
    () => ({
      getItem: () => '{bad json',
      setItem: () => { throw new Error('denied') },
    }),
  ]) {
    const preferences = createSkinPreferences({ getStorage })
    assert.deepEqual(preferences.read(), {})
    assert.doesNotThrow(() => preferences.set('classic', 'sakura'))
    assert.deepEqual(preferences.read(), { classic: 'sakura' })
  }
})

test('saving merges selections by weapon and can explicitly restore a default skin', () => {
  let raw = JSON.stringify({ classic: 'sakura' })
  const storage = {
    getItem: key => key === skinPreferencesStorageKey
      ? raw
      : null,
    setItem: (key, value) => {
      if (key === skinPreferencesStorageKey)
        raw = value
    },
  }
  const preferences = createSkinPreferences({
    getStorage: () => storage,
  })
  preferences.set('phantom', 'alternate')
  preferences.set('classic', classicDefinition.assets.defaultSkinId)
  assert.deepEqual(JSON.parse(raw), { classic: classicDefinition.assets.defaultSkinId, phantom: 'alternate' })
})
