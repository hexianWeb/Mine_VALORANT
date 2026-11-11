// @ts-check
import { cloneBox } from '../physics/collision-world.js'

const EPSILON = 1e-6
const GROUND_PROBE = 0.01
/** @type {import('../physics/collision-world.js').Box[]} */
const hits = []

/**
 * 沿单轴移动 `box`，直到碰到前方最近的盒子。
 * 已经重叠的盒子会被忽略，这样一开始嵌在几何体里的物体仍能离开。
 * @param {import('../physics/collision-world.js').CollisionWorld} world
 * @param {{ min: number[], max: number[] }} box
 * @param {number} axis
 * @param {number} delta
 */
function sweepAxis(world, box, axis, delta) {
  if (delta === 0)
    return { moved: 0, hit: false }
  const swept = cloneBox(box)
  if (delta > 0)
    swept.max[axis] += delta
  else
    swept.min[axis] += delta
  let allowed = delta
  for (const other of world.queryAABB(swept, hits)) {
    if (delta > 0) {
      const gap = other.min[axis] - box.max[axis]
      if (gap >= -EPSILON && gap < allowed)
        allowed = Math.max(gap, 0)
    }
    else {
      const gap = other.max[axis] - box.min[axis]
      if (gap <= EPSILON && gap > allowed)
        allowed = Math.min(gap, 0)
    }
  }
  box.min[axis] += allowed
  box.max[axis] += allowed
  return { moved: allowed, hit: allowed !== delta }
}

/**
 * 把 `source` 的 min 和 max 复制到 `target`。
 * @param {{ min: number[], max: number[] }} target
 * @param {{ min: number[], max: number[] }} source
 */
function copyInto(target, source) {
  for (let i = 0; i < 3; i++) {
    target.min[i] = source.min[i]
    target.max[i] = source.max[i]
  }
}

/**
 * 计算 `box` 相对 `start` 的水平位移量。
 * @param {{ min: number[], max: number[] }} box
 * @param {{ min: number[], max: number[] }} start
 * @returns {number}
 */
function horizontalProgress(box, start) {
  return Math.hypot(box.min[0] - start.min[0], box.min[2] - start.min[2])
}

/**
 * 分轴运动学移动：先 Y，再 X，再 Z。会修改 `box`。
 * 上台阶只从有支撑的姿态开始；`snapDown` 让行走中的物体贴住下台阶。
 * @param {import('../physics/collision-world.js').CollisionWorld} world
 * @param {{ min: number[], max: number[] }} box
 * @param {number[]} displacement
 * @param {{ stepHeight?: number, snapDown?: number }} [options]
 */
export function moveAABB(world, box, [dx, dy, dz], { stepHeight = 0, snapDown = 0 } = {}) {
  const y = sweepAxis(world, box, 1, dy)
  const supported = dy <= 0 && y.hit
  const start = cloneBox(box)
  let hitX = sweepAxis(world, box, 0, dx).hit
  let hitZ = sweepAxis(world, box, 2, dz).hit
  let stepped = false
  if ((hitX || hitZ) && supported && stepHeight > 0) {
    const trial = cloneBox(start)
    const lift = sweepAxis(world, trial, 1, stepHeight)
    const trialX = sweepAxis(world, trial, 0, dx).hit
    const trialZ = sweepAxis(world, trial, 2, dz).hit
    sweepAxis(world, trial, 1, -lift.moved)
    if (horizontalProgress(trial, start) > horizontalProgress(box, start) + EPSILON) {
      copyInto(box, trial)
      hitX = trialX
      hitZ = trialZ
      stepped = true
    }
  }
  const probe = cloneBox(box)
  const ground = sweepAxis(world, probe, 1, -(snapDown > 0
    ? snapDown
    : GROUND_PROBE))
  const grounded = dy <= 0 && ground.hit
  if (grounded && snapDown > 0)
    copyInto(box, probe)
  return {
    grounded,
    hitX,
    hitY: y.hit,
    hitZ,
    stepped,
  }
}
