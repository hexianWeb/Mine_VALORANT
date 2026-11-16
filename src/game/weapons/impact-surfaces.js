const surfaces = [
  'metal',
  'stone',
  'wood',
  'dirt',
  'sand',
]

export function isImpactSurface(value) {
  return surfaces.includes(value)
}

/** Optional authoring colors are six-digit sRGB hex, not baked lighting samples. */
export function isImpactColor(value) {
  return typeof value === 'string' && /^#[\da-f]{6}$/iu.test(value)
}

export function namedImpactSurface(name) {
  const surface = /__(?:mat|surface)_([a-z]+)$/iu.exec(name ?? '')?.[1].toLowerCase()
  return isImpactSurface(surface)
    ? surface
    : null
}
