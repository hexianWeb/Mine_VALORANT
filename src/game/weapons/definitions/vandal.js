import { phantomAimProfile } from '../aim-profile.js'
import { createWeaponDefinition } from '../weapon-definition.js'

// Public-reference trial data, NOT recovered valorant-first-person-pack metadata.
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

const adsFov = 2 * Math.atan(Math.tan(70 * Math.PI / 360) / 1.25) * 180 / Math.PI

export const vandalDefinition = createWeaponDefinition({
  ...phantomAimProfile,
  aim: { duration: 0.2083, worldFov: adsFov, viewmodelFov: adsFov },
  id: 'vandal',
  capacity: 25,
  initialReserve: 75,
  fire: { mode: 'auto', interval: 1 / 9.75 },
  equip: { draw: 1, holster: 0 },
  reload: {
    tactical: { feed: 2.5, duration: 2.5 },
    empty: { feed: 2.5, duration: 2.5 },
  },
  inspectDuration: 4.5833,
  capabilities: { ads: true },
  assets: {
    modelId: 'vandal',
    assetVersion: 'v1',
    defaultSkinId: 'sakura',
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
