import { phantomAimProfile } from '../aim-profile.js'
import { createWeaponDefinition } from '../weapon-definition.js'

export const odinGameplayProvenance = Object.freeze({
  status: 'temporary-public-reference',
  observedAt: '2026-11-14',
  referenceUrl: 'https://valorant-api.com/v1/weapons/63e6c2b6-4a8e-869c-3d4c-e38355226584',
  wikiAccess: 'Wiki inaccessible earlier in this session; community game-data API snapshot used instead',
  fireMode: 'Full-auto project mapping; API fireMode is null',
  recoilAndSpread: 'Phantom project curves reused temporarily; not Odin source curves',
  fireRate: 'Fixed 12/s; ROFIncrease spin-up and reference ADS 15.6/s are NOT implemented',
  ads: 'Project 0.2083-second transition; FOV computed from authoring 70 degrees / 1.15 tangent zoom',
  reserve: 'Three spare magazines, project practice policy',
  reloadCommit: 'At the end of the public five-second duration, project policy',
  holster: 'Zero-duration switch, project policy',
  inspect: '6.5417-second authoring clip used as a project deadline',
  barrel: 'Source barrel clip controls red_1/red_2 scales, not rotation; no invented heat driver',
  unimplementedReferenceFields: 'Damage, penetration and weapon-specific movement are recorded only',
})

const adsFov = 2 * Math.atan(Math.tan(70 * Math.PI / 360) / 1.15) * 180 / Math.PI

export const odinDefinition = createWeaponDefinition({
  ...phantomAimProfile,
  aim: { duration: 0.2083, worldFov: adsFov, viewmodelFov: adsFov },
  id: 'odin',
  capacity: 100,
  initialReserve: 300,
  fire: { mode: 'auto', interval: 1 / 12 },
  equip: { draw: 1.25, holster: 0 },
  reload: {
    tactical: { feed: 5, duration: 5 },
    empty: { feed: 5, duration: 5 },
  },
  inspectDuration: 6.5417,
  capabilities: { ads: true },
  assets: {
    modelId: 'odin',
    assetVersion: 'v1',
    defaultSkinId: 'smite',
    skinIds: ['smite', 'prime', 'blastx'],
  },
})
