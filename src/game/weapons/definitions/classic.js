import { classicAimProfile } from '../aim-profile.js'
import { createWeaponDefinition } from '../weapon-definition.js'

// Timing/capacity: valorant-first-person-pack/classic/manifest.json runtime.
// Fire mode: source classic_data.json. Inspect uses the source 3-second clip.
export const classicDefinition = createWeaponDefinition({
  ...classicAimProfile,
  id: 'classic',
  capacity: 12,
  initialReserve: 36, // Project practice-loadout default: three spare magazines.
  fire: { mode: 'semi', interval: 60 / 405 },
  equip: { draw: 0.75, holster: 0 }, // Source put_away_time is explicitly zero.
  reload: {
    tactical: { feed: 1.75, duration: 1.75 },
    empty: { feed: 1.75, duration: 1.75 },
  },
  inspectDuration: 3,
  capabilities: { ads: false }, // Classic's secondary salvo is outside this first data/controller slice.
  assets: {
    modelId: 'classic',
    assetVersion: 'v4',
    defaultSkinId: 'ag',
    skinIds: ['ag', 'smite', 'sakura'],
  },
})
