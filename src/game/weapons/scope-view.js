/** Start the handoff as the raised weapon approaches the center of the view. */
export function scopeBlend(progress) {
  const t = Math.min(1, Math.max(0, (progress - 0.74) / (0.98 - 0.74)))
  return t * t * (3 - 2 * t)
}
