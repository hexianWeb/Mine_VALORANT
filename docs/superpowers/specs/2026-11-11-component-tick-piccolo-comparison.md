# Component-based Tick：Piccolo 对照与更新契约优化 Spec

- 日期：2026-11-11
- 状态：**首轮对比研究存档；经用户反馈修订后的已实施契约见[阶段优先组件 Tick](2026-11-11-phase-first-component-tick.md)。**
- 范围：帧循环、组件类型批次、固定步时钟、阶段可见性、表现同步和 tick 诊断。
- 对比时的项目基线：包含初版类型索引的组件化和 function 目录迁移，后续已调整为阶段扫描。
- Piccolo 基线：核对远端 `main` 后，按提交 [`f5053707fed4d3f94d270a436fb0d3a8ae54e3e5`][piccolo-commit] 固定读取源码。以下结论针对该版本。
- 前置：[组件组合与第一轮消融](2026-11-10-component-based-game-objects.md)、[function 结构](2026-11-11-function-layer-layout.md)、[当前运行时架构](../../architecture.md)。

后续决定：核心目标是“Engine 编排阶段、Level 扫描 GO、Component 承载行为、GO 管理组合”。类型优先与缓存不是本期必要条件。以下正文保留首轮分析与建议；当前实现、时间契约及验收以阶段优先修订为准。

## 1. 首轮结论与推荐方向（历史）

**保留当前“阶段 → 组件类型 → 组件实例”的更新方式，下一轮优先完善更新契约，再优化调度分配。**

需要先澄清两种含义：

1. **组件化行为**：对象由组件组合，行为通过组件的 `tick` 执行。Piccolo 与本项目都具备。
2. **按组件类型更新**：跨 GO 先更新完 A 类型，再更新 B 类型。本项目已经具备；所核对的 Piccolo 主循环采用 GO 优先遍历。

因此，本项目目前的 tick 结构已经是针对自身需求的进一步设计。建议按以下顺序推进：

| 优先级 | 决策 | 直接收益 |
| --- | --- | --- |
| P0 | 明确固定步编号、模拟时间、限步丢时与只读上下文 | 固定步行为有统一时间语义，便于调试和扩展玩法 |
| P0 | 防止同帧重复逻辑更新、递归调度；校验阶段声明 | 提前暴露重复推进和静默漏更新 |
| P1 | 按阶段／类型统计 tick，再缓存结构稳定的执行批次 | 降低重复快照分配，并获得真实成本依据 |
| P1 | 清理动态 GO 的历史释放登记 | 支持长期生成／销毁对象时的有界生命周期 |
| P2 | 在规模与测量支持时引入 Transform 版本和增量表现同步 | 减少大量静态或休眠对象的重复同步 |

组件仍负责对象能力和生命周期，Level 负责跨对象分发，Engine 负责时间与阶段编排。领域计算继续由 `characterMotion`、碰撞服务等普通函数／服务承接。

## 2. Piccolo 的实际 tick 调用链

### 2.1 一帧的执行顺序

根据 [Engine][p-engine]、[WorldManager][p-world] 和 [Level][p-level]：

```text
PiccoloEngine.run()
  calculateDeltaTime()                         实测帧间隔
  tickOneFrame(delta_time)
    logicalTick(delta_time)
      WorldManager.tick(delta_time)
        首次需要时加载 World
        activeLevel.tick(delta_time)
          遍历全部 GObject
            GObject.tick(delta_time)
              遍历该 GO 的组件
                shouldComponentTick(typeName)
                Component.tick(delta_time)
          activeCharacter.tick(delta_time)    运行模式下
          PhysicsScene.tick(delta_time)
        LevelDebugger.tick(activeLevel)
      InputSystem.tick()
    calculateFPS(delta_time)
    RenderSystem.swapLogicRenderData()
    rendererTick(delta_time)
      RenderSystem.tick(delta_time)
        processSwapData()
        准备资源／可见物体／pass，提交绘制
    可选物理调试绘制
    WindowSystem.pollEvents()
```

这是源码中的单线程顺序。逻辑／渲染交换接口提供了明确的数据边界，不能仅根据存在双缓冲就推断当前已经并行运行。

### 2.2 GO 优先，而非组件类型优先

[GObject::tick][p-object] 的核心代码为：

```cpp
for (auto& component : m_components)
{
    if (shouldComponentTick(component.getTypeName()))
    {
        component->tick(delta_time);
    }
}
```

- Level 的对象容器是 [`std::unordered_map`][p-level-header]，跨 GO 的更新顺序没有业务层面的稳定顺序保证。
- GO 的组件容器是 [`std::vector`][p-object-header]，组件按容器顺序更新。
- 加载时先放入实例组件，再追加定义中尚未被实例覆盖的组件；这个装配顺序也会影响 tick 顺序。
- `shouldComponentTick` 在编辑器模式下检查全局类型白名单，运行模式返回 true。该函数读取的是白名单，而非组件基类的 `m_tick_in_editor_mode` 字段。
- 基类允许空 `tick`；本项目通过显式 `phases` 让纯数据 Transform 不进入更新索引。

假设两个 GO 都有 A、B，且组件装配顺序一致：

```text
Piccolo： GO1.A → GO1.B → GO2.A → GO2.B       GO 的先后另受容器影响
本项目：  A(GO1) → A(GO2) → B(GO1) → B(GO2)  同一个阶段内
```

两者均为组件化对象模型，但跨对象数据依赖的表达能力不同。

### 2.3 三个容易误读的时间／数据细节

#### 输入不是在 World 更新前统一采样

[InputSystem][p-input] 的键盘回调直接改 command，鼠标回调保存位移；`InputSystem::tick()` 计算 yaw/pitch 增量并清空原始位移。该 tick 位于 World 更新之后，窗口事件轮询又在本帧尾部。

因此，不能把它简化为“先采样全部输入，再执行当前逻辑”。尤其鼠标角度预处理的结果在后续 World tick 才被消费；键盘状态与鼠标预处理的路径也不相同。这里依据调用顺序分析数据可见性，并未测量其端到端输入延迟。

本项目的浏览器事件先累积输入，Player 在 `input` 阶段消费，随后本帧的固定步使用 command，顺序更符合当前第一人称控制需求。

#### 固定参数物理步进不等于累加器固定更新

[PhysicsScene::tick][p-physics] 实际执行：

```cpp
const float time_step = 1.f / m_config.m_update_frequency;
m_physics.m_jolt_physics_system->Update(time_step, /* ... */);
```

该方法的 `delta_time` 未用于计算此步长；Level 每次 tick 调用它一次。这里的碰撞步数／积分子步参数属于一次 Jolt Update 内部的细分，不能当成 Engine 根据帧间隔进行的追帧循环。

组件本身使用可变帧间隔，物理世界每帧执行一次配置步长。这与本项目 `0…5` 次固定步累加器具有不同语义。应保留本项目的固定更新方案。

#### Transform 读写双缓冲与渲染插值是不同机制

[TransformComponent][p-transform-header]：位置／旋转等只读 getter 读取 current，setter 及可写的 `getTransform()` 操作 next；[tick][p-transform] 交换索引，并在 dirty 时同步刚体。[MeshComponent][p-mesh] 读取 Transform／Animation，生成 dirty render 描述，随后清除 Transform dirty。

这表示的是**读写状态的发布时机**，不是本项目的 `previousPosition → position` 插值。由于交换发生在各 GO 的组件遍历中，其可见性也受到组件顺序影响，并不存在自动的全世界 Transform 屏障。

同时，[Camera][p-camera] 消费 Character 的位置，Character 在全部 GO tick 后才[更新自身状态][p-character]。这些都是实际的跨阶段数据关系，不能只把每个类改成一个 `tick` 就认为依赖已被消除。

### 2.4 值得吸收的部分

- **行为与领域服务分离**：组件调用运动、动画、物理和渲染能力。
- **明确的发布边界**：Mesh／Camera 提交描述，渲染通过 [RenderSwapContext][p-swap] 消费。
- **增量同步意识**：只处理 dirty 对象，适合对象数量较多时降低同步成本。

对应到本项目，优先加强 `presentation` 边界和数据版本语义。当前单线程 Three.js 场景可继续直接承接发布后的姿态；新增线程交换层需要实际的 Worker／渲染线程需求。

## 3. 当前项目已经具备的能力

源码入口：[Engine][local-engine]、[Time][local-time]、[Level][local-level]、[Motor][local-motor]、[Player][local-player]。

```text
Engine.step(now)
  Time.tick(now)
  logicalTick()
    工具 input 通知
    WorldManager → Level.tickComponents(input)
    repeat fixedSteps:
      Level.tickComponents(fixed)
      Level.tickComponents(postPhysics)
    Level.tickComponents(motion)
    Level.tickComponents(presentation)
  rendererTick()
  frame 通知

每次 Level 分发：phase → ComponentConstructor → 实例
```

| 阶段 | 频率／delta | 当前参与者 | 写入与消费 |
| --- | --- | --- | --- |
| input | 每显示帧一次，缩放后的帧 delta | Player | 消费 look/jump，写 command、朝向／俯仰 |
| fixed | 每固定步一次，fixedDelta | fixed Motor | 保存位置历史，运动计算，同步碰撞解算，提交位置 |
| postPhysics | 每固定步一次，fixedDelta | Player | 检查越界，必要时 teleport／resetMotion |
| motion | 每显示帧一次，缩放后的帧 delta | frame Motor | 茶壶的环绕、漂浮、自转 |
| presentation | 每显示帧一次 | Mesh、Player | 采样 Transform，更新模型根节点与相机 |

Player 相机的眼高平滑实际使用 `time.rawDelta`，而不是阶段的缩放 delta。`rawDelta` 在当前 Time 中也经过 `maxDelta` 裁剪，不能当成完整墙钟间隔。

当前重要约束已经正确建立：

- Transform 是空间状态来源；Mesh 和相机消费它。
- 玩家与茶壶共享 Motor 类型，只是进入不同阶段并使用不同运动函数。
- PhysicsSystem 是同步服务，固定步次数归 Engine；带碰撞的 Motor 每次固定更新调用一次 `move`。
- 跳跃由 Player 排队，首个实际固定步消费一次；零固定步帧保留请求。
- GO 负责组合／所有权；没有与 Level 并存的 `GameObject.tick()` 循环。
- 同阶段先完整快照所有类型及其实例，避免新增组件混入尚未访问的类型批次。

当前真实关卡通常是房间、地面、玩家、茶壶四个 GO，Mesh 同步的是三个模型根节点。GLB 内的大量 primitive 不等于同等数量的 Component tick。

### 3.1 关键差异汇总

| 维度 | Piccolo 固定版本 | 当前项目 |
| --- | --- | --- |
| 分发单位 | GO 内依次 tick 组件 | 按阶段跨 GO 分组组件类型 |
| 组件时间 | 可变帧 delta | 固定步与帧时钟按阶段区分 |
| 物理推进 | Level 每帧调用一次配置步长的 Jolt Update | Engine 计划固定步，Motor 同步调用碰撞服务 |
| Motor 复用 | [tickPlayerMotor][p-motor] 检查当前活动 Character 并直接读取全局输入 | 接收普通 command 和运动函数，可用于玩家、茶壶与无输入角色 |
| 状态发布 | GO 内 Transform 交换，Mesh／Camera 写 render swap data | Motor 提交 Transform，全局 presentation 后绘制 |
| 更新资格 | 编辑器类型白名单与组件内部判断 | 显式 phases、enabled、GO active、生命周期检查 |

因此，进一步组件化的重点是让通用组件的依赖与时序可组合，而不是仅增加组件数量或复制 Piccolo 中所有组件内部逻辑。

## 4. 已确认的缺口与证据

| 编号 | 当前事实 | 影响与优先级 |
| --- | --- | --- |
| F1 | 所有固定子步拿到同一个 `frame.time`；只有帧 elapsed，没有全局 fixed tick／fixed elapsed | 多步内无法用统一编号标识模拟进度；目前 Motor 自己累积 elapsed，运动本身不因此重复。P0 |
| F2 | `logicalTick()` 可重复消费相同 `fixedSteps`；Level 可在组件回调中被递归分发 | 重复推进，或破坏阶段边界。P0 |
| F3 | `registerComponent` 接受任意 phase 字符串 | 拼写错误的阶段会静默永不执行。P0 |
| F4 | 达到限步条件后将 accumulator 整体置 0 | 完整超额步与不足一步的余量一起丢弃，alpha 突然归零；丢弃时间没有诊断。P0 |
| F5 | 每次分发用 `Array.from(..., members => [...members])` 重建整阶段快照 | 稳态也复制全部成员引用；一帧最多 `3 + 2 × 5 = 13` 次阶段分发。P1 |
| F6 | 渲染 CPU 指标只计提交绘制；`physics.lastStepMs` 只保存最近一次 solve | 无法知道逻辑各阶段、各类型和整帧多次物理解算的累计成本。P1 |
| F7 | 每次 addObject 将捕获 object 的闭包加入 Level.disposer；removeObject 不撤销登记 | 长寿命关卡积累历史闭包与已销毁 GO 的引用，直到卸载。P1 |
| F8 | Mesh 每帧都同步姿态，包括静态房间／地面 | 可扩展性优化点；当前只有少量根节点，尚不足以认定为瓶颈。P2 |

F7 来自 [Level.addObject][local-level] 和 [Disposer][local-disposer] 的引用关系：对象的组件已正常释放，不能把这项引用保留直接解释成 GPU 资源泄漏。

### 4.1 本次复现结果

对当前源码执行了无文件落盘的 Node 脚本：

| 操作 | 结果 |
| --- | --- |
| `step(0)`、`step(50)` | 3 次 fixed 均看到 `frame = 2, elapsed = 0.05` |
| 随后再调用 `logicalTick()` | fixed 调用累计从 3 变成 6 |
| Time 依次 `tick(0)`、`tick(10)`、`tick(110)` | 最后一帧 5 步，alpha 为 0；若仅丢完整超额步，余量应约为 0.01 秒、alpha 约为 0.6 |
| 注册 `phases = ['presenation']` | 注册成功；presentation 调用次数为 0 |
| 组件内部受控地递归调用同阶段一次 | 同一组件被执行 2 次 |

F2 目前甚至被 [runtime.test.mjs][local-runtime-tests] 中的独立 logicalTick 测试所允许。引入防重复契约属于明确的行为修订，需要同步修改该测试，而非把现有测试描述成失败。

快照分配由源码确认；本次未采集 CPU／GC 性能基线，因此性能收益在实施阶段实测。

## 5. Component-based Tick 的目标契约

### 5.1 所有权与调度权

```text
RuntimeContext    构造并持有服务
Engine            推进时钟，编排各阶段
WorldManager      路由至活动 Level
Level             保存索引与执行批次，逐类型分发
GameObject        组件装配、依赖与销毁
Component         本能力的状态与行为
领域函数／服务     实际算法
```

类型批次仍逐实例调用 `component.tick(context)`。这种组织方式有利于明确顺序、减少无关遍历和按类型测量，但 JS 对象仍是分散存储；它不自动产生连续内存、SIMD、并行或 ECS 的性能。

### 5.2 区分三种依赖

| 依赖 | 表达方式 | 示例 |
| --- | --- | --- |
| 同 GO 的能力存在性 | `static requires`，装配时校验 | Mesh 需要 Transform |
| 本帧／本步的数据先后 | 固定阶段边界 | 所有 fixed Motor 完成后才进行 postPhysics |
| 下一次模拟所需的历史 | 显式历史字段、command、固定步编号 | previousPosition、待消费 jump |

`requires` 不代表 tick 优先级。稳定插入顺序也不代表业务依赖已被声明。

**同阶段的不同类型，以及同类型的不同实例，都应避免依赖彼此“刚刚更新后的值”。** 当前 Motor 查询的是关卡碰撞世界，未来加入动态角色相互碰撞时，这条独立性需要重新论证。仅改成类型批次不能消除读写冲突。

若出现真实新依赖，例如“角色完成越界重生后再进行武器命中判断”，应建立明确的后续阶段或领域内的两段计算／提交。把 Weapon 恰好注册在 Player 后面，会把正确性绑到装配顺序上。

当前五阶段仍能覆盖已有行为，同阶段使用稳定插入顺序执行。某类型全部移除后再注册，会排到该阶段的后面；此顺序只能用于可复现的局部遍历，不能作为跨关卡装配或联机确定性的承诺。

### 5.3 组件声明与执行限制

- 保留 `onAttach / tick(context) / dispose`，组件按需声明 `phases`；纯数据组件可使用空列表。
- 阶段名称集中定义。在 `onAttach` 和索引登记之前检查：合法名称、无重复声明、组件归属正确，防止错误声明先产生挂接副作用。
- 阶段元数据在一次挂接期间保持不变；Motor 的 clock 继续为构造期配置。改变阶段使用明确的移除／重新装配流程。
- 类型索引仍以构造器为 key；类名只用于诊断显示。
- onAttach 与 tick 同步执行，不返回 Promise。异步资源工作在加载流程中完成后再挂接；开发检查发现 thenable 时立即报错。
- 组件可以调用依赖组件的普通方法；更新入口由 Engine／Level 统一调度。
- `enabled`、`owner.active` 表示调度资格，不自动从 Three.js 场景中隐藏节点。可见性属于呈现状态。

### 5.4 阶段内增删与启停

采用当前的**阶段入口成员快照 + 调用前资格检查**语义，并把边界写清楚：

| 操作 | 生效时机 |
| --- | --- |
| 在 A 阶段新增同属 A 的组件，包括尚未访问的类型 | 下次 A 分发；不会混入当前 A |
| 在 input 新增 fixed 组件 | 可进入本帧随后开始的 fixed |
| 在 fixed 子步 0 新增 fixed 组件 | 可进入本帧 fixed 子步 1 |
| 在 fixed 新增 postPhysics 组件 | 可进入随后开始的 postPhysics |
| 移除尚未调用的组件或 GO | 当前快照中也必须跳过 |
| disable／deactivate | 到达调用点时按当前资格判断 |
| disable 后在调用点之前再次 enable | 若原本在快照中，可执行一次；启停不是事件锁存 |
| 正在执行的组件移除自身 | 当前函数不会自动中断；释放后应立即返回 |
| Level 被卸载／销毁 | 剩余组件跳过，后续 World 分发不进入旧关卡 |

新增对象的 `onAttach` 必须建立可消费的完整初始状态，因为“下一阶段可见”不等于“下一完整模拟步可见”。当前关卡主要在加载期间装配对象，接受这一最小语义。

若后续投射物／战斗生成要求从下一完整固定步开始，可在明确的固定步边界发布这些 GO；这是新增玩法契约，不能通过缓存优化暗中改变现有阶段可见性。

Level 在分发期间禁止再次进入自身的任意 `tickComponents`，包括不同 phase，以免绕过 Engine 顺序。结构修改仍走现有同步装配／移除接口。

## 6. 时间、输入与帧入口

### 6.1 目标 TickContext

保留 `{ phase, delta, time }` 的调用外形，`time` 改为当前调用的只读标量快照。Engine 继续持有可配置的 Time；组件拿到的不是这个可变对象本身。

| 字段 | 定义 |
| --- | --- |
| `phase` | 当前阶段 |
| `delta` | fixed／postPhysics 为 fixedDelta；其余为缩放后的帧 delta |
| `time.frame` | 显示帧编号，沿用现有字段 |
| `time.delta / rawDelta / elapsed` | 缩放帧间隔／裁剪后的未缩放间隔／累计帧时间；elapsed 沿用现有含义 |
| `time.fixedDelta / fixedSteps / alpha` | 固定步长／本帧计划步数／限步处理后的余量比例 |
| `time.fixedTick` | fixed／postPhysics 中为正在执行的步编号；其余阶段为最近已完成的步编号 |
| `time.fixedElapsed` | 对应 fixedTick 的模拟时间，等于该编号乘固定步长 |
| `time.fixedStepIndex` | 本帧内从 0 开始的子步索引；非固定阶段为 null |
| `time.timeScale` | 本帧开始时锁定的缩放值 |
| `time.droppedSimulationTime` | 本帧因 maxFixedSteps 丢弃的完整模拟步时长 |

执行规则：

1. Engine 在本帧入口锁定时间配置；帧中修改 timeScale 从下一帧生效。
2. 一个 fixed 和紧随其后的 postPhysics 使用相同 fixedTick／fixedElapsed／fixedStepIndex。
3. 两者正常完成后提交该固定步计数。模拟时钟属于 Engine，空世界也可完成空固定步；关卡重载不自动重置它。
4. motion／presentation 看见本帧最后完成的模拟编号。`time.elapsed` 继续表示帧时钟，不替代 fixedElapsed。
5. Motor.elapsed 保留为组件自身实际运行的时间，禁用期间不累计；它与全局模拟时间有不同用途。
6. TickContext 及 Time 快照冻结，组件不能修改其他组件将读取的 delta／alpha。每阶段 O(1) 的上下文分配与成员快照优化分别测量。

工具 input、渲染和 frame 通知也读取相应时点的快照；时间配置通过 Engine 持有的 Time 修改，避免通知观察者重新获得可变时间状态。

例如一帧执行三步：

```text
fixed(1) → postPhysics(1)    fixedElapsed = 1/60
fixed(2) → postPhysics(2)    fixedElapsed = 2/60
fixed(3) → postPhysics(3)    fixedElapsed = 3/60
presentation                fixedTick = 3，使用 alpha 采样
```

### 6.2 限步时保留不足一步的余量

设上一帧余量为 `a`，本帧缩放后间隔为 `d`，固定步长为 `h`：

```text
total = a + d
wholeSteps = floor(total / h)
fixedSteps = min(wholeSteps, maxFixedSteps)
droppedSimulationTime = (wholeSteps - fixedSteps) * h
nextAccumulator = total - wholeSteps * h
alpha = nextAccumulator / h
```

浮点边界需保持 `0 <= alpha < 1` 的容差约束。丢弃的是完整超额步，保留插值余量。

本次复现中的 `0.01 + 0.1` 秒，执行五步、丢弃一步，保留约 0.01 秒余量。`time.elapsed` 因而不要求等于 fixedElapsed；帧运动与固定运动在过载丢时后可能产生时钟差异，这应通过诊断体现。

`maxDelta` 对墙钟间隔的裁剪与 `maxFixedSteps` 对模拟步的丢弃属于两种损失，指标不能混用。构造／设置参数时检查有限数值、`fixedDelta > 0`、`maxDelta > 0`、正整数 maxFixedSteps、`timeScale >= 0`；运行中修改固定步长需要单独的历史重置策略。

### 6.3 输入消费与暂停

- 浏览器输入持续累积；每帧 input 只消费一次。
- held command 可供本帧所有固定步读取；jump 保留到首个实际固定步消费，并在该步清除。
- 当前 jump 是一个布尔待消费请求，多个按下会合并。未来射击等要求保留多次动作时再使用有序命令队列。
- 鼠标增量每显示帧消费一次，用于即时视角；不因本帧五个固定步而应用五次。
- `timeScale = 0` 冻结固定／帧 Motor 的时间；视角输入和 rawDelta 驱动的观察仍按当前策略工作。
- 需要暂停期间彻底禁止玩家输入时，由输入／模式控制清空 command，不能期待 timeScale 自动完成。
- `Engine.pause()` 停止后续 RAF；在同步 tick 中调用 pause 不回滚已经开始的帧。destroy／关卡销毁按生命周期规则停止后续调用。

固定步提供稳定的积分步长，但当前输入仍按显示帧采样；在引入按模拟编号记录的命令前，不宣称不同显示帧率下的逐位确定性或联机回放能力。

### 6.4 单帧只能推进一次逻辑

- `step(now)` 是正常帧入口，先检查重入，再推进 Time。
- `logicalTick()` 只消费当前已准备且未消费的帧；同 frame 再次调用应抛出带 frame 编号的错误。
- 无新帧时需要单独验证逻辑，使用无 render 的 Engine 执行 step；不靠重复 logicalTick 推进模拟。
- Level 分发期间禁止递归分发；logicalTick／step 执行期间禁止递归进入逻辑。
- `rendererTick()` 可在逻辑结束后重复执行，不推进时间、消费 command 或运行组件；逻辑未结束时禁止重入绘制，避免发布半完成状态。
- 组件异常停止当前帧并交给现有错误通道。已发生的组件写入不具备事务回滚，失败帧也不能重新消费；固定步完成计数不冒充已成功执行的步骤。

## 7. 执行批次缓存：保留语义，降低分配

### 7.1 数据结构与失效

Level 继续持有阶段／构造器／成员集合，在阶段记录上增加缓存信息即可：

```text
PhaseRecord
  membersByType: Map<Constructor, Set<Component>>
  revision
  planRevision
  plan: Array<{ type, members: Component[] }> | null
```

1. register／unregister 只使受影响阶段失效；失效时清空 Level 保存的旧 plan 引用。
2. 每次阶段入口检查 revision，需要时构建**整个阶段**的新 plan。
3. 本次分发局部持有该 plan；结构修改不能原地改变它。
4. 回调前继续检查 component／owner／Level 的存活、归属、enabled、active。
5. 正常移除先注销，再销毁；已失效的缓存不能长期持有被移除组件。
6. enabled／active 改变不重建成员列表，因为资格仍在调用前读取。
7. 注销／注册作为 GO 与 Level 的内部协议收口，避免外部绕过所有权仅改索引。

**不能改成“访问某类型时才复制该类型的 Set”。** 否则前一个类型新增到后一个类型的实例，会在同一次阶段分发中被执行，破坏现有测试覆盖的语义。

当前每次分发产生约 `1 + 类型数` 个数组并复制该阶段全部成员引用。目标是结构稳定时复用计划；成员遍历仍为 O(N)，结构变化时才支付 O(N) 重建成本。高频增删下的表现需要单独测量。

### 7.2 动态对象的释放登记

Level.objects 已是活动 GO 的所有者。建议让它负责存活 GO 的统一逆序销毁，避免每次 addObject 都给长寿命 Disposer 增加永久清理闭包。

目标释放顺序：

```text
RangeRoomLevel：先解绑阴影／探针等材质扩展
Level：标记 disposed，清空更新索引与缓存
       按装配逆序移除当前仍存活的 GO
       释放其余关卡共享资源
```

removeObject 立即从活动集合移除并释放，卸载阶段只处理仍存活对象。实施时专门验证 Mesh 实例先于共享资源释放，保持现有取消加载、挂接失败、重复卸载的幂等性。

## 8. 表现边界与 Transform 增量同步

### 8.1 当前阶段关系继续成立

```text
input：Player 写朝向／command
fixed：Motor 写模拟位置
postPhysics：Player 必要时 teleport，重置历史
motion：frame Motor 写当前表现运动姿态
presentation：Mesh／相机读取最终 Transform
rendererTick：消费已准备的 Scene／Camera
```

同一字段的写入权必须明确：玩家位置由 Motor 写、越界时由 teleport 显式覆盖；玩家朝向由 Player 写；茶壶姿态由其 Motor 写。不同拥有者的写入安排由阶段／组合约束表达。

固定 Motor 每个子步开始捕获 previousPosition，presentation 只采样；不把插值结果写回模拟状态。teleport 必须同时重置历史。

独立暂停固定 Motor 时也要重置或固定插值历史，否则变化中的 alpha 可能继续在旧／新位置间采样。当前 Player.setEnabled(false) 已通过 resetMotion 做到这一点，后续通用 Motor 暂停入口应维持相同语义。

### 8.2 P2 增量同步的前置条件

Piccolo 的 dirty 思路可以借鉴，但多个消费者读取同一 Transform 时，Mesh 不应清掉其他消费者尚未消费的全局 dirty 标志。适合本项目的是**生产者版本 + 每个消费者自己的 lastSeenVersion**。

实施前需要先收拢当前直接修改 Vector3／Quaternion 的写入点，保证每次提交都正确递增版本。仅添加 version 字段而保留不受控的直接写入，会漏同步。

进一步要求：

- 非插值 Transform 可依据姿态版本跳过重复同步。
- 插值对象即使本帧没有固定步，只要 alpha 改变，采样位置也可能变化；仅检查当前姿态版本不够。
- 历史捕获、teleport、插值启停、旋转、缩放均需进入失效条件。
- Mesh 和相机独立记录消费状态。
- `mobility: static` 本身不意味着永久不可移动或无行为。

当前规模下先测 Mesh 批次成本，再决定这一步；缓存 tick 计划与跳过姿态同步是两项不同优化。

## 9. Tick 诊断与性能验收

### 9.1 指标

沿用 `?profile=1` 的使用入口，在 app 诊断层暴露有界统计：

| 范围 | 指标 |
| --- | --- |
| Engine | frame、计划／完成 fixed 步数、fixedTick、丢弃模拟时间、logical 总耗时 |
| 阶段 | input／fixed／postPhysics／motion／presentation 的调用次数与累计耗时 |
| 类型 | 每阶段各类型的实际 tick 次数、跳过数、批次耗时 |
| 调度结构 | plan 重建次数、当前登记组件数量 |
| Physics | 整帧 move 次数与累计 solve 耗时；继续保留最近一次耗时的原义 |

按类型批次计时，每批次采样起止，避免默认对每个组件调用两次 performance.now。固定阶段多步耗时在同一显示帧内累加。

Physics 耗时已包含在 Motor／fixed 的耗时内；它是子项，不能再次加到 logical 总时间中。工具 input 通知的耗时也应独立归因，避免与 Player 输入批次混淆。

统计只保留数值与有界窗口，快照时计算百分位；禁用 profile 时不运行逐类型高频计时。

### 9.2 测量方法

- 真实关卡：固定浏览器版本、窗口大小和渲染配置，记录逻辑各阶段 p50／p95／p99，作为小规模基线。
- 调度专项：100／1,000／10,000 个轻量 GO，交错装配两种以上类型；分别测试 0／1／5 固定步。
- 两种结构负载：成员稳定；每帧约 1% 对象生成／移除。使用等价行为，避免拿不同计算量比较调度器。
- 每组先暖机至少 120 帧，再采集至少 1,000 帧，多轮对照。Node 用于纯调度对照，浏览器用于 JS 分配／GC 与真实运行验证。
- 预期的结构性结果：稳态计划不重建；一次结构变化仅让相应阶段在下一入口重建；销毁后无残留索引或缓存引用。
- 性能结论以实测变化为准；若真实场景或高 churn 的 p95 持续退化，应简化缓存实现。不能把类型批次直接等同于 FPS 提升。

构建产物、浏览器配置、截图与报告使用 `D:/opencode-temp/opencode/` 下的任务目录。

## 10. 分步实施范围

下表 `runtime/` 表示 `src/engine/runtime/`，`framework/` 表示其 `function/framework/`；其他路径相对项目根目录：

| 步骤 | 文件／落点 | 交付内容 |
| --- | --- | --- |
| 1：P0 时间 | `runtime/core/time.js`、`runtime/engine.js` | 固定步编号／时间、余量保留、只读上下文、重复／重入保护 |
| 2：P0 分发契约 | `framework/component/`、`framework/level/level.js`、`framework/object/game-object.js` | 集中阶段声明与校验、挂接事务回滚、禁止递归分发 |
| 3：P1 测量 | `runtime/engine.js`、`framework/level/level.js`、`runtime/function/physics/physics-system.js`、`src/app/diagnostics.js` | 逻辑／类型批次统计，修改前后的可比基线 |
| 4：P1 分配与释放 | `framework/level/level.js`、`src/game/range-room/level.js` | 缓存整阶段计划、及时失效、活动对象集合统一销毁 |
| 5：条件性 P2 | Transform／Mesh／Motor、`src/game/player/player.js` | 在测量支持后收口姿态写入与版本同步 |
| 6：文档 | `docs/architecture.md`、既有组件 Spec 的后续链接 | 记录已落地契约、兼容变化与验收证据 |

阶段声明可以在 `framework/component/` 下使用一个轻量共享模块；Engine 仍显式列出执行顺序。当前收益来自契约与批次管理，调度所有权继续集中在现有 Engine／Level。

## 11. 验收标准

### 11.1 正确性

1. **跨 GO 类型批次**：交错装配仍按 A 全部完成、B 全部完成执行；静态对象的行为正常参与。
2. **多步时间**：0／1／5 步有正确 fixedTick／fixedElapsed；fixed 与对应 postPhysics 使用同一子步编号。
3. **唯一消费**：同帧重复 logicalTick、递归 step、递归 Level 分发明确失败，不增加 Motor／solve 调用次数。
4. **只读上下文**：一个组件无法修改后续组件读取的 delta、alpha、子步时间；帧中 timeScale 修改次帧生效。
5. **阶段校验**：拼写错误／重复声明在挂接前失败；挂接回滚后没有残留索引或场景节点。
6. **增删可见性**：覆盖同类型新增、后续类型新增、同帧下一子步新增、移除、停用／再启用、自移除和卸载。
7. **单次运动**：0／1／5 步分别产生对应次数的带碰撞 Motor 更新与 move；零步帧保留 jump，多步只消费一次。
8. **限步余量**：`0 → 10 → 110 ms` 案例保留约 0.01 秒余量；实际模拟时长与丢时指标吻合，alpha 范围有效。
9. **独立渲染**：重复 rendererTick 不修改 Transform、Motor.elapsed、输入请求和 fixedTick。
10. **表现稳定**：teleport／重生／固定 Motor 暂停无历史拖尾，玩家相机和 Mesh 读取同一权威姿态；保持既有运动数值回归。
11. **有界释放**：长时间生成／销毁后，活动对象数、索引和计划引用回到基线；关闭顺序满足绑定先解绑、实例后释放、共享资源最后释放。
12. **统计准确**：多步成本正确累计；Physics 仅作子项展示；关闭 profile 后无逐类型计时。

相关行为测试扩展在现有 `tests/runtime.test.mjs`、`tests/framework.test.mjs`、`tests/motion.test.mjs`；浏览器生命周期与渲染隔离继续使用 `tools/check-runtime-browser.mjs`，玩家行为使用 `tools/check-player-browser.mjs`。

### 11.2 本次对比已执行的检查

```bash
node --test tests/runtime.test.mjs tests/framework.test.mjs tests/motion.test.mjs
```

结果：**16/16 通过**。另执行了 §4.1 的五项定向复现。上述结果描述当前实现，不代表本提案已完成实施验收。

## 12. 最终设计判断

Piccolo 的主要参考价值在于职责边界、组件组合和逻辑／渲染数据发布，而本项目当前的类型优先调度已经更贴近目标。

下一轮最有价值的工作，是让组件明确知道：**本次属于哪一帧／哪一模拟步、读到的是哪个阶段的状态、结构变化何时可见、谁拥有唯一更新权**。这些确定后，再以缓存批次和增量同步优化成本，才能让更多角色、武器和可交互物件自然接入同一条更新链。

[piccolo-commit]: https://github.com/BoomingTech/Piccolo/commit/f5053707fed4d3f94d270a436fb0d3a8ae54e3e5
[p-engine]: https://github.com/BoomingTech/Piccolo/blob/f5053707fed4d3f94d270a436fb0d3a8ae54e3e5/engine/source/runtime/engine.cpp#L68-L102
[p-world]: https://github.com/BoomingTech/Piccolo/blob/f5053707fed4d3f94d270a436fb0d3a8ae54e3e5/engine/source/runtime/function/framework/world/world_manager.cpp#L47-L61
[p-level]: https://github.com/BoomingTech/Piccolo/blob/f5053707fed4d3f94d270a436fb0d3a8ae54e3e5/engine/source/runtime/function/framework/level/level.cpp#L138-L163
[p-level-header]: https://github.com/BoomingTech/Piccolo/blob/f5053707fed4d3f94d270a436fb0d3a8ae54e3e5/engine/source/runtime/function/framework/level/level.h#L16
[p-object]: https://github.com/BoomingTech/Piccolo/blob/f5053707fed4d3f94d270a436fb0d3a8ae54e3e5/engine/source/runtime/function/framework/object/object.cpp#L20-L101
[p-object-header]: https://github.com/BoomingTech/Piccolo/blob/f5053707fed4d3f94d270a436fb0d3a8ae54e3e5/engine/source/runtime/function/framework/object/object.h#L68-L75
[p-input]: https://github.com/BoomingTech/Piccolo/blob/f5053707fed4d3f94d270a436fb0d3a8ae54e3e5/engine/source/runtime/function/input/input_system.cpp#L104-L169
[p-physics]: https://github.com/BoomingTech/Piccolo/blob/f5053707fed4d3f94d270a436fb0d3a8ae54e3e5/engine/source/runtime/function/physics/physics_scene.cpp#L166-L184
[p-transform-header]: https://github.com/BoomingTech/Piccolo/blob/f5053707fed4d3f94d270a436fb0d3a8ae54e3e5/engine/source/runtime/function/framework/component/transform/transform_component.h#L21-L46
[p-transform]: https://github.com/BoomingTech/Piccolo/blob/f5053707fed4d3f94d270a436fb0d3a8ae54e3e5/engine/source/runtime/function/framework/component/transform/transform_component.cpp#L16-L64
[p-mesh]: https://github.com/BoomingTech/Piccolo/blob/f5053707fed4d3f94d270a436fb0d3a8ae54e3e5/engine/source/runtime/function/framework/component/mesh/mesh_component.cpp#L59-L104
[p-motor]: https://github.com/BoomingTech/Piccolo/blob/f5053707fed4d3f94d270a436fb0d3a8ae54e3e5/engine/source/runtime/function/framework/component/motor/motor_component.cpp#L51-L83
[p-camera]: https://github.com/BoomingTech/Piccolo/blob/f5053707fed4d3f94d270a436fb0d3a8ae54e3e5/engine/source/runtime/function/framework/component/camera/camera_component.cpp#L48-L108
[p-character]: https://github.com/BoomingTech/Piccolo/blob/f5053707fed4d3f94d270a436fb0d3a8ae54e3e5/engine/source/runtime/function/character/character.cpp#L41-L87
[p-swap]: https://github.com/BoomingTech/Piccolo/blob/f5053707fed4d3f94d270a436fb0d3a8ae54e3e5/engine/source/runtime/function/render/render_swap_context.cpp#L33-L98
[local-engine]: ../../../src/engine/runtime/engine.js
[local-time]: ../../../src/engine/runtime/core/time.js
[local-level]: ../../../src/engine/runtime/function/framework/level/level.js
[local-motor]: ../../../src/engine/runtime/function/framework/component/motor/motor-component.js
[local-player]: ../../../src/game/player/player.js
[local-disposer]: ../../../src/engine/runtime/core/disposer.js
[local-runtime-tests]: ../../../tests/runtime.test.mjs
