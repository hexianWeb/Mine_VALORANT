import { phantomAimProfile } from '../aim-profile.js'
import { createWeaponDefinition, retimeReload } from '../weapon-definition.js'

const adsFov = 2 * Math.atan(Math.tan(70 * Math.PI / 360) / 1.25) * 180 / Math.PI

export const bulldogGameplayProvenance = Object.freeze({
  status: 'temporary-public-reference',
  referenceUrl: 'https://valorant-api.com/v1/weapons/ae3de142-4d85-2547-dd26-4e90bed35cf7',
  ads: 'Temporary held fire at the reference ADS rate; three-round burst is not yet implemented.',
  recoilAndSpread: 'Temporarily use the project Phantom curves.',
  reload: 'Range tuning: both branches use the complete 2.3s empty-reload animation.',
})

export const bulldogDefinition = createWeaponDefinition({
  ...phantomAimProfile,
  aim: { duration: 12 / 60, worldFov: adsFov, viewmodelFov: adsFov },
  id: 'bulldog',
  capacity: 24,
  initialReserve: 72,
  fire: { mode: 'auto', interval: 1 / 10, adsInterval: 1 / 6.315715 },
  equip: { draw: 45 / 60, holster: 0 },
  reload: {
    tactical: retimeReload({ feed: 2.3, duration: 2.3 }, 2),
    empty: { feed: 2.3, duration: 2.3 },
  },
  inspectDuration: 3,
  capabilities: { ads: true },
  assets: {
    modelId: 'bulldog',
    assetVersion: 'v4',
    defaultSkinId: 'original',
  },
})
