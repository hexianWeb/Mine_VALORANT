/** The direction may be in a transformed space. Its length determines the ray parameter's units. */
export function intersectRayBox(origin, direction, { min, max }, limit) {
  let enter = 0
  let exit = limit
  let enterAxis = -1
  for (let axis = 0; axis < 3; axis++) {
    const delta = direction[axis]
    if (Math.abs(delta) < 1e-12) {
      if (origin[axis] < min[axis] || origin[axis] > max[axis])
        return null
      continue
    }
    const a = (min[axis] - origin[axis]) / delta
    const b = (max[axis] - origin[axis]) / delta
    const near = Math.min(a, b)
    if (near > enter) {
      enter = near
      enterAxis = axis
    }
    exit = Math.min(exit, Math.max(a, b))
    if (enter > exit)
      return null
  }
  return { distance: enter, axis: enterAxis }
}
