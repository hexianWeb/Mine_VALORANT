import { phantomAimProfile } from '../aim-profile.js'
import { createWeaponDefinition } from '../weapon-definition.js'

const radians = Math.PI / 180

// Timing/capacity: valorant-first-person-pack/phantom/manifest.json runtime.
// Fire mode: source phantom_data.json. Inspect uses the source 4-second clip.
export const phantomDefinition = createWeaponDefinition({
  ...phantomAimProfile,
  recoil: {
    ...phantomAimProfile.recoil,
    spray: {
      // Local gameplay trial: [shot number, pitch degrees up, yaw degrees left].
      points: [
        [1, 0, 0],
        [2, 0.4, 0],
        [4, 1.55, 0.15],
        [8, 3.8, -0.9],
        [12, 5.1, -1.35],
        [18, 5.1, 1.35],
        [24, 5.1, -1.15],
        [30, 5.1, 0.8],
      ].map(([shot, pitch, yaw]) => ({
        index: shot - 1,
        pitch: pitch * radians,
        yaw: yaw * radians,
      })),
      recoveryDelay: 0.16,
      recoveryDuration: 0.34,
    },
  },
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
  assets: {
    modelId: 'phantom',
    assetVersion: 'v4',
    defaultSkinId: 'original',
    skinIds: [
      'tactiplay',
      'smite',
      'rush',
      'prism',
      'original',
    ],
  },
})
