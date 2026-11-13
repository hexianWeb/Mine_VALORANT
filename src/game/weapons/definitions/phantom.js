import { phantomAimProfile } from '../aim-profile.js'
import { createWeaponDefinition } from '../weapon-definition.js'

// Timing/capacity: valorant-first-person-pack/phantom/manifest.json runtime.
// Fire mode: source phantom_data.json. Inspect uses the source 4-second clip.
export const phantomDefinition = createWeaponDefinition({
  ...phantomAimProfile,
  id: 'phantom',
  capacity: 30,
  initialReserve: 90, // Project practice-loadout default: three spare magazines.
  fire: { mode: 'auto', interval: 60 / 660 },
  equip: { draw: 1, holster: 0 }, // Source put_away_time is explicitly zero.
  reload: {
    tactical: { feed: 1.2, duration: 2.5 },
    empty: { feed: 2.25, duration: 2.5 },
  },
  inspectDuration: 4,
  capabilities: { ads: true },
  // Logical publication IDs keep source authoring paths out of gameplay.
  assets: { modelId: 'phantom', assetVersion: 'v2', defaultSkinId: 'tactiplay' },
})
