// @ts-check
import { cloneBox } from '../physics/collision-world.js'

const EPSILON = 1e-6
const GROUND_PROBE = 0.01
/** @type {import('../physics/collision-world.js').Box[]} */
const hits = []

/**
 * 沿单轴移动 `box`，返回截断这次移动的盒子。
 * 已经重叠的盒子会被忽略，这样一开始嵌在几何体里的物体仍能离开。
 * @param {import('../physics/collision-world.js').CollisionWorld} world
 * @param {{ min: number[], max: number[] }} box
 * @param {number} axis
 * @param {number} delta
 */
function sweepAxis(world, box, axis, delta) {
  if (delta === 0)
    return null
  const swept = cloneBox(box)
  const forward = delta > 0
  if (forward)
    swept.max[axis] += delta
  else
    swept.min[axis] += delta
  let allowed = Math.abs(delta)
  let obstacle = null
  for (const other of world.queryAABB(swept, hits)) {
    const gap = forward
      ? other.min[axis] - box.max[axis]
      : box.min[axis] - other.max[axis]
    if (gap >= -EPSILON && gap < allowed) {
      allowed = Math.max(gap, 0)
      obstacle = other
    }
  }
  const moved = Math.sign(delta) * allowed
  box.min[axis] += moved
  box.max[axis] += moved
  return obstacle
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
 */
function horizontalProgress(box, start) {
  return Math.hypot(box.min[0] - start.min[0], box.min[2] - start.min[2])
}

/**
 * 检查脚下支撑。启用 snapDown 时将 `box` 贴到探到的表面。
 * @param {import('../physics/collision-world.js').CollisionWorld} world
 * @param {import('../physics/collision-world.js').Box} box
 * @param {number} snapDown
 */
function probeGround(world, box, snapDown) {
  const probe = cloneBox(box)
  const distance = snapDown > 0
    ? snapDown
    : GROUND_PROBE
  const support = sweepAxis(world, probe, 1, -distance)
  if (support && snapDown > 0)
    copyInto(box, probe)
  return support !== null
}

/**
 * 分轴运动学移动：先 Y，再 X，再 Z。会修改 `box`。
 * 上台阶只从有支撑的姿态开始；`snapDown` 让行走中的物体贴住下台阶。
 * `stepDeltaY` 是主 Y 扫掠之后，踏步或贴地造成的有符号高度变化。
 * @param {import('../physics/collision-world.js').CollisionWorld} world
 * @param {{ min: number[], max: number[] }} box
 * @param {number[]} displacement
 * @param {{ stepHeight?: number, snapDown?: number }} [options]
 */
export function moveAABB(world, box, [dx, dy, dz], { stepHeight = 0, snapDown = 0 } = {}) {
  const hitY = sweepAxis(world, box, 1, dy) !== null
  const supported = dy <= 0 && hitY
  const start = cloneBox(box)
  let blockX = sweepAxis(world, box, 0, dx)
  let blockZ = sweepAxis(world, box, 2, dz)
  let stepped = false
  if ((blockX || blockZ) && supported && stepHeight > 0) {
    const heights = new Set()
    /** @param {import('../physics/collision-world.js').Box | null} obstacle */
    const addHeight = (obstacle) => {
      if (!obstacle)
        return
      const height = obstacle.max[1] - start.min[1]
      if (height > EPSILON && height <= stepHeight + EPSILON)
        heights.add(height)
    }
    addHeight(blockX)
    addHeight(blockZ)

    let bestProgress = horizontalProgress(box, start)
    for (const height of heights) {
      const trial = cloneBox(start)
      if (sweepAxis(world, trial, 1, height))
        continue
      const trialX = sweepAxis(world, trial, 0, dx)
      const trialZ = sweepAxis(world, trial, 2, dz)
      // 抬升后的水平路径可能遇到同一步位移内的下一道立面。
      addHeight(trialX)
      addHeight(trialZ)
      const progress = horizontalProgress(trial, start)
      if (progress <= bestProgress + EPSILON)
        continue

      sweepAxis(world, trial, 1, -height)
      if (!probeGround(world, trial, snapDown) || world.queryAABB(trial, hits).length > 0)
        continue
      copyInto(box, trial)
      blockX = trialX
      blockZ = trialZ
      bestProgress = progress
      stepped = true
    }
  }
  const grounded = stepped || (dy <= 0 && probeGround(world, box, snapDown))
  return {
    grounded,
    hitX: blockX !== null,
    hitY,
    hitZ: blockZ !== null,
    stepped,
    stepDeltaY: box.min[1] - start.min[1],
  }
}
