# GameObject 组件组合与 Component-based Tick：第一轮消融

- 日期：2026-11-10
- 状态：**已获授权并实施，验证记录见[运行时架构](../../architecture.md#2026-11-10-实施验收)**
- 前置方案：[Piccolo 运行时架构重构](2026-11-10-piccolo-runtime-architecture.md)。
- 目标：可复用能力参与 GO 装配；更新按组件类型跨 GO 执行；单个物件的内部动作保持普通代码。
- 本文保留第一轮设计消融记录；四类组件、类型索引及五阶段更新已落地。

后续目录修订：[2026-11-11 function 层结构重构](2026-11-11-function-layer-layout.md)。通用组件集中到 framework/component，角色运动与解算分别归入 character / controller。

后续调度修订：[阶段优先组件 Tick](2026-11-11-phase-first-component-tick.md)。用户确认以“阶段 → GO 扫描 → 匹配组件”为当前实现，取代本文第一轮的类型索引；本文继续保留组件粒度与初版实施记录。

后续粒度修订：[CameraComponent](2026-11-11-camera-component.md)。按用户新需求，相机成为可独立装配的通用组件；Player 保留输入映射、站蹲目标与出生规则，取代本文初版将视角合入 Player 的决定。

## 1. 消融标准与结论

逐项移除上一版的组件／中间层，检查三个问题：

1. 当前是否有不同物件需要组合这项能力？
2. 合并后是否会破坏明确的数据所有权、更新时机或独立启停？
3. 能否用普通字段、函数或现有所有者承接职责？

判断依据来自当前玩家、茶壶、房间、地面实现。新增一个演示物件不能作为抽象已经有复用需求的依据。

### 1.1 逐项结果

| 被消融项 | 移除后的影响／承接位置 | 结论 |
| --- | --- | --- |
| TransformComponent | 玩家、茶壶重新各存位置；Mesh 和相机缺少共同的空间状态来源 | **保留**：共享空间能力 |
| ModelComponent | 房间、地面、茶壶分别处理模型挂接、姿态同步和释放 | **保留并命名为 MeshComponent**，项目使用这一种名称 |
| MotorComponent | 玩家与茶壶分别维护运动时间、暂停、变换提交和运动状态 | **保留**：运动算法通过普通函数提供 |
| SpinAnimationComponent | 茶壶自转直接并入茶壶运动函数；共用原有 elapsed / paused | **消融** |
| OrbitMotionComponent | 环绕、漂浮、自转统一由茶壶运动函数计算 | **消融** |
| ControlIntentComponent | 意图是 Motor 的普通 command 数据；输入来源负责写入 | **消融** |
| PlayerInput / PlayerCamera / Respawn 三个组件 | 输入映射、眼高、相机控制、出生点均属于同一个玩家控制行为 | **合并为一个 PlayerComponent**，内部使用普通方法 |
| CharacterControllerComponent | 当前运动学碰撞可由 Motor 同步调用现有解算函数，并立即提交结果 | **消融**：算法留在 physics，运动状态归 Motor |
| StaticColliderComponent | 房间盒与地面盒随关卡整体加载／卸载，已有 CollisionWorld 和关卡所有者 | **消融**：由 Level 持有碰撞数据 |
| LightComponent | 当前房间灯光一起创建、调节、释放，现有灯光对象已提供这些接口 | **消融**：保留关卡管理的灯光资源 |
| 独立 ComponentIndex 类 | 索引与 Level 同寿命，只由 Level 使用 | **内联为 Level 的 Map** |
| 物理请求队列／提交阶段 | 当前同步扫掠可直接返回结果，排队增加请求过期、撤销和重复消费状态 | **消融**：Motor 内同步解算一次 |
| 组件 priority、稳定字符串类型 ID、自动依赖拓扑、变换写入仲裁器 | 当前依赖可由固定阶段、明确装配顺序及直接引用表达 | **消融通用机制**：保留基本依赖检查与行为测试 |
| onActivate / onDeactivate 两层额外生命周期 | 当前 GO 进入一个 Level 后，在移除时直接销毁；没有跨 Level 反复激活的使用场景 | **合并为 onAttach / dispose** |

### 1.2 结构变化

| 项目 | 上一版 | 本轮 |
| --- | --- | --- |
| 具体组件类型，均不含 Component 基类 | 12 | **4：Transform、Mesh、Motor、Player** |
| 玩家组件数 | 7 | **3** |
| 茶壶组件数 | 4 | **3** |
| 具名更新阶段 | 9 | **5** |
| 组件索引所有者 | Level + 独立 ComponentIndex 类 | **Level** |
| 玩家移动调用链 | Motor → Controller → 请求队列 → Physics → 结果提交 | **Motor → 同步物理解算 → Transform** |

**PlayerComponent 的保留理由：**它是当前受控玩家这一完整游戏行为的调度入口，负责输入与相机控制权。继续移除它，会把浏览器输入、相机和出生规则塞入通用 Motor，或在 Engine 中出现玩家专用更新分支。其内部的几个方法没有独立装配需求，保持同一组件。与现有实现相比，位置、运动积分、碰撞和模型能力都已交给真正可组合的组件。

## 2. 最终对象组合与职责

```text
Component
├─ TransformComponent             runtime：空间状态与位置插值
├─ MeshComponent                  runtime：模型树挂接、同步、释放
├─ MotorComponent                 runtime：运动执行与结果提交
└─ PlayerComponent                game：玩家特有的输入、视角与出生规则

房间／地面 = GameObject + Transform + Mesh
茶壶      = GameObject + Transform + Mesh + Motor(茶壶运动函数)
玩家      = GameObject + Transform + Motor(角色运动函数) + Player
```

玩家当前没有可见模型；需要人物模型时直接添加 MeshComponent。

### TransformComponent

- 拥有 position、quaternion、scale，复用 Three.js 数学类型。
- 保存固定步 previousPosition，提供位置插值和 teleport 历史重置。
- Mesh 和玩家相机读取同一份 Transform；呈现姿态不回写模拟位置。
- 初版 GO 的 Transform 为世界空间姿态；模型内部局部层级由模型树保留。
- 它是空间数据组件，采样和历史操作均为直接方法，本轮不安排空的 Transform tick 阶段。

### MeshComponent

- 接收一个 Mesh 或包含多网格的 Object3D 模型树，负责挂接 scene、同步 Transform 和释放自己拥有的实例资源。
- GLTF 模型内部变换保留；对象整体姿态从 Transform 获取。
- 通过传入的 release 函数释放实例资源；ResourceManager 的共享模板资源保持独立所有权。

### MotorComponent

- 负责运动是否启用、运动时钟、速度／接触状态、固定步或逐帧执行，以及向 Transform 提交结果。
- `clock: 'fixed' | 'frame'` 决定它进入哪个更新阶段。
- 接收普通运动函数。函数计算本步位移或目标姿态；Motor 根据需要进行碰撞解算，再统一写入 Transform。
- 角色的加减速、重力、跳跃、蹲站规则使用普通角色运动函数；当前 `moveAABB` 算法继续用于碰撞处理。
- 茶壶的环绕、漂浮、自转留在 `game/range-room/floating-teapot.js` 的一个普通函数内。共享一个运动时钟和暂停状态。
- 意图、模型参数、算法状态使用普通数据。运动函数没有 owner、生命周期和单独的 tick 注册。

### PlayerComponent

- input 阶段读取 InputSystem，写入 `motor.command`，更新身体朝向和视角俯仰。
- postPhysics 阶段检查关卡越界／穿地条件，调用 Motor 的 teleport/resetMotion，并更新重生计数。
- presentation 阶段从 Transform 采样位置，加上眼高和俯仰，更新相机。
- 位置和速度通过 Transform / Motor 获取。组件自身保留玩家控制权、视角偏移、眼高平滑及出生规则等玩家状态。

### 茶壶装配示意

```js
const teapot = new GameObject({ name: 'Floating teapot', mobility: 'dynamic' })
teapot.addComponent(new TransformComponent({ position: center }))
teapot.addComponent(new MeshComponent({ root: teapotMesh, scene, release: releaseTeapot }))
teapot.addComponent(new MotorComponent({
  clock: 'frame',
  motion: updateTeapotMotion,
  state: { center, radius, orbitPeriod, floatAmplitude, floatPeriod },
}))
level.addObject(teapot)
```

`updateTeapotMotion` 保留茶壶现有公式。更换 mesh 可复用整个 Motor；暂停漂浮只暂停 Motor，Transform 和 Mesh 仍可用于观察与显示。

## 3. Component 契约与 Level 索引

```js
class Component {
  owner = null
  enabled = true

  onAttach() {}
  tick(context) {}
  dispose() {}
}
```

- GO 持有组件、id、name、active、mobility；具体行为通过组件进入更新链。
- 组件用构造器标识类型，通过 `owner.requireComponent(Type)` 获取同 GO 的直接依赖。外部服务通过参数注入。
- 声明实际参与的阶段：Transform 无阶段；Mesh 为 presentation；Motor 为 fixed 或 motion；Player 为 input、postPhysics、presentation。
- 同一具体类型在一个 GO 中最多一份；组件实例只有一个 owner。

Level 内直接维护：

```text
Map<phase, Map<ComponentConstructor, Set<Component>>>
```

阶段开始捕获该阶段的类型与实例快照，然后按“类型 → 该类型的全部实例”调用 `tick(context)`。索引随 GO／组件增删维护。

```text
类型 A：GO1.A → GO2.A → GO3.A
类型 B：GO1.B → GO2.B → GO3.B
```

阶段之间表达执行依赖；当前同阶段的不同类型互不依赖执行先后。例如 Player 的相机更新与 Mesh 的模型同步都消费已完成的 Transform。使用 Map 的稳定注册顺序即可，不引入额外排序协议。

组件新增从下一匹配阶段开始执行；移除、disable 和 GO deactivate 立即阻止尚未执行的调用。`mobility` 不用于禁用行为，静态物件仍能组合交互组件。

## 4. 精简后的帧调用链

```text
Engine.step(now)
  Time.tick(now)
  logicalTick()
    Editor 输入通知
    world.tickComponents(input, frame)         所有 Player

    每个固定步（1/60 秒，最多 5 步）：
      world.tickComponents(fixed, fixedFrame)  所有固定步 Motor
        每个 Motor 保存自己的 previousPosition
        执行角色运动函数
        同步调用物理解算，提交一次 Transform
      world.tickComponents(postPhysics, fixedFrame)
                                               所有 Player 检查重生

    world.tickComponents(motion, frame)        所有逐帧 Motor
    world.tickComponents(presentation, frame)  所有 Mesh；所有 Player 相机

  rendererTick()                               RenderSystem 绘制
  frame 通知                                  HUD / 诊断
```

这保留组件类型优先的更新方式。物件专属函数通过其所属组件进入统一调用链，不给 GO 增加另一套更新循环。

### 物理与时间约束

- PhysicsSystem 提供同步碰撞查询／运动解算。固定步次数由 Engine 决定，Motor 每个固定步只调用一次位移解算。
- 原先的 `physics.add({ fixedUpdate: player.fixedUpdate })` 注册链随迁移删除；PhysicsSystem 不再另行遍历同一批 Motor。原调用点和物理测试同步迁移到新的解算接口。
- `moveAABB`、台阶、贴地及防穿透算法保留；物理解算耗时继续提供给诊断。
- 玩家 command 为普通数据。跳跃保持排队语义，遇到第一个实际固定步时消费一次；同帧多步不会重复消费。
- Motor 固定步位置供 Transform 插值；茶壶使用本帧结果。teleport 同时清理位置历史及 Motor 速度。
- `timeScale = 0` 冻结运动时间；Editor 继续使用 rawDelta。独立 rendererTick 只渲染已准备的场景。
- 玩家／观察控制权由 app 协调 Player 与 Motor 的启停，并清空输入；Mesh 的显示生命周期独立。

## 5. 生命周期和所有权

- GO 在进入 Level 前先完成组件装配，owner 已建立；onAttach 在 GO 加入 Level 时执行一次。在活动 GO 上新增组件时立即执行其 onAttach。
- 工厂按依赖顺序装配：Transform 在前，Mesh / Motor 随后，Player 最后。缺少依赖直接报错；移除仍被直接引用的组件时拒绝操作。依赖检查采用少量直接引用，不做自动拓扑规划。
- onAttach 失败时回滚本次注册／挂接；整体释放按装配顺序逆序执行，dispose 幂等。
- 移除 GO 先撤销 Level 的更新索引，再释放组件。Mesh 从场景解绑，Motor 停止参与更新。
- 房间碰撞数据、地面碰撞盒、房间灯光、阴影／探针绑定由 Level 的现有清理流程管理。
- 关卡仍先解绑工具与共享材质扩展，再释放组件和资产。异步加载取消及迟到资源释放沿用 WorldManager / Level 的既有契约。

## 6. 实施文件范围

```text
engine/runtime/function/framework/
  component/
    component.js                 基类契约
    transform/transform-component.js  空间状态与位置历史
    mesh/mesh-component.js        模型树呈现与资源所有权
    motor/motor-component.js      运动执行、状态、Transform 提交
  object/game-object.js           组件组合、直接依赖与释放
  level/level.js                  对象所有权和类型索引
  world/world-manager.js          关卡加载、取消与卸载

engine/runtime/function/character/
  character-motion.js            普通角色运动函数

engine/runtime/function/controller/
  character-controller.js        现有 moveAABB 算法

engine/runtime/function/physics/
  physics-system.js              同步查询／解算、计时

game/player/
  player.js                      PlayerComponent 与玩家装配
  config.js                      玩家参数

game/range-room/
  floating-teapot.js              模型创建、普通运动函数和装配
  level.js                       关卡组装与共享资源管理
```

新增组件集中于确实参与组合的能力。诊断接口在 app 层读取 Transform / Motor / Player，继续提供现有的移动、视角、茶壶暂停、聚焦和快照操作。

## 7. 验收与回退条件

1. **真实共享**：玩家与茶壶使用同一个 TransformComponent 和 MotorComponent 类；房间、地面、茶壶使用同一个 MeshComponent 类。
2. **空间状态唯一**：运动写 Transform，模型与相机读取它；旧 player.position 和 mesh.position 不再充当并列的模拟数据源。
3. **按类型更新**：交错装配多个 GO，验证 `A(GO1), A(GO2), B(GO1), B(GO2)`；阶段内增删、停用不出现重复或遗漏调用。
4. **单次物理**：0 / 1 / 5 个固定步对应同等次数的 Motor 更新及位移解算；独立渲染不推进运动。
5. **保留行为数值**：移动、制动、跳高、蹲站、台阶、重生、相机插值、茶壶轨迹与暂停恢复维持原测试要求。
6. **生命周期**：挂接失败、运行时移除、重复关卡重载、无 Editor 及整体销毁后的索引、场景与资源归属正确。
7. **避免重新膨胀**：若实施时 Motor 开始承担玩家相机／DOM 输入或硬编码茶壶公式，说明职责合并错误；算法留在普通函数，游戏控制留在 Player。

实施前基线为 `npm test` 89/89 通过，碰撞盒数量为用户确认的 399。实施后组件组合、调度、物理及行为测试为 95/95 通过，四套浏览器回归通过。

## 8. 实施落点

- `Component` 统一契约；GO 仅装配与释放，直接依赖先建后拆，Level 入场时挂接。
- `Level.tickComponents()` 使用阶段／构造器／Set 索引，整阶段快照后按类型调用。
- `TransformComponent` 管理权威姿态和历史；Mesh 与相机共用采样；Motor 支持固定步／帧时钟。
- `characterMotion()` 与茶壶运动函数均为普通函数；`createPlayer()` / `createFloatingTeapot()` 返回已装配 GO。
- app 将组件命令与状态适配为既有观察接口。旧玩家物理回调链与茶壶专用组件已移除。
- 房间／地面的 Mesh 持有实例释放权；灯光／碰撞／阴影／探针由关卡管理。加载成功即解除部分资源的 abort 清理监听，确保材质绑定先还原，再释放实例。

具体验收命令与结果统一记录于[运行时架构](../../architecture.md#2026-11-10-实施验收)。
