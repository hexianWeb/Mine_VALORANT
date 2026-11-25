import { classicAimProfile } from '../aim-profile.js'
import { createWeaponDefinition, retimeReload } from '../weapon-definition.js'

const radians = Math.PI / 180

// Timing/capacity: valorant-first-person-pack/classic/manifest.json runtime.
// Fire mode: source classic_data.json. Inspect uses the source 3-second clip.
export const classicDefinition = createWeaponDefinition({
  ...classicAimProfile,
  recoil: {
    ...classicAimProfile.recoil,
    spray: {
      // Primary taps only: [shot number, pitch degrees up, yaw degrees left].
      points: [
        [1, 0, 0],
        [2, 0.3, 0],
        [3, 0.85, 0.02],
        [4, 1.6, 0.06],
      ].map(([shot, pitch, yaw]) => ({
        index: shot - 1,
        pitch: pitch * radians,
        yaw: yaw * radians,
      })),
      recoveryDelay: 0.16,
      recoveryDuration: 0.17,
    },
  },
  id: 'classic',
  capacity: 12,
  initialReserve: 36, // Project practice-loadout default: three spare magazines.
  fire: {
    mode: 'semi',
    interval: 60 / 405,
    // Local tuning: match the authored salvo clip's one-second duration.
    salvo: { rounds: 3, interval: 1, spreadAngle: 4 * Math.PI / 180 },
  },
  equip: { draw: 0.75, holster: 0 }, // Source put_away_time is explicitly zero.
  reload: {
    tactical: retimeReload({ feed: 1.75, duration: 1.75 }, 1.5),
    empty: { feed: 1.75, duration: 1.75 },
  },
  inspectDuration: 3,
  capabilities: { ads: false },
  assets: {
    modelId: 'classic',
    assetVersion: 'v4',
    defaultSkinId: 'ag',
    skinIds: ['ag', 'smite', 'sakura'],
  },
})
