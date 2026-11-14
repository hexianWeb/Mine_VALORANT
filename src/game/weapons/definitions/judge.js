import { classicAimProfile } from '../aim-profile.js'
import { createWeaponDefinition } from '../weapon-definition.js'

export const judgeGameplayProvenance = Object.freeze({
  status: 'temporary-public-reference',
  observedAt: '2026-11-14',
  referenceUrl: 'https://valorant-api.com/v1/weapons/ec845bf4-4f79-ddda-a3da-0db3774b2794',
  wikiAccess: 'Wiki inaccessible earlier in this session; community game-data API snapshot used instead',
  fireMode: 'Full-auto project mapping; API fireMode is null',
  recoil: 'Classic project curves reused temporarily; not Judge source curves',
  pelletPattern: '12 deterministic independent ray samples; triangular per-axis project spread, not VALORANT pellet layout',
  spread: 'Project stand/move/crouch/ads noise scales 0.045/0.08/0.04/0.045, not converted API first-bullet accuracy',
  reserve: 'Three spare magazines, project practice policy',
  reloadCommit: 'At the end of the public 2.2-second duration; authoring clips stay 2.5 seconds',
  holster: 'Zero-duration switch, project policy',
  inspect: 'Four-second authoring clip used as a project deadline',
  unimplementedReferenceFields: 'Damage, penetration and weapon-specific movement are recorded only',
})

export const judgeDefinition = createWeaponDefinition({
  ...classicAimProfile,
  spread: {
    stand: 0.045,
    move: 0.08,
    crouch: 0.04,
    ads: 0.045,
  },
  id: 'judge',
  capacity: 5,
  initialReserve: 15,
  fire: { mode: 'auto', interval: 1 / 3.5, pellets: 12 },
  equip: { draw: 1, holster: 0 },
  reload: {
    tactical: { feed: 2.2, duration: 2.2 },
    empty: { feed: 2.2, duration: 2.2 },
  },
  inspectDuration: 4,
  capabilities: { ads: false },
  assets: {
    modelId: 'judge',
    assetVersion: 'v1',
    defaultSkinId: 'smite',
    skinIds: ['smite', 'rush'],
  },
})
