# 运行时架构

参考 [Piccolo runtime](https://github.com/BoomingTech/Piccolo/tree/main/engine/source/runtime)，采用实例化 Context、明确的逻辑／渲染 tick 和关卡／对象生命周期。当前更新契约见[阶段优先组件 Tick](superpowers/specs/2026-11-11-phase-first-component-tick.md)；function 目录依据[结构重构记录](superpowers/specs/2026-11-11-function-layer-layout.md)；对象组合粒度依据[组件化消融 Spec](superpowers/specs/2026-11-10-component-based-game-objects.md)；第一轮分层决策见[重构 Spec](superpowers/specs/2026-11-10-piccolo-runtime-architecture.md)。

## 目录与职责

```text
src/
├─ main.js                         启动应用、错误提示、HMR
├─ app/
│  ├─ bootstrap.js                 选择关卡、连接游戏与工具、相机模式适配
│  ├─ config.js                    URL 参数与玩法键位接线
│  ├─ diagnostics.js               __RANGE_ROOM__ 兼容诊断接口
│  ├─ weapon-hud.js                消费表现时间的武器、弹药与准星 UI
│  └─ style.css
├─ configs/
│  └─ input-bindings.js             练枪房玩法键位，由 app 注入 runtime
├─ engine/
│  ├─ runtime/
│  │  ├─ engine.js                 帧循环、启停、logicalTick / rendererTick
│  │  ├─ index.js                  运行时入口
│  │  ├─ core/
│  │  │  ├─ events.js
│  │  │  ├─ disposer.js            通用 LIFO 清理
│  │  │  └─ time.js                时间缩放、固定步累积、插值系数
│  │  ├─ platform/
│  │  │  ├─ frame-driver.js        RAF 与页面可见性
│  │  │  └─ size.js                浏览器视口尺寸
│  │  ├─ resource/
│  │  │  ├─ index.js
│  │  │  ├─ resource-manager.js    加载、缓存、实例化、取消与释放
│  │  │  ├─ dispose-object3d.js    拥有资源的 Three.js 树释放
│  │  │  └─ loader/               GLTF、EXR、Worker 与 mip 解码
│  │  └─ function/
│  │     ├─ animation/            ClipLibrary、播放代次、混合与 marker；游戏无关
│  │     ├─ character/            普通角色运动规则与形状计算
│  │     ├─ controller/           运动学扫掠、台阶与贴地解算
│  │     ├─ framework/            component / level / object / world
│  │     ├─ global/               RuntimeContext：系统装配与生命周期
│  │     ├─ input/                通用动作状态、Pointer Lock 与鼠标增量
│  │     ├─ physics/              同步碰撞服务与碰撞世界
│  │     └─ render/               渲染系统、管线、passes、material、debugdraw
│  └─ editor/
│     ├─ editor.js                观察工具、面板与辅助线的生命周期
│     ├─ camera-controls.js        自由／轨道观察与相机控制权
│     └─ panels/                  渲染、探针、观察 HUD
└─ game/
   ├─ player/
   │  ├─ config.js                玩家移动与视角参数
   │  ├─ aim-state.js             固定步瞄准、眼位、后坐力与表现历史
   │  └─ player.js                玩家装配、PlayerComponent（输入／姿态目标／出生规则）
   ├─ weapons/                    定义、背包、装备规则、关卡资源与第一人称表现
   └─ range-room/
      ├─ level.js                 RangeRoomLevel：关卡加载与对象组装
      ├─ config.js                资源地址、茶壶与灯光配置
      ├─ collision.js             碰撞数据、出生与越界规则
      ├─ ground.js                Minecraft 地面
      ├─ floating-teapot.js       茶壶资源、组件装配、普通运动函数
      ├─ assets/                  manifest、材质绑定、资产实例
      └─ lighting/                房间灯光、阴影、探针
```

### function 层目录

```text
function/
├─ animation/
│  ├─ clip-library.js                     动作语义、轨道绑定与 marker 校验
│  ├─ animation-player.js                 Mixer 实例、播放代次、混合与表现事件
│  ├─ animation-state-machine.js          小型语义状态转接
│  └─ index.js
├─ character/
│  └─ character-motion.js                  characterMotion / characterBox
├─ controller/
│  └─ character-controller.js              moveAABB：扫掠、台阶、贴地
├─ framework/
│  ├─ component/
│  │  ├─ component.js                     组件基类
│  │  ├─ tick-phases.js                   阶段声明校验、只读 TickContext
│  │  ├─ camera/camera-component.js       注入姿态采样／独立跟随与相机输出
│  │  ├─ mesh/mesh-component.js
│  │  ├─ motor/motor-component.js
│  │  └─ transform/transform-component.js
│  ├─ level/level.js                      对象所有权、阶段扫描与组件快照
│  ├─ object/game-object.js               组件装配、直接依赖与释放
│  ├─ world/world-manager.js              关卡加载、取消、卸载
│  └─ index.js                            对外导出框架与通用组件
├─ global/
│  └─ runtime-context.js                  应用级实例装配根
├─ input/
│  └─ input-system.js
├─ physics/
│  ├─ collision-world.js                  空间查询与碰撞盒集合
│  ├─ physics-system.js                   查询／运动解算服务、计时
│  └─ index.js
└─ render/
   ├─ render-system.js                    renderer 生命周期、resize、配置入口
   ├─ render-pipeline.js                  pass 编排与输出连接
   ├─ render-config.js                    默认渲染配置与校验
   ├─ render-profiler.js                  CPU 统计、GPU pass 计时
   ├─ color-grading.js                    LUT 数据生成、导入与释放
   ├─ sky-environment.js                  天空环境代理
   ├─ debugdraw/collision-debug.js        碰撞辅助线几何绘制
   ├─ material/
   │  ├─ gradient-material.js
   │  ├─ pixel-art-sampling.js
   │  └─ texture-sampling.js
   ├─ passes/
   │  ├─ ao-upsample.js
   │  ├─ normal-prepass.js
   │  └─ viewmodel-pass.js                独立视模 Scene、Camera、深度与 HDR pass
   └─ index.js
```

组件集中在 framework，表达“GO 可组合的能力”；character / controller / physics / render 提供对应领域的规则、算法和服务。PlayerComponent 是游戏侧控制行为，位于 `game/player/player.js`。`color-grading.js` 负责 LUT 资源，实际 LUT pass 由 render-pipeline 连接。

## 依赖方向

```text
app ──→ game ──→ runtime
 └────→ editor ──→ runtime

function/global/runtime-context → Engine / 功能系统 / 资源 / 平台
function → resource / platform / core
resource → platform / core
platform → core
```

runtime 不导入 app、game、editor；game 与 editor 互不导入。只有 app 知道当前关卡与工具的具体组合。核心系统通过构造器／工厂获得窄依赖，例如 RenderSystem 接收 `size` 而非整个 Engine。

玩法键位位于 `src/configs/input-bindings.js`，由 `readAppConfig()` 经 app 和 RuntimeContext 注入 InputSystem；runtime 不导入这份配置。`createInputSystem({ element, bindings })` 省略 bindings 时不绑定动作，动作名可自定义。输入系统提供 `isDown(action)`、`consumePressed(action)`、`consumeReleased(action)`、`consumePressedEvents()`、`consumeLook()` 和 `clear()`，支持键盘、MouseN 和滚轮；玩法映射仍由 Player / PlayerWeapons 完成。有序边沿与单动作消费共享一条队列，已消费的记录不会再次返回。同动作多键独立保持；滚轮只产生边沿，不产生 held。鼠标按钮与滚轮仅在启用且 Pointer Lock 生效时接收，首次点击只捕获鼠标。失焦、解锁、禁用和隐藏页面清空输入；`clear()` 不改变启用或锁定状态。

默认移动为 WASD、Shift、C、空格；左键射击、右键 Phantom ADS、R 换弹、T 检视、1 主武器、2 副武器、Q 上一把、滚轮切枪。Home 回出生点属于游戏输入，关闭 Editor 后仍可用。玩家复位按钮通过 `Player.requestRespawn()` 排队，和 Home 一起在下一实际 postPhysics 固定步提交；暂停以及恢复首帧零步都不会提前修改模拟。飞行／轨道观察相机复位仍由 Editor 处理。完整操作见[武器玩法](weapons/gameplay.md)。

Context 每个应用实例独立持有。业务代码不使用全局服务查找；`__RANGE_ROOM__` 仅由 app 安装供诊断与浏览器测试使用。

`global/` 是装配根：创建 Engine 和各服务，再显式注入。功能模块通过参数获得服务；架构测试限制反向导入 global。framework 内部组件使用具体相邻模块导入，外部装配使用 `framework/index.js`，避免聚合导出引入循环依赖。

角色移动调用关系：Player 写 command → Motor 调用 characterMotion → PhysicsSystem 调用 controller 的 moveAABB → Motor 提交 Transform。controller 直接依赖 physics/collision-world 的盒子数据和空间查询。

武器玩法位于 `game/weapons`：EquipmentController 私有持有 WeaponInventory，接收普通命令和固定步快照，返回只读事实及资源准备意图；不依赖 Three.js、DOM 或 Promise。PlayerWeapons 连接有序输入、装备裁定、AimState 射击方向与碰撞盒射线，再把事实交给 WeaponViewModel。当前练枪房使用 Classic Smite 与 Phantom Tactiplay，支持切换、射击、换弹打断、检视、ADS 和实例冷却；尚无伤害系统或运行时音频。

WeaponAssets 复用 ResourceManager，在关卡作用域加载发布包，实例独有骨架／材质／AnimationPlayer，共享几何与纹理；退出关卡先销毁实例再卸载模板。异步加载只预热资源，motion 阶段才创建有效票据对应的实例并排队确认，下一固定步裁定装备。WeaponViewModel 拥有最多 active / staged 两个实例，按公共表现时间提交可见枪；RenderSystem 独占独立视模 Scene、Camera 与 pass。function/animation 只管理播放、采样和表现事件，不能决定射速、补弹或装备时机。接口见[武器玩法模块](weapons/gameplay.md)与[发布和播放](weapons/animation-and-assets.md)。

## 每帧调用

```text
浏览器 RAF
  → Engine.step(nowMs)
      → Time.tick(nowMs)
      → logicalTick()
          → input 事件：app 接入 Editor 的观察相机操作
          → world.tickComponents('input', frame)
          → 每个固定步：
              world.tickComponents('fixed', fixedFrame)
              world.tickComponents('postPhysics', fixedFrame)
              Time.completeFixedStep(stepIndex)
          → world.tickComponents('motion', frame)
          → world.tickComponents('presentation', frame)
      → RenderSystem.swapLogicRenderData()
      → rendererTick() → RenderSystem.update(frame)
      → frame 事件：app 接入 HUD 更新
```

关卡分发链是 `WorldManager → Level 扫描所有 GO → 收集本阶段组件快照 → component.tick(context)`。Level 按 GO 插入顺序和 GO 内组件装配顺序扫描，并读取实例的 `component.phases`；执行任何组件回调之前先完成整个阶段的快照。GO 负责组合与生命周期，玩家和茶壶行为由组件执行。context 提供只读的 `phase / delta / time`，固定阶段的 delta 为 fixedDelta，其他阶段为缩放后的帧 delta。

- Engine 显式编排阶段，取消通用 Scheduler、系统名称查找和系统适配器。
- 固定步为 1/60 秒，每帧最多 5 步。fixed 阶段的 Motor 保存位置历史、运行运动函数、同步调用 `physics.move()` 一次并提交 Transform；PhysicsSystem 不再持有 body 回调或自行步进。
- Time 是唯一累加器所有者。先裁剪 rawDelta，再按本帧锁定的 timeScale 缩放；超过五步时只丢完整超额步，保留不足一步的插值余量。
- `fixedTick / fixedElapsed / fixedStepIndex` 标识当前模拟步，fixed 与 postPhysics 共享同一只读快照，两阶段正常完成后提交模拟时钟。其他阶段读取最近完成的模拟编号；`elapsed` 仍是缩放后的帧时间。
- Player 在 input 向 AimState 累积 look，并把待提交的基础 headingYaw 写到 Motor 命令；jump 与重生请求保留到实际固定步。postPhysics 使用解算后的脚位、眼高和台阶位移提交 AimState；眼高平滑、踏步补偿及近裁面安全约束也在固定步计算。
- AimState 拥有基础 yaw / pitch、ADS、散布、逐发后坐力与历史。接受 ShotFired 时先从 preShot 瞄准状态生成权威射线，再加入本发 postShot 后坐力；移动只使用基础 yaw，不受 pitch 或后坐力影响。输入只消费一次，多固定步不重复施加 look。
- 公共表现时间为 `P = max(0, C - h + alpha * h)`，C 为最新已完成 fixedElapsed，h 为 fixedDelta。Time 提供 `presentationTime`；CameraComponent 在 presentation 通过注入的 AimState 采样器写世界相机，WeaponViewModel 在 motion 消费不晚于 P 的事件与姿态，HUD 在 frame 读取同一表现快照。表现枪、弹药及后坐力可能落后玩法一个固定步，不直接读最新权威状态冒充当前画面。
- 茶壶 Motor 使用 frame 时钟，在 motion 调用一个普通函数计算环绕、漂浮、自转；暂停即禁用 Motor，Mesh 仍参与 presentation。
- Mesh 消费已完成的 Transform，玩家 Camera 消费已完成的 AimState 历史；视模使用独立场景，不依赖 Camera／Mesh 或 GO 在同阶段的更新顺序。
- `Engine.pause()` 停止整个 RAF；`time.timeScale = 0` 冻结模拟时间，保留 rawDelta 驱动的 Editor 观察操作。Player 清除 held、look 和动作边沿，保留武器事务与剩余时间；恢复不补发暂停期间的开火。
- `rendererTick()` 重复绘制已完成的状态，不推进时间或模拟。正常逐帧入口是 `step()`；同帧重复 logicalTick、递归 step／阶段分发以及绘制未完成的逻辑帧均抛错。异常帧不提交后续阶段、不交换、不渲染，也不能重放已开始的逻辑。
- 世界场景与相机直接共享。`swapLogicRenderData()` 标出逻辑与绘制之间的数据边界，函数体为空。视模使用独立深度与透明 HDR pass，和世界 HDR 合成后共同经过 tone mapping、SMAA、sRGB 与 LUT；世界深度不会裁掉贴墙的枪身。Three.js / WebGPU 承担实际裁剪、绘制与浏览器呈现。

## 对象与组件

```text
房间／地面 = Transform + Mesh
茶壶      = Transform + Mesh + Motor(frame, 茶壶运动函数)
玩家      = Transform + Motor(fixed, characterMotion) + Camera + Player
```

通用组件为 Transform、Mesh、Motor、Camera，游戏组件为 Player。灯光、碰撞数据、阴影及探针归 Level；Player 负责输入映射、站蹲目标、出生规则及 AimState / PlayerWeapons 的更新与销毁。Camera 负责把注入的姿态发布到渲染相机，茶壶动作使用普通函数。Camera 最初提取过程见 [Piccolo CameraComponent 对照记录](superpowers/specs/2026-11-11-camera-component.md)；其中旧玩家视角职责已由本文的固定步 AimState 替代。

`GameObject` 的 id 独立于渲染节点，不自动建立空 Group。每个具体组件类型最多一份。`mobility: 'static' | 'dynamic'` 描述空间运动属性，静态对象也可执行行为。

- Transform 拥有世界 position / quaternion / scale 和 previousPosition；`samplePosition(alpha, target)` 只采样，`teleport(position)` 同时重置历史。固定步 Motor 启用位置插值，帧 Motor 使用当前姿态。
- Mesh 持有模型树，presentation 将 Transform 写入根节点，保留子节点局部姿态。实例通过传入的 `release` 释放，共享模板仍归 ResourceManager。
- Motor 接收 `motion(motor, delta)`；普通函数返回目标 position / quaternion 或 displacement，带 box 时同步解算碰撞。速度、grounded / crouched、command、elapsed 归 Motor。
- Camera 只依赖同 GO 的 Transform，构造时注入共享渲染 camera，可独立于 Player／Motor／输入设备装配。玩家注入 `sampleViewPose(at)`，Camera 直接发布其中位置、quaternion 和 FOV，不再叠加自身 look 或平滑。独立装配且未注入采样器时，仍支持弧度 `look(deltaYaw, deltaPitch)`、世界 Y 跟随目标 `verticalOffset`、rawDelta 指数平滑和 `reset()`；该路径不参与玩家权威瞄准。
- `static requires` 声明同 GO 直接依赖，依赖先装配；实例 `phases` 声明更新阶段，未知／重复阶段在挂接副作用之前被拒绝。组件统一使用同步的 `onAttach / tick(context) / dispose`。onAttach 在加入 Level 时执行，活动 GO 新增组件立即挂接。
- 缺少依赖、共享同一实例、重复类型、移除被依赖组件均报错；挂接失败回滚，销毁按装配逆序且幂等。
- Level 直接扫描 `objects.values()` 和 `object.components`。整阶段快照保证新增从下一匹配阶段生效，可能是同帧的后续阶段或下一固定子步；移除立即阻止尚未执行的调用，enabled／active 按调用时的当前值判断。阶段间表达数据依赖，同阶段不依赖其他对象／组件恰好先更新。

例如：

```js
const object = new GameObject({ name: 'Moving prop' })
object.addComponent(new TransformComponent())
object.addComponent(new MeshComponent({ root: mesh, scene, release }))
object.addComponent(new MotorComponent({
  clock: 'frame',
  motion: (_motor, delta) => ({ displacement: [delta, 0, 0] }),
}))
level.addObject(object)
```

## 初始化、切换与销毁

初始化：

1. Context 创建 Size、资源管理、Scene、Camera，并等待 RenderSystem 完成异步初始化。
2. 创建 Input、Physics、WorldManager 和 Engine，显式连接依赖。
3. app 传入同步关卡工厂；WorldManager 等待 `level.load({ signal, onProgress })`。
4. 关卡完成房间、地面、可选探针、碰撞、初始 Classic 共享资源预热、玩家与茶壶装配后，才成为 activeLevel；不等待依赖 motion / fixed 的视觉准备与掏枪结束。
5. WorldManager 发出 `load`，app 挂载当前关卡的工具与诊断；最后启动 Engine。

关卡卸载：WorldManager 先清除活动引用并取消加载，发出 `unload` 让 app 释放当前工具与诊断，然后释放 Level。`await world.unloadLevel()` 会等待被取消的关卡加载 Promise 收尾；此期间拒绝新的加载。再次 load 会重新绑定工具，不复用旧玩家或监听器。

资源加载接受 `resources.load(entries, { signal })`。signal 中止、`unload(name)` 或 ResourceManager 销毁会立即拒绝等待者，并取消该任务的下载／解码，不必等待服务器返回。每个任务独立持有取消控制器；同名资源的并发加载共享任务，因此任一等待者取消都会让该任务的所有等待者收到 `AbortError`。已经缓存的资源仍由关卡显式卸载。取消后允许立即同名重试；不支持取消的扩展加载器若迟到返回，旧任务只释放自己的结果，不影响新缓存。探针捕获的逐帧等待也响应取消，不依赖隐藏页面继续触发 RAF。

整体销毁：停止 Engine → app 工具与诊断 → WorldManager / Level → Physics → Input → RenderSystem → ResourceManager → Size。关卡内部先还原阴影／探针材质绑定，再释放对象与资产。`loadRoomAssets` 完成后解除加载期的 abort 清理监听，把实例释放权交给 Mesh，避免取消先于材质解绑释放资源。`runtime.dispose()` 和既有 `engine.destroy()` 均进入同一幂等关闭流程。Engine 的 destroy 监听器或应用的 dispose 监听器抛错时，仍会完成系统释放并清空监听器；随后抛回单个原始错误，或用 `AggregateError` 报告两个阶段的错误。初始化与回滚同时失败时，也保留两者的错误原因。

Level 以活动对象集合拥有 GO，卸载时按逆装配顺序移除存活对象，然后清理其余关卡共享资源。提前移除的对象不会在 Disposer 中留下逐对象清理闭包。

相机控制权由 app 的 player／fly／orbit 模式交接：`Player.setEnabled()` 同步切换 Motor 与 CameraComponent；Editor 在 player 模式关闭 fly 和 orbit 写入。返回 player 时 Camera 提供当前机位对应的候选身体姿态，Player 检查碰撞后放置或重生。RuntimeContext 拥有共享渲染相机，关卡与 RenderSystem 管理投影参数／尺寸；CameraComponent 的挂接、禁用与销毁均不会写入相机，姿态输出只发生在 presentation。

进入 Editor 时武器立即使旧 epoch 失效、隐藏视模与 HUD，并按逻辑 activeId 保留已提交枪，即使 P 尚未显示该枪。返回后以新票据确认保留实例并重新掏枪；不再次提交装备。玩家恢复后的首个 postPhysics 将 AimState 历史重锚到 `C - h`，保留该帧新 look，避免把 Editor 期间的全局时间间隔插值成旧姿态。Engine 暂停不推进全局固定时钟，也不走这种重锚。

初始化失败和 HMR 共用上述清理。异步 renderer 或资产在关闭后返回时立即释放，不重新设置 ready 或挂载场景。

## 公共接口

```js
import { RuntimeContext } from './engine/runtime/index.js'
import { GameObject, Component, Level, TransformComponent, MotorComponent, MeshComponent } from './engine/runtime/function/framework/index.js'
import { characterMotion } from './engine/runtime/function/character/character-motion.js'
import { moveAABB } from './engine/runtime/function/controller/character-controller.js'
import { createInputSystem } from './engine/runtime/function/input/input-system.js'
import { ResourceManager } from './engine/runtime/resource/index.js'
import { createPhysicsSystem } from './engine/runtime/function/physics/index.js'
import { createRenderSystem } from './engine/runtime/function/render/index.js'
```

`RuntimeContext` 从 runtime 公共入口导出，实现在 `function/global/runtime-context.js`。`createRenderSystem({ size, canvas, scene, camera, config })` 在返回前完成 GPU 与 pipeline 初始化。`physics.move(world, box, displacement, options)` 返回实际位移和接触结果，`physics.overlaps(world, box)` 查询占用，`lastStepMs` 提供最近一次位移解算耗时。`moveAABB` 从 controller 文件导入；physics 公共入口导出碰撞世界、overlaps 和 PhysicsSystem。

`?editor=0` 可验证无工具 UI 的关卡运行。既有 URL 参数及 `__RANGE_ROOM__.world / inspection / render / snapshot()` 由 app 适配；`inspection.player` 为 PlayerComponent，`inspection.teapot` 为 app 的组件命令／快照视图，继续提供 mesh、setPaused 和 snapshot。运动只通过 `runtime.world.tickComponents()` / Engine 调度；诊断接口没有独立 update。

`__RANGE_ROOM__.snapshot().time` 提供 frame、固定步计划／完成数、fixedTick、fixedElapsed、alpha、presentationTime 和本帧 droppedSimulationTime。`engine.time.snapshot()` 返回只读标量；时间缩放使用 `engine.time.timeScale = value` 设置，在下一帧锁定生效。fixedDelta 为构造期只读参数。`snapshot().player.weapons` 同时暴露逻辑装备与 `view` 表现快照，诊断时应区分两者的时间。

## 验证

- `tests/architecture.test.mjs`：引用有效、单向依赖、无循环、公共 API 可在 Node 导入。
- `tests/input.test.mjs` / `tests/app-config.test.mjs`：玩法键位注入、自定义／空映射、有序动作边沿、鼠标按钮与滚轮、锁定门控、clear 和同动作多键保持；runtime 测试验证映射传给输入工厂。
- `tests/runtime.test.mjs`：帧顺序、子步快照、重复／递归更新防护、失败帧、暂停、初始化失败、关卡取消／重载、工具卸载顺序，以及销毁监听器抛错后的资源释放和幂等性。
- `tests/resource-loading.test.mjs`：各资源类型的真实 HTTP 取消、响应体中途取消、关卡立即重载、GLTF 外部依赖重试、迟到结果释放、共享任务取消、图像解码兼容和隐藏页面的 RAF 取消。
- `tests/time.test.mjs`：限步余量、时间缩放、模拟编号提交、无效配置、60 Hz 浮点边界。
- `tests/framework.test.mjs`：阶段扫描 GO、完整阶段快照、增删／停用、阶段声明、依赖／挂接回滚、Transform 插值、Mesh 资源归属。
- `tests/camera.test.mjs`：独立装配、视角／身体分离、位置采样、rawDelta 平滑、注入姿态采样、重置、控制权与共享输出生命周期。
- `tests/player.test.mjs` / `tests/aim-state.test.mjs`：真实 Time 下的玩家运动、一次消费 look、固定步眼位／瞄准历史、台阶与近裁面安全、重生、Editor 间隔重锚与暂停；后坐力及射击方向在不同帧率下保持一致。
- `tests/player-input.test.mjs`：真实输入系统与 Player 集成，无 Editor 的 Home 重生、暂停命令排队、恢复零步保留及下个固定步单次执行、禁用清队列。
- `tests/player-weapons.test.mjs` / `tests/weapon-viewmodel.test.mjs`：异步准备、固定裁定与 P 交接、两实例上限、Editor 保留逻辑枪、暂停／重生使旧票据失效。
- 武器定义、切换时序、资源与动画专项见[玩法测试](weapons/gameplay.md#验证与剩余范围)及[发布和播放验证](weapons/animation-and-assets.md)。`tests/viewmodel-pass.test.mjs` 覆盖渲染状态恢复，pipeline 浏览器用例覆盖视模 pass 的合成和配置重建。
- `tests/motion.test.mjs`：玩家／茶壶共享 Motor，0/1/5 固定步只解算对应次数，跨 GO 阶段屏障，零步 jump 排队，独立渲染／暂停与无 Player 的命令驱动。
- `tools/check-runtime-browser.mjs`：真实关卡有／无 Editor 重载、输入、销毁、独立渲染与法线预通道。
- `tools/check-weapon-gameplay-browser.mjs`：主游戏可信鼠标／键盘输入、切枪与打断、自动射速、ADS、公共 P、Editor、暂停、重生和释放。命令与报告目录见 [tools](../tools/README.md)；资源预览独立使用 `check-weapons-browser.mjs`。
- 原有玩家、观察、探针、材质与渲染回归使用真实组件调度。碰撞盒为用户确认的 399，进入本次组件化前已修正断言并达到 89/89 基线。

## 历史验收记录

以下保留各次实施时的范围与结果；阶段中的组件职责、键位和测试数量不是当前接口，现行行为以上文及武器专题为准。

### 2026-11-10 实施验收

第一轮运行时分层与碰撞数量修正后为 89/89；本轮组件化验证记录如下。

| 检查 | 结果 |
| --- | --- |
| `npx eslint src tests tools eslint.config.js` | 0 错误，6 项既有 JSDoc 警告 |
| `npm test` / `node --test --test-reporter=dot tests/*.test.mjs` | 最终 95/95 通过，包含组件组合、类型批次、共享 Motor、原行为数值及资源归属检查 |
| Vite 生产构建 | 通过，输出到 `D:/opencode-temp/opencode/mc-valorant-component-build` |
| `npm run validate:room` | 通过，6 张 atlas、200 个 primitive 的资产绑定有效 |
| 浏览器 inspection / player / runtime / probes | 四套最终均 `passed: true`、`errors: []` |
| 文档链接／代码围栏、`git diff --check` | 通过 |

本轮还修正了测试夹具“设备上限为 8、期望值为 16”的不一致，分别检查默认 16× 与设备上限 8× 的行为。

浏览器证据：有／无 Editor 各两次重载均为 4 个 GO，场景子节点稳定为 7 / 6，卸载及销毁后场景、HUD、诊断清空。玩家跳高为 1.099972 m；茶壶阴影像素差为 0.22052。探针开关不改变烘焙像素（差值 0），实时表面差值 0.118164；重复捕获数据差异为 0，纹理数保持 193，捕获及 GPU 上传失败均正确回滚。

probes 首轮在 GLB 下载时出现 `net::ERR_ABORTED`，未进入功能断言；独立复跑前确认模型 HTTP 200、5,049,560 字节，复跑全套断言通过。未为此修改资源加载算法。

本轮报告和截图目录：`D:/opencode-temp/opencode/mc-valorant-component-browser/`。

### 2026-11-11 function 结构验收

迁移 15 个实现文件，形成 character / controller / framework / global / input / physics / render 七个职责目录。源码、测试及公共导出的引用已同步。

| 检查 | 结果 |
| --- | --- |
| `npm test` | 95/95 通过，覆盖路径解析、依赖方向、无环、组件批次、角色运动和生命周期 |
| `npx eslint src tests tools eslint.config.js` | 0 错误，6 项既有 JSDoc 警告 |
| Vite 生产构建 | 通过，输出到 `D:/opencode-temp/opencode/mc-valorant-function-layout-build` |
| 浏览器 inspection / player / runtime / probes | 四套均 `passed: true`、`errors: []` |

有／无 Editor 各两次重载均稳定为 4 个 GO、7 / 6 个场景子节点；卸载与销毁清空场景和工具。浏览器还覆盖玩家移动／碰撞／跳跃、茶壶阴影像素、独立渲染、法线预通道及探针捕获／上传失败回滚。探针重复捕获的数据差异为 0，纹理数稳定为 193。

报告与截图目录：`D:/opencode-temp/opencode/mc-valorant-function-layout-browser/`。

### 2026-11-11 阶段优先 Tick 验收

根据用户确认，Level 改为每阶段扫描 GO 并收集匹配组件快照。阶段边界组织数据依赖，GO 只管理组合与生命周期。实现细节见[阶段优先组件 Tick](superpowers/specs/2026-11-11-phase-first-component-tick.md)。

| 检查 | 结果 |
| --- | --- |
| `npm test` | 107/107 通过，新增阶段扫描、跨 GO 屏障、阶段校验、子步时钟、重入／重复更新、失败帧与限步余量检查 |
| `npx eslint src tests tools eslint.config.js` | 0 错误，6 项既有 JSDoc 警告 |
| Vite 生产构建 | 通过，输出 `D:/opencode-temp/opencode/mc-valorant-phase-tick-build/` |
| `npm run validate:room` | 通过，6 张 atlas、200 个 primitive 的绑定有效 |
| 浏览器 runtime／player／inspection | 三套均 `passed: true`、`errors: []` |

有／无 Editor 各两次重载均保持 4 个 GO、7／6 个场景子节点，关闭时清空场景与工具。重复 logicalTick 被拒绝；独立渲染不推进玩家或茶壶时钟。玩家跳高 1.099972 m；茶壶阴影像素差 0.209656。报告和截图位于 `D:/opencode-temp/opencode/mc-valorant-phase-tick-browser/`。

### 2026-11-11 CameraComponent 验收

参照 Piccolo 第一人称相机职责，将视角状态、眼高平滑与表现输出移入 `framework/component/camera/camera-component.js`。玩家装配为 Transform + Motor + Camera + Player；Player 参与 input／postPhysics，Camera 参与 presentation。详见 [CameraComponent 实现记录](superpowers/specs/2026-11-11-camera-component.md)。

- 单元／架构测试：115/115 通过，新增独立相机和玩家集成的 8 个测试。
- ESLint：0 错误、6 项既有 JSDoc 警告；Vite 构建通过（97 个模块）。
- runtime／player／inspection 浏览器回归均 `passed: true`、`errors: []`。
- runtime 在有／无 Editor 下各两次重载，验证 CameraComponent 独立销毁、共享输出复用、player／fly／orbit 控制权交接、投影参数与重复渲染隔离。

报告与截图：`D:/opencode-temp/opencode/mc-valorant-camera-component-browser/`；构建输出：`D:/opencode-temp/opencode/mc-valorant-camera-component-build/`。

### 2026-11-11 提交前集成验收

按暂存区导出独立快照验证基线修正、运行时重构和新增浏览器回归，避免工作区的后续改动掩盖中间提交缺失的依赖。以上历史阶段记录保持原样；包含玩法键位注入后的当前结果如下。

| 检查 | 结果 |
| --- | --- |
| 仅修正碰撞断言的旧架构快照 | 76/76 测试通过，未包含新路径导入 |
| 运行时／浏览器回归快照的单元与架构测试 | 120/120 通过，包含键位配置、空映射、自定义映射、同动作多键保持及工厂注入 |
| ESLint（src、tests、tools 与配置） | 0 错误，6 项既有 JSDoc 警告；玩家浏览器脚本的格式整理随重构提交，保证中间快照通过检查 |
| Vite 生产构建 | 98 个模块，构建通过；保留大于 500 kB 的 chunk 提示 |
| `npm run validate:room` | 通过，6 张 atlas、200 个 primitive 的绑定有效 |
| player／inspection／runtime／probes 浏览器回归 | 四套最终均 `passed: true`、`errors: []` |

runtime 在有／无 Editor 下各两次重载，均维持 4 个 GO、7／6 个场景子节点，验证相机交接、投影参数不变、重复逻辑更新拒绝及关闭后的清理。玩家跳高为 1.099972 m；茶壶阴影像素差为 0.209778。探针开关对烘焙表面的差值为 0，对实时表面的差值为 0.118652；重复捕获的数据差异为 0，纹理数保持 193，捕获与上传失败回滚均通过。

探针首轮在模型下载阶段出现 `net::ERR_ABORTED`，未进入功能断言；确认模型响应为 HTTP 200、5,049,560 字节后，独立复跑全套通过。保留首轮失败报告和复跑报告，未修改加载逻辑，也未认定请求中断的根因。

快照、构建及报告位于 `D:/opencode-temp/opencode/mc-valorant-commits-5VKSak/`：构建在 `02-runtime/dist/`；玩家与观察报告在 `02-browser-player/`、`02-browser-inspection/`；运行时报告在 `03-browser-runtime/`；探针首轮与复跑报告分别在 `03-browser-probes/`、`03-browser-probes-retry/`。临时快照和浏览器资料不提交到仓库。

### 2026-11-11 架构审查修复验收

完成三项修复：游戏输入独立于 Editor 并在 Tick 消费；资源取消贯穿下载、解码和逐帧等待；销毁监听器异常不阻断系统释放。输入接口改为通用动作，Player 解释移动与重生，资源的同名并发加载采用任务级取消。

| 检查 | 结果 |
| --- | --- |
| `npm test` | 138/138 通过，包含真实 HTTP 取消、旧任务迟到／立即重试、无 Editor 输入、暂停排队和销毁异常 |
| ESLint（src、tests、tools 与配置） | 0 错误，6 项既有 JSDoc 警告 |
| `npm run build` | 99 个模块，构建通过；保留既有大 chunk 提示 |
| `npm run validate:room` | 通过，6 张 atlas、200 个 primitive 的绑定有效 |
| runtime／player／probes 浏览器回归 | 三套最终均 `passed: true`、`errors: []` |

runtime 在有／无 Editor 下各两次重载，确认 R 和玩家复位按钮在暂停时只排队，恢复后单次执行并同步相机。玩家跳高为 1.099972 m。探针重复捕获数据差异为 0，纹理数保持 193，取消捕获及失败回滚通过。

报告与截图位于 `D:/opencode-temp/opencode/architecture-fixes-20261111/` 的 `runtime-final/`、`player/`、`probes/`。首次 runtime 运行被编辑期间的 Vite 热重载打断，保留在 `runtime/`；源码稳定后的完整回归通过。

### 2026-11-11 双枪玩法接线验收

Classic Smite 与 Phantom Tactiplay 已接入主游戏：统一输入、固定步装备与瞄准、延迟事件消费、独立视模 pass、基础 HUD。火/换弹/检视使用装备事实驱动，ADS 可打断射击动画尾段。暂停保留最新选枪意图与 Home 请求，丢弃武器动作及 look；Editor 返回重建视角历史起点。音频和完整伤害系统仍未接入。

| 检查 | 结果 |
| --- | --- |
| Node 单元、架构与资源测试 | 276/276 通过 |
| ESLint（src、tests、武器发布及相关浏览器工具） | 0 错误，5 项既有 JSDoc 警告 |
| Vite 生产构建 | 115 个模块，构建通过；保留既有大 chunk 提示 |
| 主游戏 WebGPU 浏览器 | 双枪切换、半自动/自动开火、换弹/检视打断、ADS、Editor 往返、暂停最新选枪、重生及无 Editor 交互通过，errors=[] |
| runtime / player 浏览器 | 有/无 Editor 各两次重载、资源释放、相机交接、Home 固定提交、移动/碰撞/跳跃通过，errors=[] |

视模真实 GPU 验证还覆盖独立深度、预乘 alpha 合成、AO/SMAA 管线重建及 resize。主游戏报告与截图在 `D:/opencode-temp/opencode/weapon-gameplay-browser/`；重载与移动报告在同级 `runtime-browser/`、`player-browser/`。暂停选枪增强使用最终生产构建复验；开发时热重载中断的运行不计入通过结果。
