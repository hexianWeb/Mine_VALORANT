import { outlawAimProfile } from '../aim-profile.js'
import { createWeaponDefinition } from '../weapon-definition.js'

// Gameplay timing from the local Outlaw source pack.
export const outlawDefinition = createWeaponDefinition({
  ...outlawAimProfile,
  id: 'outlaw',
  capacity: 2,
  initialReserve: 6,
  fire: { mode: 'semi', interval: 60 / 230 },
  equip: { draw: 1.2, holster: 0 },
  reload: {
    tactical: { feed: 1.45, duration: 1.45 },
    empty: { feed: 3.7, duration: 3.7 },
  },
  inspectDuration: 4,
  capabilities: { ads: true },
  assets: { modelId: 'outlaw', assetVersion: 'v3', defaultSkinId: 'original' },
})
