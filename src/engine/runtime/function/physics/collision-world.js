// @ts-check

/**
 * @typedef {object} Box
 * @property {number[]} min
 * @property {number[]} max
 * @property {string} [name]
 * @property {string} [group]
 */

const EPSILON = 1e-6

/**
 * 严格重叠：贴面不算相交。
 * @param {Box} a
 * @param {Box} b
 */
export function overlaps(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a.min[i] >= b.max[i] - EPSILON || a.max[i] <= b.min[i] + EPSILON)
      return false
  }
  return true
}

/** @param {Box} box */
export function cloneBox(box) {
  return {
    min: [...box.min],
    max: [...box.max],
  }
}

/** 静态 AABB 集合。`queryAABB` 背后是暴力遍历，以后可以换成网格或 sort-and-sweep。 */
export class CollisionWorld {
  /** @param {Box[]} [boxes] */
  constructor(boxes = []) {
    /** @type {Box[]} */
    this.boxes = boxes.map(box => ({
      ...box,
      min: [...box.min],
      max: [...box.max],
    }))
  }

  /** @param {Box} box */
  add(box) {
    const copy = {
      ...box,
      min: [...box.min],
      max: [...box.max],
    }
    this.boxes.push(copy)
    return copy
  }

  /**
   * @param {Box} box
   * @param {Box[]} [out]
   */
  queryAABB(box, out = []) {
    out.length = 0
    for (const candidate of this.boxes) {
      if (overlaps(box, candidate))
        out.push(candidate)
    }
    return out
  }
}
