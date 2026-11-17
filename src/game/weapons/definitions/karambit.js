import { createWeaponDefinition } from '../weapon-definition.js'

export const karambitDefinition = createWeaponDefinition({
  id: 'karambit',
  capacity: 0,
  initialReserve: 0,
  fire: { mode: 'semi', interval: 1 },
  equip: { draw: 0.45, holster: 0.25 },
  reload: {
    tactical: { feed: 0, duration: 0 },
    empty: { feed: 0, duration: 0 },
  },
  inspectDuration: 3.8452381,
  capabilities: { ads: false, melee: true },
  assets: {
    modelId: 'karambit',
    assetVersion: 'v3',
    defaultSkinId: 'prime-2',
  },
})
