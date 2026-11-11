# 阶段优先 Component Tick：实现与验证

- 日期：2026-11-11
- 状态：**已实施；验证记录见末节。**
- 来源：用户对 Piccolo tick 示意图和首轮对比 Spec 的反馈，确认关卡按阶段扫描对象，组件承载行为。
- 前置：[Piccolo 源码对比](2026-11-11-component-tick-piccolo-comparison.md)、[组件粒度消融](2026-11-10-component-based-game-objects.md)。

后续组件修订：[CameraComponent](2026-11-11-camera-component.md) 将玩家视角表现提取到独立组件，沿用本文的阶段契约。

## 1. 最终职责

| 所有者 | 职责 |
| --- | --- |
| Engine | 唯一帧入口、时间推进、全局阶段顺序、逻辑／绘制边界 |
| WorldManager | 向当前活动 Level 路由，管理加载／卸载 |
| Level | 每阶段扫描全部 GO，收集组件快照并调用 tick |
| GameObject | 组件装配、同 GO 依赖、对象生命周期 |
| Component | 输入、运动、相机等可组合行为 |
| PhysicsSystem／普通运动函数 | 同步解算服务和领域算法 |

本次以“阶段优先”为更新契约。阶段内部按 GO 插入顺序、组件装配顺序扫描；组件类型索引是未来按测量需要选择的实现手段。

## 2. 已落地的帧链

```text
Engine.step(now)
  Time.tick(now)
  logicalTick()
    工具 input 通知
    world.tickComponents(input)
    每个固定步：
      world.tickComponents(fixed)
      world.tickComponents(postPhysics)
      Time.completeFixedStep(stepIndex)
    world.tickComponents(motion)
    world.tickComponents(presentation)
  RenderSystem.swapLogicRenderData()
  rendererTick()
    RenderSystem.update()
  frame 通知
```

`tickComponents(phase, frame)` 沿用现有公共方法名称，语义即阶段分发。Engine 显式调用这五个阶段。

### Level 的核心逻辑

```js
const batch = []
for (const object of this.objects.values()) {
  for (const component of object.components) {
    if (component.phases.includes(phase))
      batch.push(component)
  }
}

for (const component of batch) {
  const owner = component.owner
  if (!this.disposed && !component.disposed
    && component.enabled && owner?.active && owner.level === this)
    component.tick(context)
}
```

扫描完成后才执行回调，避免前面的组件新增对象时改变当前阶段的执行集合。关卡中的所有 input 都完成后，才开始任何 fixed；所有 fixed 完成后，才进入当前子步的 postPhysics。

## 3. 玩家、茶壶与物理

- PlayerComponent 在 input 消费鼠标、向 CameraComponent 转交视角增量以更新朝向，并写入 Motor.command。jump 遇到零固定步帧时保留，在首个实际固定步消费一次。
- `Motor(clock: 'fixed')` 在 fixed 保存 previousPosition、执行运动函数、同步调用 `physics.move()`，并提交 Transform 和接触状态。
- postPhysics 读取已经解算完成的位置，进行越界／重生检查。
- `Motor(clock: 'frame')` 在 motion 每显示帧执行一次。茶壶使用其现有普通运动函数计算环绕、漂浮和旋转。
- postPhysics 中 Player 根据 Motor 实际 crouched 状态设置 Camera 的眼高目标。
- presentation 中 Mesh 同步模型根节点，Camera 采样位置并更新相机。它们不再次积分 Motor 的位移。
- `component.phases` 是实例接口。Motor 根据 clock 返回冻结的阶段列表，不能用 `component.constructor.phases` 代替。

当前 PhysicsSystem 已是同步移动服务，因此 fixed 内已经完成“计算 → 解算 → 写回”。将来接入刚体世界时，需要显式组织“Motor 提交目标 → physics.step → 物理结果写回 Transform → postPhysics”；同一位置只能有明确的模拟推进路径。

## 4. 时间契约

Time 是唯一累加器所有者：

1. rawDelta 先限制在 `[0, maxDelta]`，再乘本帧开始时锁定的 timeScale。
2. 固定步长默认 1/60 秒，每帧默认最多五步。超额完整步记录为 droppedSimulationTime，不足一步的余量用于 alpha。
3. fixedDelta 是构造期只读参数；无效步长、追帧上限、缩放值与非有限时间戳会被拒绝。
4. 对毫秒表示的固定频率时间戳处理浮点边界容差，避免恰好一固定步时漏执行。

`context` 与其 `time` 都为只读对象，包含：

| 字段 | 含义 |
| --- | --- |
| context.phase／delta | 当前阶段；fixed／postPhysics 的 delta 为 fixedDelta |
| time.frame／delta／rawDelta／elapsed | 显示帧编号、缩放／未缩放帧间隔、累计帧时间 |
| time.fixedSteps／completedFixedSteps | 本帧计划／已完成的固定步数 |
| time.fixedTick／fixedElapsed | 固定阶段中为正在执行的模拟编号及步末时间；其他阶段为最近完成的编号／时间 |
| time.fixedStepIndex | 本帧从 0 开始的子步索引；非固定阶段为 null |
| time.fixedDelta／alpha | 固定步长与插值比例 |
| time.timeScale | 本帧已锁定的缩放值 |
| time.droppedSimulationTime | 本帧因追帧上限丢弃的完整模拟步时长 |

fixed 和对应的 postPhysics 使用同一快照，两阶段正常结束后才提交固定步编号。Motor.elapsed 仍是组件实际启用运行的本地时钟。

测试案例 `tick(0) → tick(10) → tick(110)`：最后一帧执行五步、丢弃一步，保留约 0.01 秒余量，alpha 约为 0.6。

`timeScale = 0` 冻结运动时间，保留当前的视角与 rawDelta 工具操作。修改 timeScale 在下一帧生效；暂停／恢复 RAF 不累积后台间隔，并保留已有插值余量。

## 5. 分发与生命周期约束

- 未知／重复阶段在 GameObject.addComponent 时校验，在 Level 挂接前再次校验，错误声明不先触发 onAttach 副作用。
- onAttach、tick 是同步调用契约，异步资源由 Level.load 等加载流程准备。
- 同阶段新增组件下次该阶段才能执行；同帧的后续阶段或下一固定子步可以看到它。
- 移除／销毁立即阻止快照中尚未执行的组件；enabled／active 在调用点判断，调用点前重新启用仍可执行。
- Level 分发期间递归进入任意阶段会抛错。
- GameObject 内没有 tick 循环或玩家／茶壶分支。同阶段数据依赖需通过明确阶段边界表达。
- Level 卸载时逆序移除仍存活 GO，再释放共享资源；RangeRoomLevel 先解绑阴影／探针。提前移除的 GO 不再留在逐对象 Disposer 闭包中。

## 6. 帧入口和渲染隔离

- `step()` 是正常入口；递归调用在再次推进时钟之前失败。
- logicalTick 只消费一次已准备的帧。同帧重复调用抛错，失败帧也不能重放。
- rendererTick 可重复绘制已完成的场景；逻辑未完成或递归绘制时抛错。
- fixed／postPhysics 异常时不提交该步编号，不进行后续运动／表现／交换／绘制；既有组件写入不会自动回滚。
- 输入、组件、渲染和 frame 观察者读取快照。诊断通过 `__RANGE_ROOM__.snapshot().time` 查看已提交的模拟编号和丢时数据。

## 7. 文件落点

- `src/engine/runtime/engine.js`：显式阶段顺序、子步快照、帧消费和重入防护。
- `src/engine/runtime/core/time.js`：时间配置、累积与余量、固定步提交、只读快照。
- `src/engine/runtime/function/framework/level/level.js`：扫描／快照分发，活动 GO 统一释放。
- `src/engine/runtime/function/framework/object/game-object.js`：阶段声明检查，移除类型索引维护。
- `src/engine/runtime/function/framework/component/tick-phases.js`：阶段合法性、阶段时钟与只读 context。
- `src/engine/runtime/function/framework/component/motor/motor-component.js`：固定／帧实例阶段声明。
- `src/app/diagnostics.js`：暴露时钟快照。
- `tests/framework.test.mjs`、`runtime.test.mjs`、`motion.test.mjs`、`time.test.mjs`：调度、时间与真实组件组合验证。
- `tests/runtime-browser-cases.js`：重载后玩家与茶壶时钟、重复渲染与重复逻辑防护。

## 8. 验证记录

实施前 `npm test` 为 95/95；新增测试覆盖跨 GO 阶段屏障、两种 Motor 时钟、完整阶段快照、挂接校验、重入、失败帧、限步余量与模拟编号。

| 检查 | 结果 |
| --- | --- |
| `npm test` | 107/107 通过 |
| `npx eslint src tests tools eslint.config.js` | 0 错误，6 项既有 JSDoc 警告 |
| Vite 生产构建 | 通过，输出 `D:/opencode-temp/opencode/mc-valorant-phase-tick-build/` |
| `npm run validate:room` | 通过，6 张 atlas、200 个 primitive 的绑定有效 |
| 浏览器 runtime | 有／无 Editor 各两次重载通过，`errors: []`；4 个 GO、7／6 个场景子节点稳定，销毁后清空 |
| 浏览器 player | 通过，`errors: []`；移动／墙碰撞／跳跃／重生及模式切换正常 |
| 浏览器 inspection | 通过，`errors: []`；茶壶运动／暂停、模型同步、阴影、飞行／轨道切换及关闭正常 |
| 文档链接／代码围栏、`git diff --check` | 通过 |

runtime 每次重载后的确定性前进距离为 2.8754 m；茶壶在对应的 60 帧手动更新中累计约 1 秒 frame-clock 时间，模型与 Transform 一致。四次重载均确认重复 logicalTick 被拒绝，独立 rendererTick 不推进模拟编号或 Motor 时间。玩家浏览器测得跳高为 1.099972 m。

inspection 测得茶壶阴影最大线性像素差为 0.209656；飞行直线／对角／30 Hz 均约为 6 m，加速为 24 m，失焦和 UI 输入时位移为 0。

浏览器回归报告目录：`D:/opencode-temp/opencode/mc-valorant-phase-tick-browser/`，子目录为 runtime、player、inspection。
