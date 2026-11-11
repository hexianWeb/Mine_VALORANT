// @ts-check
import { moveAABB } from '../controller/character-controller.js'
import { cloneBox } from './collision-world.js'

/** 同步查询与求解。调度属于关卡的 Motor 批次。 */
export function createPhysicsSystem() {
  let lastStepMs = 0
  let disposed = false
  const assertLive = () => {
    if (disposed)
      throw new Error('[PhysicsSystem] Disposed')
  }
  return {
    name: 'physics',
    get lastStepMs() { return lastStepMs },
    /**
     * @param {import('./collision-world.js').CollisionWorld} world
     * @param {import('./collision-world.js').Box} box
     */
    overlaps(world, box) {
      assertLive()
      return world.queryAABB(box).length > 0
    },
    /**
     * 返回实际位移和接触，不改动调用方的 box。
     * @param {import('./collision-world.js').CollisionWorld} world
     * @param {import('./collision-world.js').Box} box
     * @param {number[]} displacement
     * @param {{ stepHeight?: number, snapDown?: number }} [options]
     */
    move(world, box, displacement, options) {
      assertLive()
      const start = performance.now()
      try {
        const moved = cloneBox(box)
        const contacts = moveAABB(world, moved, displacement, options)
        return {
          ...contacts,
          box: moved,
          displacement: moved.min.map((value, axis) => value - box.min[axis]),
        }
      }
      finally {
        lastStepMs = performance.now() - start
      }
    },
    dispose() { disposed = true },
  }
}
