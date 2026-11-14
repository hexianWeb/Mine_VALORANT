import { classicAimProfile } from '../aim-profile.js'
import { createWeaponDefinition } from '../weapon-definition.js'

// Public-reference trial data, NOT recovered valorant-first-person-pack metadata.
export const sheriffGameplayProvenance = Object.freeze({
  status: 'temporary-public-reference',
  observedAt: '2026-11-14',
  referenceUrl: 'https://valorant-api.com/v1/weapons/e336c6b8-418d-9340-d77f-7a9e4cfe0702',
  requestedWiki: 'https://valorant.fandom.com/wiki/Sheriff',
  wikiAccess: 'Wiki inaccessible earlier in this session; fresh community game-data API snapshot used instead',
  recoilAndSpread: 'Classic project curves reused temporarily; not Sheriff source curves',
  reserve: 'Three spare cylinders, project practice policy',
  reloadCommit: 'At the end of the public 2.25-second duration, project policy',
  holster: 'Zero-duration switch, project policy',
  inspect: 'Three-second authoring clip used as a project deadline',
  unimplementedReferenceFields: 'Damage, penetration and weapon-specific movement are recorded only',
})

export const sheriffDefinition = createWeaponDefinition({
  ...classicAimProfile,
  id: 'sheriff',
  capacity: 6,
  initialReserve: 18,
  fire: { mode: 'semi', interval: 1 / 4 },
  equip: { draw: 1, holster: 0 },
  reload: {
    tactical: { feed: 2.25, duration: 2.25 },
    empty: { feed: 2.25, duration: 2.25 },
  },
  inspectDuration: 3,
  capabilities: { ads: false },
  assets: {
    modelId: 'sheriff',
    assetVersion: 'v1',
    defaultSkinId: 'smite',
    skinIds: ['smite', 'sakura', 'convex'],
  },
})
