# P2.1 物理与体积碰撞 Implementation Plan

> 状态：计划已执行，不要再按文中勾选框实现。`src/world/`、`src/engine/systems/` 和未勾选的步骤没有随后续运行时重构更新。现行说明见 [运行时架构](../../architecture.md) 与 [碰撞层 v1](../../physics/collision-layer.md)。文中的 checkbox 只保留当时的任务记录。

**Goal:** 玩家以第一人称在练枪房内外行走（重力、跑/静步/下蹲、跳跃、贴墙滑动、上台阶），碰撞来自已导出的 `public/collision/range-room.json`。

**Architecture:** 自写运动学 AABB 控制器，按 Y → X → Z 轴分离扫掠；宽相先暴力遍历，藏在 `CollisionWorld.queryAABB()` 后。引擎层只放通用的碰撞世界、控制器、物理/输入系统；练枪房相关的碰撞层规则（地面盒、`killY`、踩穿地板）和玩家参数放在 `src/world/`。`room-inspection.js` 负责把玩家模式与现有飞行/轨道模式组合起来。

**Tech Stack:** Three.js r187 `three/webgpu`、原生 ES Module、`node --test`、原生 CDP 浏览器脚本（`tools/browser-session.mjs`）。

**Spec:** `docs/superpowers/specs/2026-11-09-phase2-physics-collision-design.md`；碰撞层说明：`docs/physics/collision-layer.md`。

## Global Constraints

- 依赖方向 `world → engine`；`src/engine/` 不得 import `src/world/`。
- 不新增 npm 依赖；不引入物理库。
- 不添加外观调参面板（项目规则 no-lookdev-panels）；参数写在冻结配置对象里。「碰撞线框」按钮是调试开关，允许。
- 物理在 `fixedUpdate` 中以 `engine.time.fixedDelta`（1/60 s）推进；视角每帧更新；相机按 `time.alpha` 插值。
- 碰撞层 JSON 不含地面与 `killY`：地面盒顶面 = `world.ground.snapshot().height`，水平范围 = `outer`，厚 1 m；`killY` = `height − 10`。
- 踩穿地板：名称含 `_Floor_` 的盒子是地板盒；玩家脚底低于某地板盒底面且水平投影重叠 → 回到出生点。
- 移动参数：站立 0.6 × 1.8 m、眼高 1.62；下蹲高 1.5、眼高 1.27；跑/静步/下蹲 6.75 / 3.8 / 3.4 m/s；约 0.08 s 到全速或停下；空中控制 15%；重力 20 m/s²；跳跃高度 1.1 m；下落上限 50 m/s；上台阶 0.55 m；灵敏度每计数 0.07° × 0.4。
- 下蹲键改为 **C**（Ctrl 会与 Ctrl+W 关闭标签页冲突，浏览器无法拦截），在 Task 7 同步规格。
- `?player=0` 启动时停留飞行模式（现有依赖参考机位的浏览器脚本使用）。
- 提交信息遵循现有 commitlint 格式：`type(scope): 中文描述`。
- 基线：`npm test` 当前 40 项全部通过。

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `src/engine/systems/physics/collision-world.js` | 新建 | 静态 AABB 集合、`overlaps`、`cloneBox`、`queryAABB` |
| `src/engine/systems/physics/character-controller.js` | 新建 | `moveAABB`：轴分离扫掠、上台阶、贴地 |
| `src/engine/systems/physics/index.js` | 替换空壳 | `createPhysicsSystem()`：固定步推进刚体，记录耗时 |
| `src/engine/systems/input/index.js` | 替换空壳 | `createInputSystem()`：键盘 + Pointer Lock → 意图 |
| `src/world/collision-layer.js` | 新建 | 校验/加载碰撞层 JSON，加入地面盒，`killY` 与踩穿判定 |
| `src/world/player.js` | 新建 | 玩家参数、移动、下蹲、跳跃、重置、相机跟随 |
| `src/world/collision-debug.js` | 新建 | 碰撞盒线框（默认隐藏） |
| `src/room-inspection.js` | 修改 | 新增玩家模式、V 切换、碰撞线框按钮、快照 |
| `src/main.js` | 修改 | 加载碰撞层、`?player=0`、快照 `player` 字段 |
| `tools/check-room-browser.mjs`、`tools/check-inspection-browser.mjs`、`tools/check-ground-browser.mjs` | 修改 | 加 `player=0`，保持参考机位假设 |
| `tools/check-player-browser.mjs` | 新建 | 玩家模式浏览器验收 |
| `tests/physics.test.mjs`、`tests/input.test.mjs`、`tests/collision-layer.test.mjs`、`tests/player.test.mjs` | 新建 | 单元测试 |
| `readme.md`、规格 | 修改 | 操作说明与下蹲键 |

---

### Task 1: 碰撞世界与角色控制器

**Files:**
- Create: `src/engine/systems/physics/collision-world.js`
- Create: `src/engine/systems/physics/character-controller.js`
- Test: `tests/physics.test.mjs`

**Interfaces:**
- Consumes: 无
- Produces:
  - `overlaps(a: Box, b: Box): boolean`（接触面不算重叠）
  - `cloneBox(box: Box): { min: number[], max: number[] }`
  - `class CollisionWorld { boxes: Box[]; constructor(boxes?: Box[]); add(box: Box): Box; queryAABB(box: Box, out?: Box[]): Box[] }`
  - `moveAABB(world, box, [dx, dy, dz], { stepHeight = 0, snapDown = 0 }): { grounded, hitX, hitY, hitZ, stepped }`，原地修改 `box`
  - `Box = { min: [x, y, z], max: [x, y, z], name?: string, group?: string }`

- [ ] **Step 1: 写失败测试** `tests/physics.test.mjs`

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { moveAABB } from '../src/engine/systems/physics/character-controller.js'
import { CollisionWorld, overlaps } from '../src/engine/systems/physics/collision-world.js'

const player = (x, y, z, height = 1.8) => ({ min: [x - 0.3, y, z - 0.3], max: [x + 0.3, y + height, z + 0.3] })
const floor = { name: 'floor', min: [-10, -1, -10], max: [10, 0, 10] }
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} != ${expected}`)

test('overlap is strict and query returns only intersecting boxes', () => {
  const world = new CollisionWorld([floor, { name: 'far', min: [50, 0, 50], max: [51, 1, 51] }])
  assert.equal(overlaps(player(0, 0, 0), floor), false, 'touching faces do not overlap')
  assert.equal(overlaps(player(0, -0.1, 0), floor), true)
  assert.deepEqual(world.queryAABB(player(0, -0.1, 0)).map(box => box.name), ['floor'])
  const added = world.add({ name: 'wall', min: [1, 0, -1], max: [2, 2, 1] })
  assert.equal(world.boxes.at(-1), added)
})

test('falls and lands on the floor', () => {
  const world = new CollisionWorld([floor])
  const box = player(0, 1, 0)
  const result = moveAABB(world, box, [0, -2, 0])
  near(box.min[1], 0, 'feet')
  assert.equal(result.hitY, true)
  assert.equal(result.grounded, true)
})

test('slides along a wall and does not stick in a corner', () => {
  const world = new CollisionWorld([floor, { name: 'wallX', min: [1, 0, -5], max: [2, 3, 5] }, { name: 'wallZ', min: [-5, 0, 1], max: [5, 3, 2] }])
  const slide = player(0, 0, -2)
  const a = moveAABB(world, slide, [2, -0.01, 1])
  near(slide.max[0], 1, 'clamped at wall')
  near(slide.min[2], -2.3 + 1, 'slid along z')
  assert.equal(a.hitX, true)
  assert.equal(a.hitZ, false)
  const corner = player(0, 0, 0)
  moveAABB(world, corner, [2, -0.01, 2])
  near(corner.max[0], 1, 'corner x')
  near(corner.max[2], 1, 'corner z')
})

test('steps up a 0.5 m slab but is blocked by a full block', () => {
  const slab = new CollisionWorld([floor, { name: 'slab', min: [0.5, 0, -2], max: [3, 0.5, 2] }])
  const onSlab = player(0, 0, 0)
  const stepped = moveAABB(slab, onSlab, [0.5, -0.01, 0], { stepHeight: 0.55 })
  assert.equal(stepped.stepped, true)
  near(onSlab.min[1], 0.5, 'on slab top')
  near(onSlab.min[0], 0.2, 'advanced full distance')
  const block = new CollisionWorld([floor, { name: 'block', min: [0.5, 0, -2], max: [3, 1, 2] }])
  const blocked = player(0, 0, 0)
  const result = moveAABB(block, blocked, [0.5, -0.01, 0], { stepHeight: 0.55 })
  assert.equal(result.stepped, false)
  assert.equal(result.hitX, true)
  near(blocked.max[0], 0.5, 'stopped at block face')
  near(blocked.min[1], 0, 'stayed on floor')
})

test('does not step while airborne', () => {
  const world = new CollisionWorld([{ name: 'slab', min: [0.5, 0, -2], max: [3, 0.5, 2] }])
  const box = player(0, 0.2, 0)
  const result = moveAABB(world, box, [0.5, -0.01, 0], { stepHeight: 0.55 })
  assert.equal(result.stepped, false)
  near(box.max[0], 0.5, 'blocked in the air')
})

test('a 50 m/s fall step does not tunnel through a thin floor', () => {
  const world = new CollisionWorld([{ name: 'thin', min: [-5, -0.1, -5], max: [5, 0, 5] }])
  const box = player(0, 0.5, 0)
  moveAABB(world, box, [0, -50 / 60, 0])
  near(box.min[1], 0, 'stopped on thin floor')
})

test('snaps down a 0.5 m stair when walking off an edge, but not without snapDown', () => {
  const stairs = () => new CollisionWorld([
    { name: 'upper', min: [-10, -1, -10], max: [0, 0, 10] },
    { name: 'lower', min: [0, -1.5, -10], max: [10, -0.5, 10] },
  ])
  const snapped = player(-0.2, 0, 0)
  const a = moveAABB(stairs(), snapped, [1, -0.003, 0], { snapDown: 0.55 })
  near(snapped.min[1], -0.5, 'snapped to lower step')
  assert.equal(a.grounded, true)
  const falling = player(-0.2, 0, 0)
  const b = moveAABB(stairs(), falling, [1, -0.003, 0])
  assert.ok(falling.min[1] > -0.01, 'no snap without snapDown')
  assert.equal(b.grounded, false)
})

test('jumping up is never grounded and a ceiling stops the rise', () => {
  const world = new CollisionWorld([floor, { name: 'ceiling', min: [-5, 2, -5], max: [5, 3, 5] }])
  const box = player(0, 0, 0)
  const result = moveAABB(world, box, [0, 0.5, 0])
  near(box.max[1], 2, 'head at ceiling')
  assert.equal(result.hitY, true)
  assert.equal(result.grounded, false)
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/physics.test.mjs`
Expected: FAIL，`Cannot find module '.../collision-world.js'`

- [ ] **Step 3: 实现** `src/engine/systems/physics/collision-world.js`

```js
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
 * Strict overlap: touching faces do not count.
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
  return { min: [...box.min], max: [...box.max] }
}

/** Static AABB set. Queries are brute force behind `queryAABB`, so a grid or sort-and-sweep can replace it later. */
export class CollisionWorld {
  /** @param {Box[]} [boxes] */
  constructor(boxes = []) {
    /** @type {Box[]} */
    this.boxes = boxes.map(box => ({ ...box, min: [...box.min], max: [...box.max] }))
  }

  /** @param {Box} box */
  add(box) {
    const copy = { ...box, min: [...box.min], max: [...box.max] }
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
```

- [ ] **Step 4: 实现** `src/engine/systems/physics/character-controller.js`

```js
// @ts-check
import { cloneBox } from './collision-world.js'

const EPSILON = 1e-6
const GROUND_PROBE = 0.01
/** @type {import('./collision-world.js').Box[]} */
const hits = []

/**
 * Move `box` along one axis until it touches the nearest box ahead.
 * Boxes it already overlaps are ignored so a body that starts inside geometry can still leave.
 * @param {import('./collision-world.js').CollisionWorld} world
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

function copyInto(target, source) {
  for (let i = 0; i < 3; i++) {
    target.min[i] = source.min[i]
    target.max[i] = source.max[i]
  }
}

function horizontalProgress(box, start) {
  return Math.hypot(box.min[0] - start.min[0], box.min[2] - start.min[2])
}

/**
 * Axis-separated kinematic move: Y, then X, then Z. Mutates `box`.
 * Step-up only starts from a supported pose; `snapDown` keeps a walking body glued to stairs going down.
 * @param {import('./collision-world.js').CollisionWorld} world
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
  const ground = sweepAxis(world, probe, 1, -(snapDown > 0 ? snapDown : GROUND_PROBE))
  const grounded = dy <= 0 && ground.hit
  if (grounded && snapDown > 0)
    copyInto(box, probe)
  return { grounded, hitX, hitY: y.hit, hitZ, stepped }
}
```

- [ ] **Step 5: 运行确认通过**

Run: `node --test tests/physics.test.mjs`
Expected: 8 项 PASS

- [ ] **Step 6: 提交**

```bash
git add src/engine/systems/physics/collision-world.js src/engine/systems/physics/character-controller.js tests/physics.test.mjs
git commit -m "feat(physics): 添加 AABB 碰撞世界与轴分离角色控制器"
```

---

### Task 2: 物理系统

**Files:**
- Modify (替换全部内容): `src/engine/systems/physics/index.js`
- Test: `tests/physics.test.mjs`（追加）

**Interfaces:**
- Consumes: 无
- Produces: `createPhysicsSystem(): { name: 'physics', add(body: { fixedUpdate(dt: number): void }): () => void, readonly lastStepMs: number, fixedUpdate(engine): void, dispose(): void }`

- [ ] **Step 1: 追加失败测试** 到 `tests/physics.test.mjs`

在文件顶部 import 区追加：

```js
import { createPhysicsSystem } from '../src/engine/systems/physics/index.js'
```

在文件末尾追加：

```js
test('physics system steps bodies with the fixed delta and records step time', () => {
  const physics = createPhysicsSystem()
  const steps = []
  const remove = physics.add({ fixedUpdate: dt => steps.push(dt) })
  const engine = { time: { fixedDelta: 1 / 60 } }
  physics.fixedUpdate(engine)
  physics.fixedUpdate(engine)
  assert.deepEqual(steps, [1 / 60, 1 / 60])
  assert.ok(physics.lastStepMs >= 0)
  remove()
  physics.fixedUpdate(engine)
  assert.equal(steps.length, 2)
  physics.add({ fixedUpdate: () => steps.push(0) })
  physics.dispose()
  physics.fixedUpdate(engine)
  assert.equal(steps.length, 2)
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/physics.test.mjs`
Expected: FAIL，`createPhysicsSystem` is not exported

- [ ] **Step 3: 实现** `src/engine/systems/physics/index.js`（替换原 TODO 空壳）

```js
// @ts-check

/** @typedef {{ fixedUpdate: (dt: number) => void }} Body */

/** Phase 'physics': steps registered bodies at `time.fixedDelta`. */
export function createPhysicsSystem() {
  /** @type {Set<Body>} */
  const bodies = new Set()
  let lastStepMs = 0
  return {
    name: 'physics',
    /** @param {Body} body */
    add(body) {
      bodies.add(body)
      return () => {
        bodies.delete(body)
      }
    },
    get lastStepMs() {
      return lastStepMs
    },
    /** @param {import('../../core/engine.js').Engine} engine */
    fixedUpdate(engine) {
      const start = performance.now()
      for (const body of bodies) body.fixedUpdate(engine.time.fixedDelta)
      lastStepMs = performance.now() - start
    },
    dispose() {
      bodies.clear()
    },
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/physics.test.mjs`
Expected: 9 项 PASS

- [ ] **Step 5: 提交**

```bash
git add src/engine/systems/physics/index.js tests/physics.test.mjs
git commit -m "feat(physics): 实现固定步物理系统"
```

---

### Task 3: 输入系统

**Files:**
- Modify (替换全部内容): `src/engine/systems/input/index.js`
- Test: `tests/input.test.mjs`

**Interfaces:**
- Consumes: `Disposer`（`src/engine/core/disposer.js`）
- Produces: `createInputSystem({ element }): { name: 'input', intent: { moveX, moveZ, walk, crouch }, readonly locked: boolean, readonly enabled: boolean, setEnabled(value): void, requestLock(): void, consumeJump(): boolean, consumeLook(): [dx, dy], dispose(): void }`
  - `moveX`：右 +1 / 左 −1；`moveZ`：前 +1 / 后 −1
  - 键位：WASD、Shift 静步、C 下蹲、空格跳跃
  - 按键在「启用且（已锁定鼠标或画布获得焦点）」时生效；鼠标视角只在锁定时累计；解除锁定会清空按键并让画布失焦

- [ ] **Step 1: 写失败测试** `tests/input.test.mjs`

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { createInputSystem } from '../src/engine/systems/input/index.js'

function setup() {
  const window = new EventTarget()
  const document = Object.assign(new EventTarget(), {
    defaultView: window,
    activeElement: null,
    pointerLockElement: null,
    exitPointerLock() {
      this.pointerLockElement = null
      this.dispatchEvent(new Event('pointerlockchange'))
    },
  })
  const element = Object.assign(new EventTarget(), {
    ownerDocument: document,
    lockOptions: null,
    focus() {
      document.activeElement = element
    },
    blur() {
      if (document.activeElement === element)
        document.activeElement = null
    },
    requestPointerLock(options) {
      element.lockOptions = options
      document.pointerLockElement = element
      document.dispatchEvent(new Event('pointerlockchange'))
      return Promise.resolve()
    },
  })
  const key = (type, code, extra = {}) => {
    const event = Object.assign(new Event(type, { cancelable: true }), { code, repeat: false, altKey: false, metaKey: false, ...extra })
    window.dispatchEvent(event)
    return event
  }
  const move = (x, y) => document.dispatchEvent(Object.assign(new Event('mousemove'), { movementX: x, movementY: y }))
  return { window, document, element, key, move, input: createInputSystem({ element }) }
}

test('ignores keys while disabled or unfocused', () => {
  const { input, element, key } = setup()
  key('keydown', 'KeyW')
  assert.equal(input.intent.moveZ, 0)
  input.setEnabled(true)
  key('keydown', 'KeyW')
  assert.equal(input.intent.moveZ, 0, 'canvas not focused')
  element.focus()
  key('keydown', 'KeyW')
  assert.equal(input.intent.moveZ, 1)
  input.dispose()
})

test('maps WASD, walk and crouch; jump is consumed once and repeats are ignored', () => {
  const { input, element, key } = setup()
  input.setEnabled(true)
  element.focus()
  const event = key('keydown', 'KeyD')
  assert.equal(event.defaultPrevented, true)
  key('keydown', 'KeyS')
  key('keydown', 'ShiftLeft')
  key('keydown', 'KeyC')
  assert.deepEqual({ ...input.intent }, { moveX: 1, moveZ: -1, walk: true, crouch: true })
  key('keyup', 'KeyD')
  key('keyup', 'ShiftLeft')
  assert.equal(input.intent.moveX, 0)
  assert.equal(input.intent.walk, false)
  key('keydown', 'Space')
  key('keydown', 'Space', { repeat: true })
  assert.equal(input.consumeJump(), true)
  assert.equal(input.consumeJump(), false)
  input.dispose()
})

test('mouse look accumulates only while pointer-locked; click requests raw input lock', () => {
  const { input, element, move } = setup()
  input.setEnabled(true)
  move(5, 5)
  assert.deepEqual(input.consumeLook(), [0, 0])
  element.dispatchEvent(new Event('click'))
  assert.deepEqual(element.lockOptions, { unadjustedMovement: true })
  assert.equal(input.locked, true)
  move(5, -2)
  move(1, 1)
  assert.deepEqual(input.consumeLook(), [6, -1])
  assert.deepEqual(input.consumeLook(), [0, 0])
  input.dispose()
})

test('unlocking, window blur and disabling clear held input', () => {
  const { input, element, document, window, key } = setup()
  input.setEnabled(true)
  element.dispatchEvent(new Event('click'))
  key('keydown', 'KeyW')
  assert.equal(input.intent.moveZ, 1)
  document.exitPointerLock()
  assert.equal(input.intent.moveZ, 0)
  assert.equal(document.activeElement, null, 'Esc releases keyboard too')
  element.focus()
  key('keydown', 'KeyA')
  window.dispatchEvent(new Event('blur'))
  assert.equal(input.intent.moveX, 0)
  element.dispatchEvent(new Event('click'))
  input.setEnabled(false)
  assert.equal(document.pointerLockElement, null)
  input.dispose()
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/input.test.mjs`
Expected: FAIL，`createInputSystem` is not exported

- [ ] **Step 3: 实现** `src/engine/systems/input/index.js`（替换原 TODO 空壳）

```js
// @ts-check
import { Disposer } from '../../core/disposer.js'

/** Ctrl is avoided for crouch: the browser cannot block Ctrl+W while moving forward. */
const bindings = Object.freeze({
  KeyW: 'forward',
  KeyS: 'back',
  KeyA: 'left',
  KeyD: 'right',
  ShiftLeft: 'walk',
  ShiftRight: 'walk',
  KeyC: 'crouch',
  Space: 'jump',
})

/**
 * Phase 'input'. Keyboard + Pointer Lock -> intent; gameplay never reads DOM events.
 * Keys count while enabled and the element is focused or pointer-locked; mouse look only while locked.
 * @param {{ element: HTMLElement }} options
 */
export function createInputSystem({ element }) {
  const document = element.ownerDocument
  const window = document.defaultView
  const disposer = new Disposer()
  /** @type {Set<string>} */
  const held = new Set()
  const intent = { moveX: 0, moveZ: 0, walk: false, crouch: false }
  let enabled = false
  let jumpQueued = false
  let lookX = 0
  let lookY = 0
  const locked = () => document.pointerLockElement === element
  const active = () => enabled && (locked() || document.activeElement === element)
  const pressed = action => [...held].some(code => bindings[code] === action)
  const refresh = () => {
    intent.moveX = Number(pressed('right')) - Number(pressed('left'))
    intent.moveZ = Number(pressed('forward')) - Number(pressed('back'))
    intent.walk = pressed('walk')
    intent.crouch = pressed('crouch')
  }
  const clear = () => {
    held.clear()
    jumpQueued = false
    lookX = 0
    lookY = 0
    refresh()
  }
  const requestLock = () => {
    element.focus({ preventScroll: true })
    Promise.resolve(element.requestPointerLock({ unadjustedMovement: true }))
      .catch(() => Promise.resolve(element.requestPointerLock()).catch(() => {}))
  }
  disposer.listen(window, 'keydown', (/** @type {KeyboardEvent} */ event) => {
    if (!active() || !(event.code in bindings) || event.altKey || event.metaKey)
      return
    event.preventDefault()
    if (bindings[event.code] === 'jump' && !event.repeat)
      jumpQueued = true
    held.add(event.code)
    refresh()
  })
  disposer.listen(window, 'keyup', (/** @type {KeyboardEvent} */ event) => {
    if (held.delete(event.code))
      refresh()
  })
  disposer.listen(document, 'mousemove', (/** @type {MouseEvent} */ event) => {
    if (!enabled || !locked())
      return
    lookX += event.movementX
    lookY += event.movementY
  })
  disposer.listen(element, 'click', () => {
    if (enabled && !locked())
      requestLock()
  })
  disposer.listen(document, 'pointerlockchange', () => {
    if (locked())
      return
    clear()
    element.blur()
  })
  disposer.listen(window, 'blur', clear)
  disposer.listen(document, 'visibilitychange', clear)
  const api = {
    name: 'input',
    intent,
    get locked() {
      return locked()
    },
    get enabled() {
      return enabled
    },
    /** @param {boolean} value */
    setEnabled(value) {
      enabled = !!value
      if (enabled)
        return
      clear()
      if (locked())
        document.exitPointerLock()
    },
    requestLock,
    consumeJump() {
      const queued = jumpQueued
      jumpQueued = false
      return queued
    },
    /** @returns {[number, number]} accumulated mouse counts since the last call */
    consumeLook() {
      const look = /** @type {[number, number]} */ ([lookX, lookY])
      lookX = 0
      lookY = 0
      return look
    },
    dispose() {
      api.setEnabled(false)
      disposer.dispose()
    },
  }
  return api
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/input.test.mjs`
Expected: 4 项 PASS

- [ ] **Step 5: 提交**

```bash
git add src/engine/systems/input/index.js tests/input.test.mjs
git commit -m "feat(input): 实现键盘与 Pointer Lock 输入系统"
```

---

### Task 4: 练枪房碰撞层（地面盒、killY、踩穿地板）

**Files:**
- Create: `src/world/collision-layer.js`
- Test: `tests/collision-layer.test.mjs`

**Interfaces:**
- Consumes: `CollisionWorld`（Task 1）
- Produces:
  - `collisionLayerConfig`（`url`、`groundThickness: 1`、`killDepth: 10`、`floorTag: '_Floor_'`）
  - `validateCollisionData(data): data`，不合法时抛错
  - `createCollisionLayer(data, ground: { height, outer: { minX, maxX, minZ, maxZ } }, config?)` → `{ world: CollisionWorld, floors: Box[], killY: number, groundHeight: number, spawn: { position: number[], yaw: number /* 弧度 */ }, isOutOfBounds(box): boolean, snapshot() }`
  - `loadCollisionLayer({ ground, signal?, config? }): Promise<同上>`

- [ ] **Step 1: 写失败测试** `tests/collision-layer.test.mjs`

```js
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { overlaps } from '../src/engine/systems/physics/collision-world.js'
import { createCollisionLayer, validateCollisionData } from '../src/world/collision-layer.js'

const data = JSON.parse(fs.readFileSync(new URL('../public/collision/range-room.json', import.meta.url)))
// Runtime model bounds measured in the browser (`__RANGE_ROOM__.world.snapshot().bounds`).
const ROOM_BOUNDS = { min: [-25, 7.875, -22.005], max: [26, 30.125, 23] }
const GROUND = { height: 7.865, outer: { minX: -8191.5, maxX: 8192.5, minZ: -8191.5, maxZ: 8192.5 } }
const standing = ([x, y, z]) => ({ min: [x - 0.3, y, z - 0.3], max: [x + 0.3, y + 1.8, z + 0.3] })

test('exported collision layer is valid and inside the room bounds', () => {
  assert.doesNotThrow(() => validateCollisionData(data))
  assert.equal(data.boxes.length, 390)
  for (const box of data.boxes) {
    for (let i = 0; i < 3; i++) {
      assert.ok(box.min[i] < box.max[i], `${box.name} degenerate on axis ${i}`)
      assert.ok(box.min[i] >= ROOM_BOUNDS.min[i] - 2 && box.max[i] <= ROOM_BOUNDS.max[i] + 2, `${box.name} outside room bounds`)
    }
  }
})

test('spawn stands on a floor without overlapping any box', () => {
  const feet = data.spawn.position
  const body = standing(feet)
  assert.deepEqual(data.boxes.filter(box => overlaps(body, box)).map(box => box.name), [])
  const support = data.boxes.filter(box => box.min[0] <= feet[0] && feet[0] <= box.max[0] && box.min[2] <= feet[2] && feet[2] <= box.max[2] && Math.abs(box.max[1] - feet[1]) < 0.01)
  assert.ok(support.length > 0, 'a floor box is directly under the spawn')
})

test('runtime layer adds the ground box, killY and converts spawn yaw to radians', () => {
  const layer = createCollisionLayer(data, GROUND)
  const ground = layer.world.boxes.at(-1)
  assert.equal(ground.name, 'Ground')
  assert.deepEqual(ground.min, [GROUND.outer.minX, GROUND.height - 1, GROUND.outer.minZ])
  assert.deepEqual(ground.max, [GROUND.outer.maxX, GROUND.height, GROUND.outer.maxZ])
  assert.ok(Math.abs(layer.killY - (GROUND.height - 10)) < 1e-9)
  assert.equal(layer.floors.length, 50)
  assert.ok(Math.abs(layer.spawn.yaw - data.spawn.yawDeg * Math.PI / 180) < 1e-12)
  assert.deepEqual(layer.snapshot(), { id: data.id, boxes: 390, floors: 50, groundHeight: GROUND.height, killY: layer.killY })
})

test('out of bounds: below killY or under a floor box, but not beside one', () => {
  const layer = createCollisionLayer({
    schemaVersion: 1,
    spawn: { position: [0, 1, 0], yawDeg: 0 },
    boxes: [{ name: 'COL_Test_Floor_01', min: [-5, 0.5, -5], max: [5, 1, 5] }],
  }, { height: 0, outer: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 } })
  assert.equal(layer.isOutOfBounds(standing([0, 1, 0])), false, 'on top of the floor')
  assert.equal(layer.isOutOfBounds(standing([0, 0, 0])), true, 'under the floor')
  assert.equal(layer.isOutOfBounds(standing([5.3, 0, 0])), false, 'touching the floor side from outside')
  assert.equal(layer.isOutOfBounds(standing([20, -10.5, 0])), true, 'below killY')
  assert.equal(layer.isOutOfBounds(standing([20, 0, 0])), false, 'on the ground')
})

test('validation rejects broken data', () => {
  const box = { name: 'a', min: [0, 0, 0], max: [1, 1, 1] }
  const valid = { schemaVersion: 1, spawn: { position: [0, 0, 0], yawDeg: 0 }, boxes: [box] }
  assert.throws(() => validateCollisionData({ ...valid, schemaVersion: 2 }), /schemaVersion/)
  assert.throws(() => validateCollisionData({ ...valid, spawn: { position: [0, 0], yawDeg: 0 } }), /spawn/)
  assert.throws(() => validateCollisionData({ ...valid, boxes: [] }), /boxes/)
  assert.throws(() => validateCollisionData({ ...valid, boxes: [{ ...box, max: [1, 0, 1] }] }), /Invalid box a/)
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/collision-layer.test.mjs`
Expected: FAIL，`Cannot find module '.../collision-layer.js'`

- [ ] **Step 3: 实现** `src/world/collision-layer.js`

```js
import { CollisionWorld } from '../engine/systems/physics/collision-world.js'

export const collisionLayerConfig = Object.freeze({
  url: '/collision/range-room.json',
  groundThickness: 1,
  killDepth: 10,
  floorTag: '_Floor_',
})

const EPSILON = 1e-4
const isVector = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)

export function validateCollisionData(data) {
  if (data?.schemaVersion !== 1)
    throw new Error('[Collision] Unsupported schemaVersion')
  if (!isVector(data.spawn?.position) || !Number.isFinite(data.spawn?.yawDeg))
    throw new Error('[Collision] Invalid spawn')
  if (!Array.isArray(data.boxes) || !data.boxes.length)
    throw new Error('[Collision] No boxes')
  for (const box of data.boxes) {
    if (typeof box?.name !== 'string' || !isVector(box.min) || !isVector(box.max) || box.min.some((value, i) => value >= box.max[i]))
      throw new Error(`[Collision] Invalid box ${box?.name}`)
  }
  return data
}

/** Room boxes plus a ground box and killY derived from the superflat ground, so collision follows the visuals. */
export function createCollisionLayer(data, ground, config = {}) {
  const settings = { ...collisionLayerConfig, ...config }
  validateCollisionData(data)
  const { height, outer } = ground
  const world = new CollisionWorld(data.boxes)
  world.add({
    name: 'Ground',
    group: 'Ground',
    min: [outer.minX, height - settings.groundThickness, outer.minZ],
    max: [outer.maxX, height, outer.maxZ],
  })
  const floors = world.boxes.filter(box => box.name.includes(settings.floorTag))
  const killY = height - settings.killDepth
  return {
    world,
    floors,
    killY,
    groundHeight: height,
    spawn: {
      position: [...data.spawn.position],
      yaw: data.spawn.yawDeg * Math.PI / 180,
    },
    /** Below killY, or entirely under a floor box it overlaps horizontally: only reachable by clipping. */
    isOutOfBounds(box) {
      if (box.min[1] < killY)
        return true
      return floors.some(floor => box.min[1] < floor.min[1]
        && box.min[0] < floor.max[0] - EPSILON && box.max[0] > floor.min[0] + EPSILON
        && box.min[2] < floor.max[2] - EPSILON && box.max[2] > floor.min[2] + EPSILON)
    },
    snapshot() {
      return { id: data.id, boxes: data.boxes.length, floors: floors.length, groundHeight: height, killY }
    },
  }
}

export async function loadCollisionLayer({ ground, signal, config = {} }) {
  const url = config.url ?? collisionLayerConfig.url
  const response = await fetch(url, { signal })
  if (!response.ok)
    throw new Error(`[Collision] ${url}: HTTP ${response.status}`)
  return createCollisionLayer(await response.json(), ground, config)
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/collision-layer.test.mjs`
Expected: 5 项 PASS

- [ ] **Step 5: 提交**

```bash
git add src/world/collision-layer.js tests/collision-layer.test.mjs
git commit -m "feat(world): 加载碰撞层并派生地面盒与重置规则"
```

---

### Task 5: 玩家

**Files:**
- Create: `src/world/player.js`
- Test: `tests/player.test.mjs`

**Interfaces:**
- Consumes: `moveAABB`（Task 1）、`createCollisionLayer` 返回值（Task 4）、输入对象形状 `{ intent: { moveX, moveZ, walk, crouch }, consumeJump(): boolean }`（Task 3）
- Produces:
  - `playerConfig`（见 Global Constraints 的数值）
  - `createPlayer({ camera, collision, input, config? })` → `{ position: Vector3 /* 脚底中心 */, velocity: Vector3, grounded, crouched, yaw, pitch, enabled, respawns, setEnabled(v), teleport(feet: number[], yaw: number, pitch?: number), respawn(), placeAtCamera(), look(dx, dy), fixedUpdate(dt), updateCamera(alpha, dt), snapshot() }`
  - 朝向约定：`yaw = 0` 面向 −Z，前方 = (−sin yaw, 0, −cos yaw)，右方 = (cos yaw, 0, −sin yaw)

- [ ] **Step 1: 写失败测试** `tests/player.test.mjs`

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three/webgpu'
import { createCollisionLayer } from '../src/world/collision-layer.js'
import { createPlayer, playerConfig } from '../src/world/player.js'

const near = (actual, expected, tolerance, message) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`)

function setup(boxes = [], spawn = [0, 0, 0]) {
  const collision = createCollisionLayer({
    schemaVersion: 1,
    spawn: { position: spawn, yawDeg: 0 },
    boxes: [...boxes, { name: 'COL_Far', min: [90, 0, 90], max: [91, 1, 91] }],
  }, { height: 0, outer: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 } })
  const intent = { moveX: 0, moveZ: 0, walk: false, crouch: false }
  let jump = false
  const input = {
    intent,
    consumeJump() {
      const queued = jump
      jump = false
      return queued
    },
  }
  const camera = new THREE.PerspectiveCamera()
  const player = createPlayer({ camera, collision, input })
  player.setEnabled(true)
  const step = (count = 1) => {
    for (let i = 0; i < count; i++) player.fixedUpdate(1 / 60)
  }
  return { player, intent, camera, step, collision, pressJump: () => { jump = true } }
}

const horizontalSpeed = player => Math.hypot(player.velocity.x, player.velocity.z)

test('settles on the runtime ground at the spawn', () => {
  const { player, step } = setup()
  step(30)
  assert.equal(player.grounded, true)
  near(player.position.y, 0, 1e-9, 'feet on ground')
  assert.equal(player.respawns, 0)
})

test('reaches run speed and counter-strafes to a stop within 0.1 s; walk is slower', () => {
  const { player, intent, step } = setup()
  step(10)
  intent.moveZ = 1
  step(6)
  near(horizontalSpeed(player), playerConfig.runSpeed, 1e-9, 'run speed')
  near(player.velocity.z, -playerConfig.runSpeed, 1e-9, 'yaw 0 moves toward -Z')
  intent.moveZ = 0
  step(6)
  near(horizontalSpeed(player), 0, 1e-9, 'stopped')
  intent.moveX = 1
  intent.walk = true
  step(10)
  near(player.velocity.x, playerConfig.walkSpeed, 1e-9, 'walk speed to the right')
})

test('jump apex is 1.1 m and the player lands again', () => {
  const { player, step, pressJump } = setup()
  step(10)
  pressJump()
  let apex = 0
  for (let i = 0; i < 60; i++) {
    step()
    apex = Math.max(apex, player.position.y)
  }
  near(apex, playerConfig.jumpHeight, 0.01, 'apex')
  assert.equal(player.grounded, true)
  near(player.position.y, 0, 1e-9, 'landed')
})

test('crouch cannot stand up under a low ceiling but stands when free', () => {
  const low = setup([{ name: 'COL_Ceiling', min: [-5, 1.6, -5], max: [5, 2, 5] }])
  low.intent.crouch = true
  low.step(10)
  assert.equal(low.player.crouched, true)
  low.intent.crouch = false
  low.step(5)
  assert.equal(low.player.crouched, true, 'ceiling blocks standing')
  const free = setup()
  free.intent.crouch = true
  free.step(5)
  free.intent.crouch = false
  free.step(1)
  assert.equal(free.player.crouched, false)
})

test('clipping under a floor box respawns; standing on it or beside it does not', () => {
  const floorBox = { name: 'COL_Test_Floor_01', min: [-5, 1, -5], max: [5, 1.5, 5] }
  const onTop = setup([floorBox], [0, 1.5, 0])
  onTop.step(30)
  near(onTop.player.position.y, 1.5, 1e-9, 'stands on floor box')
  assert.equal(onTop.player.respawns, 0)
  onTop.player.position.set(0, 0, 0)
  onTop.step()
  assert.equal(onTop.player.respawns, 1)
  near(onTop.player.position.y, 1.5, 1e-9, 'back at spawn')
  const beside = setup([{ name: 'COL_Test_Floor_02', min: [0.3, 0.5, -1], max: [5, 1, 1] }])
  beside.intent.moveX = 1
  beside.step(60)
  near(beside.player.position.x, 0, 1e-9, 'pressed against the slab side')
  assert.equal(beside.player.respawns, 0)
})

test('falling below killY respawns', () => {
  const { player, step } = setup()
  player.position.set(0, -11, 0)
  step()
  assert.equal(player.respawns, 1)
  near(player.position.y, 0, 1e-9, 'back at spawn')
})

test('look uses Valorant scale and clamps pitch', () => {
  const { player } = setup()
  player.look(100, 0)
  near(player.yaw, THREE.MathUtils.degToRad(-100 * playerConfig.degreesPerCount * playerConfig.sensitivity), 1e-12, 'yaw')
  player.look(0, -1e7)
  near(player.pitch, THREE.MathUtils.degToRad(playerConfig.maxPitchDeg), 1e-12, 'pitch clamp')
})

test('camera interpolates between fixed steps at eye height', () => {
  const { player, intent, camera, step } = setup()
  step(10)
  intent.moveZ = 1
  step(10)
  const before = player.position.clone()
  step()
  const after = player.position.clone()
  player.updateCamera(0.5, 10)
  near(camera.position.z, (before.z + after.z) / 2, 1e-9, 'interpolated z')
  near(camera.position.y, after.y + playerConfig.standEye, 1e-6, 'eye height')
})

test('placeAtCamera keeps a free pose and falls back to spawn when blocked', () => {
  const { player, camera } = setup([{ name: 'COL_Block', min: [4, 0, 4], max: [6, 3, 6] }], [0, 0, 0])
  camera.position.set(10, 2 + playerConfig.standEye, 10)
  player.placeAtCamera()
  player.position.toArray().forEach((value, i) => near(value, [10, 2, 10][i], 1e-9, `free pose axis ${i}`))
  assert.equal(player.respawns, 0)
  camera.position.set(5, playerConfig.standEye, 5)
  player.placeAtCamera()
  assert.deepEqual(player.position.toArray(), [0, 0, 0])
  assert.equal(player.respawns, 1)
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/player.test.mjs`
Expected: FAIL，`Cannot find module '.../player.js'`

- [ ] **Step 3: 实现** `src/world/player.js`

```js
import * as THREE from 'three/webgpu'
import { moveAABB } from '../engine/systems/physics/character-controller.js'

/** Speeds follow published Valorant values as a starting point; body size and step height fit Minecraft blocks. */
export const playerConfig = Object.freeze({
  width: 0.6,
  standHeight: 1.8,
  standEye: 1.62,
  crouchHeight: 1.5,
  crouchEye: 1.27,
  runSpeed: 6.75,
  walkSpeed: 3.8,
  crouchSpeed: 3.4,
  accelTime: 0.08,
  airControl: 0.15,
  gravity: 20,
  jumpHeight: 1.1,
  maxFallSpeed: 50,
  stepHeight: 0.55,
  sensitivity: 0.4,
  degreesPerCount: 0.07,
  maxPitchDeg: 89,
  eyeSmoothing: 12,
})

/** First-person body: yaw 0 faces -Z, position is the feet centre. */
export function createPlayer({ camera, collision, input, config = {} }) {
  const settings = { ...playerConfig, ...config }
  const position = new THREE.Vector3()
  const previous = new THREE.Vector3()
  const velocity = new THREE.Vector3()
  const euler = new THREE.Euler(0, 0, 0, 'YXZ')
  const maxPitch = THREE.MathUtils.degToRad(settings.maxPitchDeg)
  const radiansPerCount = THREE.MathUtils.degToRad(settings.degreesPerCount) * settings.sensitivity
  const groundAccel = settings.runSpeed / settings.accelTime
  const jumpSpeed = Math.sqrt(2 * settings.gravity * settings.jumpHeight)
  let yaw = 0
  let pitch = 0
  let grounded = false
  let crouched = false
  let enabled = false
  let eye = settings.standEye
  let respawns = 0

  const boxAt = (feet, height) => {
    const half = settings.width / 2
    return { min: [feet.x - half, feet.y, feet.z - half], max: [feet.x + half, feet.y + height, feet.z + half] }
  }
  const blocked = box => collision.world.queryAABB(box).length > 0

  const api = {
    get position() { return position },
    get velocity() { return velocity },
    get grounded() { return grounded },
    get crouched() { return crouched },
    get yaw() { return yaw },
    get pitch() { return pitch },
    get enabled() { return enabled },
    get respawns() { return respawns },
    setEnabled(value) {
      enabled = !!value
    },
    teleport(feet, newYaw, newPitch = 0) {
      position.fromArray(feet)
      previous.copy(position)
      velocity.set(0, 0, 0)
      yaw = newYaw
      pitch = THREE.MathUtils.clamp(newPitch, -maxPitch, maxPitch)
      grounded = false
      crouched = false
      eye = settings.standEye
    },
    respawn() {
      api.teleport(collision.spawn.position, collision.spawn.yaw)
      respawns++
    },
    /** Feet go `standEye` below the camera; a blocked pose falls back to the spawn. */
    placeAtCamera() {
      euler.setFromQuaternion(camera.quaternion, 'YXZ')
      const feet = camera.position.clone()
      feet.y -= settings.standEye
      if (blocked(boxAt(feet, settings.standHeight)))
        api.respawn()
      else
        api.teleport(feet.toArray(), euler.y, euler.x)
    },
    look(dx, dy) {
      yaw -= dx * radiansPerCount
      pitch = THREE.MathUtils.clamp(pitch - dy * radiansPerCount, -maxPitch, maxPitch)
    },
    fixedUpdate(dt) {
      if (!enabled)
        return
      previous.copy(position)
      const intent = input.intent
      if (intent.crouch)
        crouched = true
      else if (crouched && !blocked(boxAt(position, settings.standHeight)))
        crouched = false

      const sin = Math.sin(yaw)
      const cos = Math.cos(yaw)
      let wishX = intent.moveX * cos - intent.moveZ * sin
      let wishZ = -intent.moveX * sin - intent.moveZ * cos
      const wishLength = Math.hypot(wishX, wishZ)
      if (wishLength > 1) {
        wishX /= wishLength
        wishZ /= wishLength
      }
      const speed = crouched ? settings.crouchSpeed : intent.walk ? settings.walkSpeed : settings.runSpeed
      if (grounded || wishLength > 0) {
        const maxChange = groundAccel * (grounded ? 1 : settings.airControl) * dt
        const changeX = wishX * speed - velocity.x
        const changeZ = wishZ * speed - velocity.z
        const change = Math.hypot(changeX, changeZ)
        const scale = change > maxChange ? maxChange / change : 1
        velocity.x += changeX * scale
        velocity.z += changeZ * scale
      }

      const jumped = input.consumeJump() && grounded
      if (jumped)
        velocity.y = jumpSpeed
      const moveY = velocity.y * dt - 0.5 * settings.gravity * dt * dt
      velocity.y = Math.max(velocity.y - settings.gravity * dt, -settings.maxFallSpeed)

      const box = boxAt(position, crouched ? settings.crouchHeight : settings.standHeight)
      const result = moveAABB(collision.world, box, [velocity.x * dt, moveY, velocity.z * dt], {
        stepHeight: settings.stepHeight,
        snapDown: grounded && !jumped ? settings.stepHeight : 0,
      })
      position.set((box.min[0] + box.max[0]) / 2, box.min[1], (box.min[2] + box.max[2]) / 2)
      if (result.hitX)
        velocity.x = 0
      if (result.hitZ)
        velocity.z = 0
      if (result.hitY || (result.grounded && velocity.y < 0))
        velocity.y = 0
      grounded = result.grounded
      if (collision.isOutOfBounds(box))
        api.respawn()
    },
    updateCamera(alpha, dt) {
      const target = crouched ? settings.crouchEye : settings.standEye
      eye += (target - eye) * (1 - Math.exp(-settings.eyeSmoothing * dt))
      camera.position.lerpVectors(previous, position, alpha)
      camera.position.y += eye
      euler.set(pitch, yaw, 0, 'YXZ')
      camera.quaternion.setFromEuler(euler)
    },
    snapshot() {
      return {
        position: position.toArray(),
        velocity: velocity.toArray(),
        grounded,
        crouched,
        yawDeg: THREE.MathUtils.radToDeg(yaw),
        pitchDeg: THREE.MathUtils.radToDeg(pitch),
        respawns,
      }
    },
  }
  api.teleport(collision.spawn.position, collision.spawn.yaw)
  return api
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/player.test.mjs`
Expected: 9 项 PASS

- [ ] **Step 5: 运行全部单元测试**

Run: `npm test`
Expected: 40 + 9 + 4 + 5 + 9 = 67 项 PASS

- [ ] **Step 6: 提交**

```bash
git add src/world/player.js tests/player.test.mjs
git commit -m "feat(world): 添加第一人称玩家移动与重置"
```

---

### Task 6: 碰撞线框与玩家模式接入

**Files:**
- Create: `src/world/collision-debug.js`
- Modify: `src/room-inspection.js`（整文件替换，见 Step 4）
- Modify: `src/main.js`
- Modify: `tools/check-room-browser.mjs:15`、`tools/check-inspection-browser.mjs:9`、`tools/check-ground-browser.mjs:9`
- Test: `tests/collision-layer.test.mjs`（追加线框测试）

**Interfaces:**
- Consumes: Task 2 `createPhysicsSystem`、Task 3 `createInputSystem`、Task 4 `loadCollisionLayer`、Task 5 `createPlayer`
- Produces:
  - `createCollisionDebug(boxes, { color? }) → { root: LineSegments, readonly visible, setVisible(v), snapshot(), dispose() }`
  - `createRoomInspection({ ..., collision = null, startMode = 'fly' })`；返回值新增 `player`、`input`、`collision`、`collisionDebug`、`physics`、`setCollisionDebug(v)`；`setMode` 接受 `'player' | 'fly' | 'orbit'`
  - `inspection.snapshot().player = { position, velocity, grounded, crouched, yawDeg, pitchDeg, respawns, mode, boxes, stepMs, collisionDebug } | null`
  - `__RANGE_ROOM__.snapshot().player`（同上）

- [ ] **Step 1: 追加失败测试** 到 `tests/collision-layer.test.mjs`

顶部 import 区追加：

```js
import * as THREE from 'three/webgpu'
import { createCollisionDebug } from '../src/world/collision-debug.js'
```

文件末尾追加：

```js
test('collision debug draws 12 edges per room box, skips the ground and never intercepts picking', () => {
  const layer = createCollisionLayer(data, GROUND)
  const debug = createCollisionDebug(layer.world.boxes)
  assert.equal(debug.visible, false)
  assert.deepEqual(debug.snapshot(), { visible: false, boxes: 390, segments: 390 * 12 })
  assert.equal(debug.root.geometry.getAttribute('position').count, 390 * 24)
  debug.setVisible(true)
  assert.equal(debug.root.visible, true)
  const scene = new THREE.Scene()
  scene.add(debug.root)
  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 10, -30), new THREE.Vector3(0, 0, 1))
  assert.deepEqual(raycaster.intersectObjects(scene.children, true), [])
  debug.dispose()
  assert.equal(scene.children.length, 0)
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/collision-layer.test.mjs`
Expected: FAIL，`Cannot find module '.../collision-debug.js'`

- [ ] **Step 3: 实现** `src/world/collision-debug.js`

```js
import * as THREE from 'three/webgpu'

// Corner index bits: 1 = max x, 2 = max y, 4 = max z.
const EDGES = [[0, 1], [1, 3], [3, 2], [2, 0], [4, 5], [5, 7], [7, 6], [6, 4], [0, 4], [1, 5], [2, 6], [3, 7]]

/** Wireframe of collision boxes for debugging; hidden by default. The runtime ground box is skipped. */
export function createCollisionDebug(boxes, { color = 0x39FF88 } = {}) {
  const shown = boxes.filter(box => box.group !== 'Ground')
  const positions = new Float32Array(shown.length * EDGES.length * 6)
  let offset = 0
  for (const { min, max } of shown) {
    const corner = index => [index & 1 ? max[0] : min[0], index & 2 ? max[1] : min[1], index & 4 ? max[2] : min[2]]
    for (const [a, b] of EDGES) {
      positions.set(corner(a), offset)
      positions.set(corner(b), offset + 3)
      offset += 6
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const material = new THREE.LineBasicNodeMaterial({ color })
  const lines = new THREE.LineSegments(geometry, material)
  lines.name = 'CollisionDebug'
  lines.visible = false
  lines.userData.role = 'collision-debug'
  // Raycasters ignore `visible`; debug lines must never win scene picking.
  lines.raycast = () => {}
  return {
    root: lines,
    get visible() {
      return lines.visible
    },
    setVisible(value) {
      lines.visible = !!value
    },
    snapshot() {
      return { visible: lines.visible, boxes: shown.length, segments: shown.length * EDGES.length }
    },
    dispose() {
      lines.removeFromParent()
      geometry.dispose()
      material.dispose()
    },
  }
}
```

- [ ] **Step 4: 替换** `src/room-inspection.js` 全文

```js
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import * as THREE from 'three/webgpu'
import { FlyController } from './engine/controls/fly-controller.js'
import { Disposer } from './engine/core/disposer.js'
import { createInputSystem } from './engine/systems/input/index.js'
import { createPhysicsSystem } from './engine/systems/physics/index.js'
import { createCollisionDebug } from './world/collision-debug.js'
import { createFloatingTeapot } from './world/floating-teapot.js'
import { createPlayer } from './world/player.js'
import { createRoomShadows } from './world/room-shadows.js'
import './room-inspection.css'

// Playable hall coordinates, not the GLB bounds (which include roofs and streets).
export const inspectionConfig = Object.freeze({
  center: Object.freeze([0.5, 11.8, 5.5]),
  orbitRadius: Object.freeze([6.5, 4.5]),
  shadowPosition: Object.freeze([-3, 17.35, 3]),
  shadowTarget: Object.freeze([0.5, 9, 5.5]),
})

const helpText = Object.freeze({
  player: '点击画面锁定鼠标 · WASD 移动 · Shift 静步 · C 下蹲 · 空格跳跃 · V 切换飞行 · R 回出生点 · Esc 释放',
  fly: '点击画面激活 · 右键拖动视角 · WASD 移动 · Q/E 降/升 · Shift 加速 · 滚轮调速 · Esc 释放',
  orbit: '左键环绕 · 右键平移 · 滚轮缩放 · F 定位茶壶 · R 恢复初始机位',
})

/** Application-level composition; content, shadows, camera and the optional player remain independent. */
export function createRoomInspection({ engine, scene, camera, canvas, renderer, room, collision = null, startMode = 'fly', config = {} }) {
  const settings = {
    ...inspectionConfig,
    ...config,
  }
  const owned = new Disposer()
  const teapot = owned.add(createFloatingTeapot({
    center: new THREE.Vector3().fromArray(settings.center),
    radius: new THREE.Vector2().fromArray(settings.orbitRadius),
  }))
  scene.add(teapot.mesh)
  const shadows = owned.add(createRoomShadows({
    scene,
    renderer,
    roots: [room.root, teapot.mesh],
    position: new THREE.Vector3().fromArray(settings.shadowPosition),
    target: new THREE.Vector3().fromArray(settings.shadowTarget),
  }))
  const initialPosition = camera.position.clone()
  const initialQuaternion = camera.quaternion.clone()
  const forward = new THREE.Vector3()
  camera.getWorldDirection(forward)
  const orbit = owned.add(new OrbitControls(camera, canvas))
  orbit.enableDamping = true
  orbit.maxDistance = 80
  orbit.minDistance = 0.2
  orbit.target.copy(initialPosition).addScaledVector(forward, 6)
  camera.position.copy(initialPosition)
  camera.quaternion.copy(initialQuaternion)
  orbit.enabled = false
  const fly = owned.add(new FlyController(camera, canvas))
  let mode = 'fly'

  const input = collision ? owned.add(createInputSystem({ element: canvas })) : null
  const player = collision ? createPlayer({ camera, collision, input }) : null
  const physics = collision ? createPhysicsSystem() : null
  const collisionDebug = collision ? owned.add(createCollisionDebug(collision.world.boxes)) : null
  if (collision) {
    scene.add(collisionDebug.root)
    physics.add(player)
    owned.add(engine.addSystem('physics', physics))
  }
  const modes = collision ? ['player', 'fly', 'orbit'] : ['fly', 'orbit']

  const hud = document.createElement('aside')
  hud.className = 'room-inspection'
  hud.setAttribute('aria-label', '飞行与光照观察')
  const playerButtons = collision
    ? `<button type="button" data-action="player">玩家 V</button>
      <button type="button" data-action="collision" aria-pressed="false">碰撞线框：关</button>`
    : ''
  hud.innerHTML = `
    <div class="inspection-heading"><strong>场景观察</strong><output class="inspection-speed"></output></div>
    <div class="inspection-actions">
      ${playerButtons}
      <button type="button" data-action="mode">切换轨道</button>
      <button type="button" data-action="focus">定位茶壶 F</button>
      <button type="button" data-action="reset">复位 R</button>
      <button type="button" data-action="pause">暂停漂浮</button>
      <button type="button" data-action="shadows" aria-pressed="true">阴影：开</button>
    </div>
    <p class="inspection-help"></p>`
  canvas.parentElement.append(hud)
  owned.add(() => hud.remove())
  const button = action => hud.querySelector(`[data-action="${action}"]`)
  const speed = hud.querySelector('.inspection-speed')
  const help = hud.querySelector('.inspection-help')
  const refresh = () => {
    button('mode').textContent = mode === 'orbit'
      ? '切换飞行'
      : '切换轨道'
    if (player) {
      button('player').textContent = mode === 'player'
        ? '飞行 V'
        : '玩家 V'
      button('collision').textContent = collisionDebug.visible
        ? '碰撞线框：开'
        : '碰撞线框：关'
      button('collision').setAttribute('aria-pressed', String(collisionDebug.visible))
    }
    button('pause').textContent = teapot.paused
      ? '继续漂浮'
      : '暂停漂浮'
    button('shadows').textContent = shadows.enabled
      ? '阴影：开'
      : '阴影：关'
    button('shadows').setAttribute('aria-pressed', String(shadows.enabled))
    help.textContent = helpText[mode]
  }
  const syncOrbit = (target) => {
    // Flush residual orbit damping before moving to another inspection pose.
    orbit.enableDamping = false
    orbit.update()
    orbit.enableDamping = true
    orbit.target.copy(target)
  }
  const api = {
    orbit,
    fly,
    teapot,
    shadows,
    player,
    input,
    collision,
    collisionDebug,
    physics,
    setMode(value) {
      if (!modes.includes(value))
        throw new Error(`Unknown inspection camera mode: ${value}`)
      if (value === mode)
        return
      const position = camera.position.clone()
      const quaternion = camera.quaternion.clone()
      const target = camera.getWorldDirection(forward).multiplyScalar(6).add(position)
      syncOrbit(target)
      camera.position.copy(position)
      camera.quaternion.copy(quaternion)
      mode = value
      fly.setEnabled(mode === 'fly')
      orbit.enabled = mode === 'orbit'
      if (player) {
        player.setEnabled(mode === 'player')
        input.setEnabled(mode === 'player')
        if (mode === 'player')
          player.placeAtCamera()
      }
      canvas.focus({ preventScroll: true })
      refresh()
    },
    focusTeapot() {
      if (mode === 'player')
        api.setMode('fly')
      fly.cancel()
      syncOrbit(teapot.mesh.position)
      camera.position.copy(teapot.mesh.position).add(new THREE.Vector3(0, 1.8, -6.5))
      camera.lookAt(teapot.mesh.position)
      canvas.focus({ preventScroll: true })
    },
    resetCamera() {
      if (mode === 'player') {
        player.respawn()
        return
      }
      fly.cancel()
      const target = new THREE.Vector3(0, 0, -1).applyQuaternion(initialQuaternion).multiplyScalar(6).add(initialPosition)
      syncOrbit(target)
      camera.position.copy(initialPosition)
      camera.quaternion.copy(initialQuaternion)
      canvas.focus({ preventScroll: true })
    },
    setPaused(value) {
      teapot.setPaused(value)
      refresh()
    },
    setShadows(value) {
      shadows.setEnabled(value)
      refresh()
    },
    setCollisionDebug(value) {
      collisionDebug?.setVisible(value)
      refresh()
    },
    snapshot() {
      return {
        cameraMode: mode,
        flySpeed: fly.speed,
        teapot: teapot.snapshot(),
        shadows: shadows.snapshot(),
        player: player
          ? {
              ...player.snapshot(),
              mode,
              boxes: collision.world.boxes.length,
              stepMs: physics.lastStepMs,
              collisionDebug: collisionDebug.visible,
            }
          : null,
      }
    },
    dispose: () => owned.dispose(),
  }
  const actions = {
    player: () => api.setMode(mode === 'player'
      ? 'fly'
      : 'player'),
    collision: () => api.setCollisionDebug(!collisionDebug.visible),
    mode: () => api.setMode(mode === 'orbit'
      ? 'fly'
      : 'orbit'),
    focus: () => api.focusTeapot(),
    reset: () => api.resetCamera(),
    pause: () => api.setPaused(!teapot.paused),
    shadows: () => api.setShadows(!shadows.enabled),
  }
  owned.listen(hud, 'click', (event) => {
    const action = event.target.closest('button')?.dataset.action
    actions[action]?.()
  })
  owned.listen(canvas, 'keydown', (event) => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey)
      return
    if (event.code === 'KeyF')
      api.focusTeapot()
    else if (event.code === 'KeyR')
      api.resetCamera()
    else if (event.code === 'KeyV' && player)
      actions.player()
  })
  owned.add(engine.addSystem('input', {
    name: 'inspection-camera',
    update: ({ time }) => {
      if (mode === 'fly')
        fly.update(time.rawDelta)
      else if (mode === 'orbit')
        orbit.update()
      const text = mode === 'player'
        ? `玩家 ${Math.hypot(player.velocity.x, player.velocity.z).toFixed(1)} m/s`
        : mode === 'fly'
          ? `飞行 ${fly.speed.toFixed(1)} m/s`
          : '轨道观察'
      if (speed.textContent !== text)
        speed.textContent = text
    },
  }))
  if (player) {
    owned.add(engine.addSystem('gameplay', {
      name: 'player-look',
      update: () => {
        if (mode === 'player')
          player.look(...input.consumeLook())
      },
    }))
    owned.add(engine.addSystem('animation', {
      name: 'player-camera',
      update: ({ time }) => {
        if (mode === 'player')
          player.updateCamera(time.alpha, time.rawDelta)
      },
    }))
  }
  owned.add(engine.addSystem('animation', {
    name: 'inspection-teapot',
    update: ({ time }) => teapot.update(time.delta),
  }))
  refresh()
  if (player && startMode === 'player') {
    api.setMode('player')
    player.teleport(collision.spawn.position, collision.spawn.yaw)
  }
  return api
}
```

- [ ] **Step 5: 修改** `src/main.js`

import 区在 `import { createRangeRoom } from './world/range-room.js'` 之前加：

```js
import { loadCollisionLayer } from './world/collision-layer.js'
```

把：

```js
  if (cancelled)
    return
  const inspection = engine.disposer.add(createRoomInspection({
    engine,
    scene,
    camera,
    canvas,
    renderer: render.renderer,
    room,
  }))
```

替换为：

```js
  if (cancelled)
    return
  const collision = await loadCollisionLayer({ ground: world.ground.snapshot() }).catch((error) => {
    console.error('[Range room] Collision layer unavailable; staying in fly mode', error)
    return null
  })
  if (cancelled)
    return
  const inspection = engine.disposer.add(createRoomInspection({
    engine,
    scene,
    camera,
    canvas,
    renderer: render.renderer,
    room,
    collision,
    startMode: parameters.get('player') === '0' ? 'fly' : 'player',
  }))
```

把：

```js
    const renderState = render.snapshot()
    const worldState = world.snapshot()
    return {
      ...renderState,
      ...worldState,
      inspection: inspection.snapshot(),
```

替换为：

```js
    const renderState = render.snapshot()
    const worldState = world.snapshot()
    const inspectionState = inspection.snapshot()
    return {
      ...renderState,
      ...worldState,
      inspection: inspectionState,
      player: inspectionState.player,
```

- [ ] **Step 6: 现有浏览器脚本保持参考机位**

`tools/check-room-browser.mjs` 第 15 行 `url.searchParams.set('profile', '1')` 之后加一行：

```js
url.searchParams.set('player', '0')
```

`tools/check-inspection-browser.mjs` 与 `tools/check-ground-browser.mjs` 中 `const report = { url: ... }` 这一行之后各加：

```js
const target = new URL(report.url)
target.searchParams.set('player', '0')
report.url = target.href
```

- [ ] **Step 7: 运行单元测试、lint 与构建**

Run: `npm test`
Expected: 68 项 PASS

Run: `npx eslint src tests tools`
Expected: 无错误（如有格式类问题用 `npx eslint --fix` 修复后重跑）

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 8: 回归现有浏览器检查**（开发服务器 `npm run dev` 运行中）

Run:
```bash
node tools/check-inspection-browser.mjs "http://localhost:5173/"
node tools/check-ground-browser.mjs "http://localhost:5173/"
```
Expected: 两者输出 `passed: true`

Run（需要 `npm run build && npm run preview`）：`node tools/check-room-browser.mjs "http://localhost:4173/"`
Expected: `passed: true`

- [ ] **Step 9: 提交**

```bash
git add src/world/collision-debug.js src/room-inspection.js src/main.js tools/check-room-browser.mjs tools/check-inspection-browser.mjs tools/check-ground-browser.mjs tests/collision-layer.test.mjs
git commit -m "feat(inspection): 接入第一人称玩家模式与碰撞线框"
```

---

### Task 7: 玩家浏览器验收与文档

**Files:**
- Create: `tools/check-player-browser.mjs`
- Modify: `readme.md`（开发一节的操作说明、浏览器验证命令）
- Modify: `docs/superpowers/specs/2026-11-09-phase2-physics-collision-design.md`（第 6 节下蹲键）

**Interfaces:**
- Consumes: `__RANGE_ROOM__.inspection.{player, collision, setMode, setCollisionDebug}`、`__RANGE_ROOM__.snapshot().player`
- Produces: `node tools/check-player-browser.mjs <url>` → `report.json` 与截图，`passed: true/false`

- [ ] **Step 1: 写验收脚本** `tools/check-player-browser.mjs`

验收墙 `COL_Practice_Wall_East_013`（min x = 22，覆盖 z −11 … 3，高 9 … 12），从 `[20, 9, -4]` 朝 +X（yaw = −π/2）前进，应停在 x = 22 − 0.3 = 21.7。

```js
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { openBrowser } from './browser-session.mjs'

const output = path.resolve(process.env.ROOM_TEST_OUTPUT ?? 'D:/opencode-temp/opencode/player-browser')
const report = { url: process.argv[2] ?? 'http://localhost:5173/', errors: [], messages: [] }
const target = new URL(report.url)
target.searchParams.set('probes', '0')
report.url = target.href
let session
try {
  session = await openBrowser({ output, errors: report.errors, messages: report.messages })
  const { evaluate, send, frames, navigate } = session
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false })
  const screenshot = async (name) => {
    const image = await send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(output, name), Buffer.from(image.data, 'base64'))
  }
  await navigate(report.url)
  await evaluate(`new Promise((resolve, reject) => {
    const deadline = performance.now() + 100000;
    (function check() {
      const error = document.querySelector('.unsupported');
      if (error && !error.hidden) return reject(new Error(error.textContent));
      if (globalThis.__RANGE_ROOM__?.ready) return resolve(true);
      if (performance.now() > deadline) return reject(new Error('Room readiness timeout'));
      requestAnimationFrame(check);
    })();
  })`)
  await frames(60)

  report.spawn = await evaluate('__RANGE_ROOM__.snapshot().player')
  assert.equal(report.spawn.mode, 'player')
  assert.equal(report.spawn.grounded, true)
  assert.ok(Math.abs(report.spawn.position[1] - 9) < 0.01, `spawn feet ${report.spawn.position[1]}`)
  await screenshot('player-spawn.png')

  await evaluate(`(() => {
    globalThis.__PLAYER_KEY__ = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true, cancelable: true }));
    globalThis.__PLAYER_HOLD__ = (code, ms) => new Promise(resolve => {
      __PLAYER_KEY__('keydown', code);
      setTimeout(() => { __PLAYER_KEY__('keyup', code); resolve(true) }, ms);
    });
    document.querySelector('.webgl').focus();
    return true;
  })()`)

  report.wall = await evaluate(`(async () => {
    const { player, collision } = __RANGE_ROOM__.inspection;
    const wall = collision.world.boxes.find(box => box.name === 'COL_Practice_Wall_East_013');
    player.teleport([20, 9, -4], -Math.PI / 2);
    document.querySelector('.webgl').focus();
    const samples = [];
    const timer = setInterval(() => samples.push(__RANGE_ROOM__.snapshot().player.stepMs), 50);
    await __PLAYER_HOLD__('KeyW', 2000);
    clearInterval(timer);
    samples.sort((a, b) => a - b);
    return { wallMinX: wall.min[0], position: player.position.toArray(), grounded: player.grounded, stepMsMedian: samples[samples.length >> 1] };
  })()`)
  assert.ok(report.wall.position[0] <= report.wall.wallMinX - 0.3 + 1e-3, `walked through the wall: ${report.wall.position[0]}`)
  assert.ok(report.wall.position[0] >= report.wall.wallMinX - 0.3 - 0.05, `did not reach the wall: ${report.wall.position[0]}`)
  assert.ok(Math.abs(report.wall.position[2] + 4) < 0.05, 'stayed on its lane')
  assert.ok(report.wall.stepMsMedian < 0.2, `physics step ${report.wall.stepMsMedian} ms`)
  await screenshot('player-wall.png')

  report.jump = await evaluate(`(async () => {
    const { player } = __RANGE_ROOM__.inspection;
    player.teleport([20, 9, -4], 0);
    await new Promise(resolve => setTimeout(resolve, 300));
    const floor = player.position.y;
    document.querySelector('.webgl').focus();
    __PLAYER_KEY__('keydown', 'Space'); __PLAYER_KEY__('keyup', 'Space');
    let apex = floor;
    const end = performance.now() + 1200;
    while (performance.now() < end) { apex = Math.max(apex, player.position.y); await new Promise(requestAnimationFrame); }
    return { floor, apex, grounded: player.grounded };
  })()`)
  assert.ok(Math.abs(report.jump.apex - report.jump.floor - 1.1) < 0.05, `jump height ${report.jump.apex - report.jump.floor}`)
  assert.equal(report.jump.grounded, true)

  report.underFloor = await evaluate(`(async () => {
    const { player, collision } = __RANGE_ROOM__.inspection;
    const spawn = collision.spawn.position;
    const floor = collision.floors.find(box => box.min[0] <= spawn[0] && spawn[0] <= box.max[0] && box.min[2] <= spawn[2] && spawn[2] <= box.max[2]);
    const before = player.respawns;
    player.position.set(spawn[0], collision.groundHeight + 0.01, spawn[2]);
    await new Promise(resolve => setTimeout(resolve, 200));
    return { floorBottom: floor.min[1], respawned: player.respawns - before, position: player.position.toArray() };
  })()`)
  assert.ok(report.underFloor.floorBottom > 7.875, 'test pose is under the spawn floor')
  assert.equal(report.underFloor.respawned, 1)
  assert.ok(Math.abs(report.underFloor.position[1] - 9) < 0.01, 'back on the spawn floor')

  report.modes = await evaluate(`(async () => {
    const app = __RANGE_ROOM__;
    const canvas = document.querySelector('.webgl');
    canvas.focus();
    canvas.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV', bubbles: true }));
    const fly = app.snapshot().inspection.cameraMode;
    canvas.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV', bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 300));
    return { fly, player: app.snapshot().inspection.cameraMode, grounded: app.inspection.player.grounded };
  })()`)
  assert.deepEqual(report.modes, { fly: 'fly', player: 'player', grounded: true })

  await evaluate('document.querySelector(\'.room-inspection [data-action="collision"]\').click()')
  await frames(10)
  report.debug = await evaluate('({ visible: __RANGE_ROOM__.snapshot().player.collisionDebug, label: document.querySelector(\'.room-inspection [data-action="collision"]\').textContent })')
  assert.deepEqual(report.debug, { visible: true, label: '碰撞线框：开' })
  await screenshot('player-collision-debug.png')
  await evaluate('__RANGE_ROOM__.inspection.setCollisionDebug(false)')

  await evaluate('__RANGE_ROOM__.engine.destroy()')
  assert.equal(report.errors.length, 0, 'no page errors')
  report.passed = true
}
catch (error) {
  report.passed = false
  report.failure = error.stack
  process.exitCode = 1
}
finally {
  fs.mkdirSync(output, { recursive: true })
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ passed: report.passed, failure: report.failure, errors: report.errors, spawn: report.spawn, wall: report.wall, jump: report.jump, underFloor: report.underFloor, report: path.join(output, 'report.json') }, null, 2))
  session?.close()
}
```

- [ ] **Step 2: 运行验收脚本**（`npm run dev` 运行中）

Run: `node tools/check-player-browser.mjs "http://localhost:5173/"`
Expected: `passed: true`；`wall.position[0]` ≈ 21.7；`wall.stepMsMedian` < 0.2；`jump` 高度 ≈ 1.1；`underFloor.respawned` = 1

如失败：先看 `report.json` 的 `failure` 与截图，按 superpowers:systematic-debugging 定位，不要放宽断言。

- [ ] **Step 3: 更新规格第 6 节**

`docs/superpowers/specs/2026-11-09-phase2-physics-collision-design.md` 中：

```markdown
| 跑 / 静步 / 下蹲速度 | 6.75 / 3.8 / 3.4 m/s | 静步 Shift，下蹲 Ctrl |
```

改为：

```markdown
| 跑 / 静步 / 下蹲速度 | 6.75 / 3.8 / 3.4 m/s | 静步 Shift，下蹲 C（Ctrl 与浏览器 Ctrl+W 冲突） |
```

- [ ] **Step 4: 更新 `readme.md`**

把开发一节中以「使用支持 WebGPU 的最新版 Chrome / Edge。加载后保持 Blender 参考机位，默认启用飞行观察：」开头的那一段替换为：

```markdown
使用支持 WebGPU 的最新版 Chrome / Edge。加载后默认进入**玩家模式**，站在碰撞层出生点：点击画面锁定鼠标，WASD 移动、Shift 静步、C 下蹲、空格跳跃，R 回到出生点，Esc 释放鼠标。V 在玩家与飞行（noclip）之间切换；飞行模式下 WASD 移动、Q/E 升降、右键拖动视角、Shift 加速、滚轮调速，F 定位浮动茶壶，R 复位。左下角可切换轨道模式、碰撞线框、暂停漂浮及动态阴影，右上角提供 AO 和 LUT 调试面板。`?player=0` 启动时保持 Blender 参考机位与飞行模式。碰撞层见 [练枪房碰撞层](docs/physics/collision-layer.md)，模块与操作见 [茶壶与飞行观察](docs/lighting/room-inspection.md)。
```

并在「新增 GPU 专项测试使用开发服务器」代码块中 `node tools/check-ground-browser.mjs "http://localhost:5173/"` 之后加一行：

```bash
node tools/check-player-browser.mjs "http://localhost:5173/"
```

- [ ] **Step 5: 最终验证**

Run: `npm test`
Expected: 68 项 PASS

Run: `npm run build`
Expected: 成功

人工验收（规格第 8 节第 4 条）：在房间里完整走一圈不被卡住；走廊楼梯能上下；不能穿墙离开房间；能走出入口到室外地面；V 切到飞行钻到地板下再按 V 切回，应回到出生点；反向急停手感可接受。

- [ ] **Step 6: 提交**

```bash
git add tools/check-player-browser.mjs readme.md docs/superpowers/specs/2026-11-09-phase2-physics-collision-design.md
git commit -m "test(player): 添加玩家模式浏览器验收并更新文档"
```

---

## Spec Coverage

| 规格要求 | 任务 |
|---|---|
| AABB 控制器、按轴解算、贴墙滑动、上台阶、贴地、防穿透 | Task 1 |
| 宽相暴力遍历、`queryAABB` 接口 | Task 1 |
| 固定步物理系统、步耗时 | Task 2 |
| Pointer Lock、`unadjustedMovement`、意图对象 | Task 3 |
| 碰撞层校验、地面盒、`killY`、踩穿地板重置 | Task 4 |
| 移动参数、下蹲遮挡、跳跃、灵敏度、相机插值、出生点 | Task 5 |
| 碰撞线框、玩家/飞行/轨道模式、V 切换、快照 `player` | Task 6 |
| 浏览器验收、性能 < 0.2 ms、文档 | Task 7 |
