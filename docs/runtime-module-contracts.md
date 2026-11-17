# 模块所有权、更新阶段与生命周期

本文描述当前代码，不是新增全局 System 的方案。完整目录见[运行时架构](architecture.md)，武器协议见[武器玩法](weapons/gameplay.md)。

## 三条约定

1. **拥有者负责释放，借用者不释放。** 创建／注入依赖不代表取得其销毁权；共享资源与对象实例分别管理。
2. **Engine 编排阶段，组件与服务执行各自职责。** 不新增独立 RAF、计时累加器、按名字查找系统或重复遍历组件的 System。
3. **玩法状态只有一个提交入口，表现读取已提交事实。** 动画结束、资源 Promise、HUD 和声音不能反向决定扣弹、补弹或伤害。

`Component` 表达单个对象的能力；服务处理共享资源或跨对象协调；`game` 定义具体玩法。类名是否以 System 结尾不改变这些边界。

## 运行时与对象所有权

源码均位于 `src/`：

| 模块／入口 | 拥有的数据与资源 | 借用的依赖 | 更新与释放 |
| --- | --- | --- | --- |
| [RuntimeContext](../src/engine/runtime/function/global/runtime-context.js) | 当前应用的 Engine、资源管理、场景／世界相机、渲染、音频、粒子、输入、物理、WorldManager 和 Size | canvas、应用配置 | 异步 initialize；关闭先停 Engine 和应用工具，再逆序释放服务 |
| [Engine / Time](../src/engine/runtime/engine.js) | 帧驱动连接、运行状态、唯一模拟时间轴与阶段编排 | WorldManager、Render、Audio、Particles、listener 采样器 | step 推进一次；rendererTick 只绘制已完成逻辑；destroy 停帧并使声音失效 |
| [WorldManager](../src/engine/runtime/function/framework/world/world-manager.js) | 活动关卡与进行中的加载／取消状态 | 关卡工厂 | 将阶段转交活动 Level；卸载先清活动引用、通知工具，再释放关卡 |
| [Level](../src/engine/runtime/function/framework/level/level.js) | 活动 GO 集合与关卡共享资源的清理器 | Scene 和具体关卡注入的服务 | 每阶段扫描全部 GO，先收集组件快照再执行；卸载先 GO 后共享资源 |
| [GameObject](../src/engine/runtime/function/framework/object/game-object.js) | 自己的组件实例、id 与 active 状态 | 所属 Level | 只负责组合、依赖和生命周期；组件按装配逆序销毁 |
| [ResourceManager](../src/engine/runtime/resource/resource-manager.js) | 下载任务、缓存与共享资产模板 | loader 能力 | 按请求加载／取消，无玩法 tick；作用域卸载资源，runtime 最终关闭管理器 |
| [Transform](../src/engine/runtime/function/framework/component/transform/transform-component.js) | 世界姿态与位置历史 | 无 | Motor 或玩法提交，presentation 采样；teleport 同步重置历史 |
| [Motor](../src/engine/runtime/function/framework/component/motor/motor-component.js) | 速度、运动命令、接地／蹲伏状态、台阶历史 | Transform、Physics、碰撞世界、motion 函数 | 固定时钟在 fixed，帧时钟在 motion；Physics 只同步解算，不另行推进同一对象 |
| [Mesh](../src/engine/runtime/function/framework/component/mesh/mesh-component.js) | 实例根树及其 release 回调 | Transform、Scene、共享 geometry／纹理 | presentation 同步根姿态；dispose 移除根树并调用实例释放，不擅自销毁共享模板 |

## 玩家、武器和表现所有权

| 模块／入口 | 拥有的内容 | 更新阶段 | 生命周期与禁止事项 |
| --- | --- | --- | --- |
| [PlayerComponent](../src/game/player/player.js) | 玩家规则、重生请求、AimState、PlayerWeapons 与脚步适配者 | input 收集命令；postPhysics 提交重生、瞄准与射击；motion 推进武器表现 | 禁用时挂起武器；返回玩家时重锚视角；dispose 释放自有适配者，不释放借用的运行时服务 |
| [AimState](../src/game/player/aim-state.js) | 基础视角、固定眼位、ADS、散布、逐发后坐力和表现历史 | input 只累积 look；postPhysics 的 beginStep / fire / endStep 提交；sample 只读 | 不写渲染相机；射线取本发后坐力冲量前姿态，随后添加本发后坐力 |
| [EquipmentController](../src/game/weapons/equipment-controller.js) | 私有 WeaponInventory、装备事务、动作、冷却裁定、epoch 与准备票据 | queue 收集命令，PlayerWeapons.fixed 在 postPhysics 调用 step | 仅普通数据；不持有 Three.js 对象，不做异步加载；reset／suspend／dispose 使旧工作失效 |
| [WeaponInventory](../src/game/weapons/inventory.js) | 每个武器实例的弹药、冷却、射击序号与已提交皮肤 | 由控制器同步提交，无独立 tick | 返回只读快照；枪型配置可共享，实例状态不共享 |
| [PlayerWeapons](../src/game/weapons/player-weapons.js) | 控制器、视模／声音／命中特效适配者、最近射击事实 | collectInput 收集；fixed 补全方向／射线并分发事实；motion 推进表现 | 借用世界、目标注册表、Audio、Particles、WeaponAssets 与 viewmodel layer；不释放这些共享依赖 |
| [WeaponAssets](../src/game/weapons/assets/weapon-assets.js) | 关卡武器作用域、准备句柄、共享模板／皮肤／音频缓存及视觉实例记录 | load 只预热；WeaponViewModel 在 motion 调用 instantiate | 由 RangeRoomLevel 释放；先停声音／销毁实例，再卸载共享资源；异步回调不能直接装备 |
| [WeaponViewModel](../src/game/weapons/weapon-viewmodel.js) | active／staged 两个视觉槽、anchor、动画播放器使用权、待展示事实和枪口闪光 | receive 收事实／启动预热；motion 准备实例并按展示时间消费事件 | 借用 RenderSystem 的 layer；交接到时才释放旧实例；动画不决定玩法动作时刻 |
| [AnimationPlayer](../src/engine/runtime/function/animation/animation-player.js) | 每实例 Mixer、播放代次、混合层与稀疏属性覆盖 | 由拥有者显式调用 advance，不自带时钟 | 武器由 motion 驱动；机器人权威／可见播放器分别由固定时间／P 驱动，骨架独立；dispose 清播放器，不销毁共享模型资源 |
| [WeaponAudio](../src/game/weapons/weapon-audio.js) | 武器事实队列、动作／cue 游标与声音 owner 标识 | motion 消费已展示事实并提交 cue | 将玩法翻译成通用音频请求；重置／销毁只失效自己的声音，不关闭 AudioContext |
| [ShotEffects](../src/game/weapons/shot-effects.js) | 命中表面到粒子参数的玩法预设 | receive 将已接受射击转换为带 born 时间的粒子 | 不自建时钟；当前 PresentationReset／dispose 会 clear 注入的整个粒子服务，见下方范围说明 |
| [ShotTargets](../src/game/targets/shot-targets.js) | Level 本地目标／注册代次、活跃 source 的射击游标、当前整发查询身份 | postPhysics 准备姿态／查询；resolveShot 全发预校验后同步提交 | 不持有伤害表或挑战进度；注册失效与 source close 不允许旧命中复活；结果返回后才通知挑战 |
| [TrainingBot](../src/game/targets/training-bot.js)／[TargetCombat](../src/game/targets/target-combat.js) | 出靶属性／资格、独立权威与可见骨架、命中盒及 P 反馈事实 | fixed 幂等采样权威姿态；整发提交 damage；motion 消费 P | 默认三只自由练习展示仍为非致死反馈；activateSpawn 才启用独立生命；模型实例归 Mesh，权威骨架归组件，共享模板归 Level |
| [CombatAttributes](../src/game/combat/attributes.js) | 单个对象的生命／护甲与上限 | TargetCombat 在整发预校验后逐弹丸同步调用 | 无注册或时钟，不自做去重，见[模型契约](combat/attributes.md) |
| [ChallengeSession](../src/game/range-room/challenges/challenge-session.js)／[RangeChallengeComponent](../src/game/range-room/challenges/range-challenge.js) | 纯会话规则；关卡适配的网格、保护与目标池借用句柄、P 历史 | 适配者 fixed 处理截止／释放；onShotResolved 批量计分／补位；motion 采样 | 阶段三仅逻辑／夹具接线，尚未装配到 RangeRoomLevel；目标 GO 不转移所有权，无全局 System，见[阶段三记录](superpowers/plans/2026-11-17-range-rules-phase-three.md) |
| [UI host](../src/app/ui-host.js) | 本关卡 HUD／调试／模态层、模态栈、焦点返回及 Tab 循环 | canvas、已有调试容器 | app `levelTools` 挂载／卸载；顶层窗口先处理关闭，释放后还原借用的调试容器 |
| [UI input](../src/app/ui-input.js) | 输入归属、暂停原因、捕获请求状态 | Input、Player、Engine、UI host | 监听真实 Pointer Lock／焦点／可见性；不拥有独立帧循环或游戏时钟 |
| [Weapon HUD](../src/app/weapon-hud.js) | 当前关卡的 DOM、监听与显示配置 | Engine frame 后读取 `PlayerComponent.readHud()`／`WeaponViewModel.readHud()` | app 挂载／卸载；不读完整诊断快照，按字段变化写入，不拿最新模拟弹药提前显示 |
| [Look settings](../src/game/player/look-settings.js) | 玩家灵敏度、待提交值及 revision | 初始配置 | request 校验并合并意图，Player 在有效 postPhysics 提交；app 仅负责本地保存适配 |
| [PracticeArmory](../src/game/weapons/practice-armory.js) | 选择请求 scope／request、静态持有目录、逻辑完成与展示确认状态 | 已有 EquipmentController 固定快照及视模窄读模型、游戏侧访问条件 | PlayerWeapons 在固定步前验证并排队，在固定步后接收结果；重生／Editor／卸载失效，不持有 DOM 或资源 Promise |
| [Weapon shop](../src/app/weapon-shop.js) | 候选、分类卡片、详情、焦点与只在打开时的 frame 订阅 | `readArmory()` 与 `requestArmorySelection()` | 点击仅发选择意图；选中不等于装备，关窗不撤销已接受请求，不读取完整诊断 |

当前粒子服务由 RuntimeContext 持有，但 ImpactEffects 使用全量 clear。这是**当前单玩家效果生产者的约定**，不是通用多来源作用域隔离。增加其他效果生产者前，应引入 owner／scope 的取消边界，不能继续让任一生产者清空所有效果。本次只记录此边界，不改现有粒子实现。

## 相机控制权不是相机所有权

- **资源所有权：**RuntimeContext 创建共享世界相机，RenderSystem 使用它；独立视模 Scene、Camera 和 pass 归 RenderSystem。
- **玩家输出权：**CameraComponent 借用世界相机，在 presentation 采样 AimState 写位置、旋转和 FOV；不重复计算武器后坐力。
- **观察输出权：**Editor CameraControls 在 fly／orbit 模式修改共享相机。app 的[模式适配](../src/app/bootstrap.js)负责交接；player 模式关闭观察控制，观察模式禁用 Player 的 Motor／Camera。
- **投影与尺寸：**关卡初始化参考机位，RenderSystem 管理 resize；玩家 ADS 的 FOV 来自 AimState。销毁 CameraComponent 不销毁共享相机。

若将来提取 CameraSystem，首先迁移“控制权选择与最终输出”的职责，确保每个模式只有一个姿态写入者；不要在已有写入者旁再加一次相机更新，也不要让 runtime 导入 Editor 或武器规则。

## 每帧唯一时间线

```text
Engine.step(nowMs)
  Time.tick(nowMs)
  logicalTick
    input 事件：app 接入 Editor
    所有 GO 的 input
    对每个计划固定步：
      所有 GO 的 fixed
      所有 GO 的 postPhysics
      Time.completeFixedStep
    所有 GO 的 motion
    所有 GO 的 presentation
    AudioSystem.flush(time, 最终世界相机位姿)
    Particles.flush(time)
  RenderSystem.swapLogicRenderData
  rendererTick：绘制，不推进玩法／声音／粒子
  frame 事件：HUD 和工具读取已完成状态
```

- 固定阶段使用 `fixedTick / fixedElapsed / fixedDelta`；input 只收集，不因一帧多个固定步重复消费鼠标增量。
- 公共展示时间为 `P = max(0, C - h + alpha * h)`。相机、视模、HUD 和声画效果使用同一 P，不直接把最新模拟状态当成已展示状态。
- 粒子可提前写入带 born 的数据，flush 按 P 采样；Web Audio 自己的设备时钟由 AudioSystem 映射，不构成第二条游戏时间轴。
- 出靶生命／护甲在整发全部目标预校验后于固定步提交；动画或 HUD 不再扣一次。CombatAttributes 本身不校验 tick，注册表、目标生命计划与挑战各自维护射击／出靶／计分的去重边界。
- `PlayerWeapons.fixed()` 冻结整发姿态与身份，查完全部 pellets 后调用 `ShotTargets.resolveShot()`，返回后才同步调用注入的 `onShotResolved(result, context)`。不从 app frame 轮询，不在逐弹丸扣血里补刷；模式一截止由 fixed 先于玩家 postPhysics 处理。
- 命中捕获注册代次与 `sessionId / spawnId / cellId`；合法面板命令消费整发；伤害逐弹丸累计，普通反馈每个存活目标合并一次，致死不再启动普通受击。旧 `ShotTargets.react()` 已移除。
- `TargetPoses` 的骨架／播放器彼此独立，P 只消费已提交事实。激活挑战出靶后关闭 Mesh 的常规姿态同步，由 P 事实控制可见放置；击杀事实拷贝原姿态与 Transform，后续 VFX 不得再借用新靶位置。

## 应用 UI 与输入交接

- `InputSystem.enabled` 仍表示玩法生命周期。`blocked` 是独立的输入归属门：app 仅在真实持有画布 Pointer Lock、窗口可交互、无模态且未暂停时放行，不能仅靠画布聚焦放行。
- 菜单调用 `PlayerComponent.setInputBlocked()`，清除移动／跳跃／视角及未提交的物理输入，不调用 Editor 的 `setEnabled(false)`。`EquipmentController.clearInput()` 只移除标记为 `source: input` 的排队命令；已接受的换弹／装备事务、准备回复和 UI 命令保留，下一固定步归零持续开火。
- F3 不暂停模拟。Esc 先关闭顶层模态，再次 Esc 才暂停；解锁失败保持隔离。窗口失焦／后台通过已有 `Engine.pause()` 冻结时钟，回焦不恢复，必须点「继续」且实际捕获成功。应用设置 `autoPauseOnHidden: false`，通用 RuntimeContext／Engine 的原默认行为不变。
- 灵敏度默认 0.4，范围 `[0.01, 5]`，细／粗步长 0.01／0.1。UI 显示待提交与有效值，只有有效提交值保存至 `mc-valorant.mouse-sensitivity.v1`；无效数据／存储失败不阻塞玩法。
- 模式／难度／数量／护甲仍是明确标注的下一局预选，不冒充挑战、伤害或无限备用弹药已经接入。B 已接入七槽位免费选择商店，选枪后保持打开；挑战运行中 F3 只读／取消仍待真实会话接入，见[阶段二实施记录](superpowers/plans/2026-11-17-range-armory-phase-two.md)。
- 商店请求带 `scopeId / requestId / slotId`，进入 `PlayerWeapons` 固定步后再次校验访问条件。重复／旧 scope 被拒绝，新选择替代旧请求，准备失败保留原枪并可重试；重生、Editor、卸载使旧请求失效，关闭窗口不使已接受选择失效。
- `setArmoryAccess(check)` 仍是游戏侧接入点。ChallengeSession／逻辑适配已实施，但尚未装配真实场景；运行中商店／F3 条件仍待关卡连接。开局门槛使用 `canStartChallenge()`，只依赖权威装备／准备／排队状态，**不依赖 P 或模态可见性**。权威完成而尚待 P 的选择不能被后续条件倒查为失败。
- 核心 `ammoPolicy` 显式区分 `finite`（默认）与 `infinite-reserve`；后者仍消耗弹匣、等待手动换弹与唯一 feed 提交，库存不使用 Infinity。政策随武器事实进入 P 的 HUD 字段。当前关卡未启用后者，UI 不冒充已经启用。
- `PlayerComponent.onLifecycle` 的注入回调先于实际重生／武器 reset 及停用／suspend；菜单输入隔离不触发该通知。真实挑战的重生／Editor／卸载取消仍由后续关卡装配连接。

## 暂停、挂起、重置、销毁

| 操作 | 时间与对象 | 武器与异步工作 | 属性模型 |
| --- | --- | --- | --- |
| Engine.pause | 停止 RAF，恢复重置帧 delta | 冻结动作与展示，音频处理暂停边界 | 不自动修改 |
| timeScale = 0 | 没有固定步；Editor 仍可读 rawDelta | 清动作输入，不推进装备事务／展示时间 | 无固定结算，不自动修改 |
| 玩家 → Editor | 全局仍可运行，玩家组件禁用 | suspend 失效旧 epoch、隐藏视模，保留已提交装备；返回时重新准备 | 本次未装配，不自动修改 |
| 重生请求 | input／UI 排队，下个实际 postPhysics 执行 | reset 恢复初始背包，使旧工作失效 | 本次未接入 Home；未来由拥有者显式调用 reset |
| 卸载／关闭 | 先停调用，再释放拥有资源 | 失效准备和声音，实例先于共享模板释放 | 仅普通数据，无 dispose；拥有者移除引用即可 |

### 释放顺序

1. Engine 停止帧驱动，失效运行中的声音；app 先卸下 HUD、工具和诊断监听。
2. WorldManager 卸载 Level。RangeRoomLevel 先取消加载、还原阴影／探针材质绑定。
3. Level 逆序移除 GO；GO 逆序释放组件。玩家释放 PlayerWeapons；机器人注销目标、停播放器；Mesh 释放各自实例。
4. Level 清理武器、机器人等共享模板与关卡资源。WeaponAssets 自身也兜底释放尚存实例。
5. RuntimeContext 继续逆序释放 Physics、Input、Particles、Audio、Render、ResourceManager、Size。

迟到的 Promise 不能恢复已卸载对象；关闭后的准备票据／句柄不可重新挂载。借用的 camera、共享纹理和运行时音频服务不能由某把枪或某个角色单独释放。

## 改动时检查什么

- 调度／生命周期：`tests/runtime.test.mjs`、`tests/framework.test.mjs`。
- 相机／玩家：`tests/camera.test.mjs`、`tests/player.test.mjs`。
- 武器事实与表现：`tests/player-weapons.test.mjs`、`tests/weapon-viewmodel.test.mjs`。
- 目标注册／受击／整发：`tests/range-training-bot.test.mjs`、`tests/shot-resolution.test.mjs`。
- 通用服务：`tests/audio.test.mjs`、`tests/particle-system.test.mjs`。
- 属性与伤害：`tests/combat-attributes.test.mjs`。
- 挑战规则／网格／适配：`tests/range-challenge-rules.test.mjs`、`tests/range-challenge-integration.test.mjs`；这些不代替实际场景容量与可玩挑战验收。
- 新依赖边界：`tests/architecture.test.mjs`。

按改动范围选择检查；这份清单不是要求每次改动运行全量浏览器、资产导出或 Blender 验证。
