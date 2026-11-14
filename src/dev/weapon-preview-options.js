export function weaponPreviewOptions(search, development) {
  const query = new URLSearchParams(search)
  const weapon = query.get('weapon') ?? 'classic'
  if (![
    'classic',
    'phantom',
    'ghost',
    'vandal',
    'sheriff',
    'judge',
    'odin',
  ].includes(weapon)) {
    throw new Error('Unknown preview weapon')
  }
  const candidate = query.get('candidate')
  if (!candidate)
    return { weapon, baseUrl: '/weapons/', candidate: null }
  if (!development)
    throw new Error('Candidate assets require the development server')
  const version = query.get('version')
  const skin = query.get('skin')
  if (!/^candidate-[\w-]+$/.test(candidate) || !/^[\w-]+$/.test(version ?? '') || !/^[\w-]+$/.test(skin ?? ''))
    throw new Error('Invalid candidate preview parameters')
  return {
    weapon,
    candidate,
    version,
    skin,
    baseUrl: `/__weapon_preview__/${candidate}/`,
  }
}
