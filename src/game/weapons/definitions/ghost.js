import { classicAimProfile } from '../aim-profile.js'
import { createWeaponDefinition } from '../weapon-definition.js'

// Public-reference trial data, NOT recovered valorant-first-person-pack metadata.
// The observed 2026-11-14 API snapshot reports 13 rounds, not the older 15-round value.
export const ghostGameplayProvenance = Object.freeze({
  status: 'temporary-public-reference',
  observedAt: '2026-11-14',
  referenceUrl: 'https://valorant-api.com/v1/weapons/1baa85b4-4c70-1284-64bb-6481dfc3bb4e',
  requestedWiki: 'https://valorant.fandom.com/wiki/Ghost',
  wikiAccess: '403; public game-data API used instead',
  recoilAndSpread: 'Classic project profile reused temporarily; not Ghost source curves',
  reserve: 'Three spare magazines, project practice policy',
  reloadCommit: 'At the end of the public reload duration, project policy',
  holster: 'Zero-duration switch, project policy',
  inspect: 'Three-second authoring clip used as a project deadline',
})

export const ghostDefinition = createWeaponDefinition({
  ...classicAimProfile,
  id: 'ghost',
  capacity: 13,
  initialReserve: 39,
  fire: { mode: 'semi', interval: 1 / 6.75 },
  equip: { draw: 0.75, holster: 0 },
  reload: {
    tactical: { feed: 1.5, duration: 1.5 },
    empty: { feed: 1.5, duration: 1.5 },
  },
  inspectDuration: 3,
  capabilities: { ads: false },
  assets: {
    modelId: 'ghost',
    assetVersion: 'v1',
    defaultSkinId: 'freehand',
    skinIds: ['freehand', 'recon', 'ego', 'spitfire'],
  },
})
