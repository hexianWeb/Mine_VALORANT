import { phantomAimProfile } from '../aim-profile.js'
import { createWeaponDefinition, retimeReload } from '../weapon-definition.js'

// Provenance for the original authored release.
export const vandalGameplayProvenance = Object.freeze({
  status: 'temporary-public-reference',
  observedAt: '2026-11-14',
  referenceUrl: 'https://valorant-api.com/v1/weapons/9c82e19d-4575-0200-1a81-3eacf00cf872',
  requestedWiki: 'https://valorant.fandom.com/wiki/Vandal',
  wikiAccess: 'Wiki inaccessible in this session; community game-data API used instead',
  fireMode: 'Full-auto project mapping; API fireMode is null, not evidence of semi-auto',
  recoilAndSpread: 'Phantom project curves reused temporarily; not Vandal source curves',
  ads: 'Project 0.2083-second transition; FOV computed from 70 degrees / 1.25 tangent zoom',
  adsFireRate: 'Runtime has one fire interval: ADS temporarily stays 9.75/s, not reference 8.775/s',
  reserve: 'Three spare magazines, project practice policy',
  reloadCommit: 'At the end of the public 2.5-second duration; authoring clips remain 2.3333 seconds',
  holster: 'Zero-duration switch, project policy',
  inspect: '4.5833-second authoring clip used as a project deadline',
  unimplementedReferenceFields: 'Damage, penetration and weapon-specific movement are recorded only',
})

const radians = Math.PI / 180
const adsFov = 2 * Math.atan(Math.tan(70 * Math.PI / 360) / 1.25) * 180 / Math.PI

export const vandalDefinition = createWeaponDefinition({
  ...phantomAimProfile,
  recoil: {
    ...phantomAimProfile.recoil,
    spray: {
      // Local gameplay tuning: [shot number, pitch degrees up, yaw degrees left].
      points: [
        [1, 0, 0],
        [2, 0.6, 0],
        [4, 2, -0.1],
        [7, 4.55, 0.45],
        [10, 6.5, 1.7],
        [13, 6.8, 2.05],
        [17, 6.8, -2.1],
        [21, 6.8, 1.9],
        [25, 6.8, -1.4],
      ].map(([shot, pitch, yaw]) => ({
        index: shot - 1,
        pitch: pitch * radians,
        yaw: yaw * radians,
      })),
      recoveryDelay: 0.18,
      recoveryDuration: 0.37,
    },
  },
  aim: { ...phantomAimProfile.aim, worldFov: adsFov, viewmodelFov: adsFov },
  id: 'vandal',
  capacity: 25,
  initialReserve: 75,
  fire: { mode: 'auto', interval: 1 / 9.75, adsInterval: 1 / 8.775 },
  equip: { draw: 1, holster: 0 },
  reload: {
    tactical: retimeReload({ feed: 2.5, duration: 2.5 }, 2.15),
    empty: { feed: 2.5, duration: 2.5 },
  },
  inspectDuration: 4.5833,
  capabilities: { ads: true },
  assets: {
    modelId: 'vandal',
    assetVersion: 'v1',
    defaultSkinId: 'original',
    skinIds: [
      'sakura',
      'wood-metal',
      'smite',
      'royal-gold',
      'ego',
      'original',
    ],
  },
})
