import { createWeaponDefinition } from '../weapon-definition.js'

export const karambitDefinition = createWeaponDefinition({
  id: 'karambit',
  capacity: 0,
  initialReserve: 0,
  fire: { mode: 'semi', interval: 1 },
  // The first slash of karambit_attack_1 (v3) crosses screen center at 60 Hz tick 4.
  meleeAttack: { contactTime: 4 / 60, range: 2 },
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
