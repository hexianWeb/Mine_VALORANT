import { operatorAimProfile } from '../aim-profile.js'
import { createWeaponDefinition } from '../weapon-definition.js'

// Local Operator source pack timings. The shot clip includes the bolt cycle.
export const operatorDefinition = createWeaponDefinition({
  ...operatorAimProfile,
  id: 'operator',
  capacity: 5,
  initialReserve: 15,
  fire: { mode: 'semi', interval: 60 / 36, scopeRecovery: 1.65 },
  equip: { draw: 2, holster: 0 },
  reload: {
    tactical: { feed: 3.6, duration: 3.6 },
    empty: { feed: 3.6, duration: 3.6 },
  },
  inspectDuration: 5,
  capabilities: { ads: true },
  assets: { modelId: 'operator', assetVersion: 'v3', defaultSkinId: 'original' },
})
