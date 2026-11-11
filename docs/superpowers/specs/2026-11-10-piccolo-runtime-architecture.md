# 参考 Piccolo 的运行时架构重构 Spec

- 日期：2026-11-10
- 状态：**已实施，验收结果见[运行时架构](../../architecture.md#2026-11-10-实施验收)**
- 范围：目录边界、显式依赖、系统与关卡生命周期、逐帧调用、对象组件和编辑器拆分。
- 当前目录与 API：[运行时架构](../../architecture.md)。

后续修订：用户补充了组件组合与按组件类型跨 GO 更新的要求，见[组件化对象与 Tick 修订 Spec](2026-11-10-component-based-game-objects.md)（已完成一轮设计消融并实施）。本页保留第一轮历史决定；当前 Transform 数据归属、类型分发与同步物理以修订版及[运行时架构](../../architecture.md)为准。

目录进一步调整见[2026-11-11 function 结构重构](2026-11-11-function-layer-layout.md)：component / level / object / world 分目录，运行时装配归入 function/global。

## 1. 目标与参考

采用 `app → game / editor → runtime` 边界，runtime 内部保持 `core / platform / resource / function`。引擎代码可脱离练枪房内容使用；每个系统和资源只有一个生命周期所有者。

参考 Piccolo 的实际系统组织，而非仅复制目录名称：

| Piccolo | 采用方式 |
| --- | --- |
| [engine.cpp](https://github.com/BoomingTech/Piccolo/blob/main/engine/source/runtime/engine.cpp) | Engine 显式执行 logicalTick / rendererTick |
| [RuntimeGlobalContext](https://github.com/BoomingTech/Piccolo/blob/main/engine/source/runtime/function/global/global_context.cpp) | Context 集中构造系统并控制初始化／销毁顺序 |
| [framework](https://github.com/BoomingTech/Piccolo/tree/main/engine/source/runtime/function/framework) | WorldManager → Level → GameObject → Component |
| [runtime](https://github.com/BoomingTech/Piccolo/tree/main/engine/source/runtime) | 基础、平台、资源、功能的依赖边界 |

保留 Three.js / WebGPU、现有材质与渲染算法。不引入自研 RHI、数学库、反射、序列化生成器或完整 ECS。

## 2. 审查后确定的精简决策

1. **实例化 Context 与显式注入**：保留 Experience 风格的集中创建习惯；系统通过参数获得窄依赖，不导入 Context，不从全局查找服务。
2. **logicalTick / rendererTick**：主循环先逻辑后渲染；时间由 step 统一推进。
3. **移除 Scheduler**：当前系统组合固定，Engine 直接编排阶段；body 和组件集合由各自领域管理。
4. **弃用独立 FlyController**：自由／轨道观察统一进入 editor/camera-controls。现有操作保留，旧类／旧模块路径不保留。
5. **取消 RoomSession 和额外 World 包装**：RangeRoomLevel 直接组装关卡。app 只连接游戏操作与工具，不创建关卡对象或第二套 tick。
6. **保留小型 WorldManager**：承担活动关卡、异步加载排他、取消、失败回滚、卸载与重新加载。
7. **引入最小对象组件模型**：Level 拥有 GameObject，对象拥有 Component；使用同一个 GameObject 的 mobility 区分 static / dynamic。
8. **精简基础包装**：core 平铺 events/disposer/time；runtime-context 位于 runtime 根目录；平台使用 frame-driver 与 Size；删除空 animation 模块。
9. **复用 Three.js 变换**：GameObject.root 承载位置／旋转／缩放，本期不再建立纯属性代理 TransformComponent。

## 3. 目标目录

```text
src/
├─ main.js
├─ app/
│  ├─ bootstrap.js
│  ├─ config.js
│  ├─ diagnostics.js
│  └─ style.css
├─ engine/
│  ├─ runtime/
│  │  ├─ engine.js
│  │  ├─ runtime-context.js
│  │  ├─ index.js
│  │  ├─ core/                     events、disposer、time
│  │  ├─ platform/                 frame-driver、size
│  │  ├─ resource/                 ResourceManager、Object3D 释放、loader
│  │  └─ function/
│  │     ├─ input-system.js
│  │     ├─ framework/              WorldManager、Level、GameObject、Component
│  │     ├─ physics/                系统、碰撞世界、控制器
│  │     └─ render/                 系统、管线、passes、material、debug
│  └─ editor/
│     ├─ editor.js
│     ├─ camera-controls.js
│     └─ panels/
└─ game/
   ├─ player/                      参数、算法、PlayerComponent
   └─ range-room/
      ├─ level.js
      ├─ config.js
      ├─ collision.js
      ├─ ground.js
      ├─ floating-teapot.js
      ├─ assets/
      └─ lighting/
```

`index.js` 用在真实模块边界，不为每个单文件新增目录。共享采样、环境代理和辅助绘制进入 runtime；含房间 schema、资产约定和捕获配置的材质／探针代码保留在 game。

## 4. 依赖与所有权

```text
app → game → runtime
app → editor → runtime

RuntimeContext → Engine、各功能系统、资源、平台
function → resource / platform / core
resource → platform / core
platform → core
```

- runtime 不依赖 game/editor/app；game 与 editor 互不依赖。
- 直接能力调用用参数注入；状态通知用回调／事件；跨游戏与工具的协调由 app 负责。
- RuntimeContext 拥有应用级系统；WorldManager 拥有关卡；Level 拥有对象及关卡资源；GameObject 拥有组件。
- PhysicsSystem 仅持有 body 注册，PlayerComponent 拥有玩家并负责注销。
- ResourceManager 拥有加载模板；关卡拥有克隆材质、场景绑定和自建对象资源。
- Editor 拥有观察相机操作、面板、碰撞辅助线；app 将其挂接到 Engine 的 input/frame 通知。
- WorldManager 的 load/unload 通知让 app 绑定／释放关卡工具；卸载通知发生在 Level 释放之前。

## 5. 初始化与关闭

初始化：

```text
main → app
  → RuntimeContext.initialize()
      → Size / ResourceManager / Scene / Camera
      → await RenderSystem
      → Input / Physics / WorldManager / Engine
  → world.loadLevel(() => new RangeRoomLevel(显式依赖))
      → 房间与地面 → 可选探针 → 碰撞 → 玩家、茶壶与阴影
      → 发布 activeLevel → app 挂载工具与诊断
  → Engine.start()
```

关闭：

```text
停止帧循环、取消加载
  → 卸载 Editor 与诊断
  → WorldManager 卸载 Level
      → 还原阴影／探针材质绑定
      → 注销玩家 body，释放组件、场景对象与资产绑定
  → Physics / Input
  → RenderSystem
  → ResourceManager
  → Size 与事件订阅
```

关闭幂等，初始化失败、HMR 和主动销毁共用路径。关闭后返回的 renderer／资产立即释放。旧 `engine.destroy()` 通过关闭通知进入 Context 的整体清理，Engine 不反向导入 Context。

关卡工厂必须同步交出带 load/dispose 的对象。WorldManager 首轮只管理一个活动关卡，拒绝并发加载，加载失败不公布半初始化实例。卸载立即取消并清理关卡，返回的 Promise 等待旧加载收尾；收尾前拒绝新加载。

## 6. Tick 契约

```text
Engine.step(nowMs)
  → Time.tick(nowMs)
  → logicalTick()
      → 工具输入通知
      → WorldManager.tick('input', frame)
      → WorldManager.tick('gameplay', frame)
      → PhysicsSystem.fixedUpdate(fixedDelta) × fixedSteps
      → WorldManager.tick('animation', frame)
  → rendererTick() → RenderSystem.update(frame)
  → frame 通知：HUD / 诊断观察者
```

世界更新进一步展开：`WorldManager → Level → GameObject → 对应阶段的 Component`。

- 保留输入优先的顺序，物理之后进行相机插值与表现更新。
- 固定步为 1/60 秒，每帧最多 5 步；当前所有实际固定步行为集中于 PhysicsSystem。
- logicalTick 本身不推进时钟；rendererTick 不推进模拟。正常 RAF 仅执行一次 step。
- `timeScale = 0` 冻结模拟时间；观察操作使用 rawDelta；Engine.pause 停止整个 RAF。
- 两个 tick 在浏览器主线程顺序执行，Scene/Camera 直接供渲染使用；本期不引入线程交换缓冲。
- 无 GameObject／Component 可重复推进整个物理世界。PlayerComponent 的逻辑与表现回调不调用玩家 fixedUpdate。

## 7. 对象组件契约

- GameObject：id、name、active、mobility、root、组件集合、所属 Level。
- Component：owner、enabled、onAttach、dispose，以及按需实现的 inputTick/gameplayTick/animationTick。
- static 对象可以包含交互行为；dynamic mobility 不等于 dynamic 刚体。
- 一份组件只能属于一个对象；同一具体类型在对象内最多一份；挂接失败清理已创建资源并回滚归属。
- 阶段开始捕获对象与组件快照：新增从下一阶段生效，移除立即停止执行。
- 对象释放逆序释放组件；Level 的资源清理继续按依赖顺序执行。
- 房间 GLB 按整体静态对象管理，不把每个子网格都包装成 GameObject。玩家、茶壶使用真正接入 tick 的行为组件。

## 8. 兼容范围与迁移对照

保留画面、资产、出生点、移动参数、飞行／轨道／玩家操作、探针、阴影及既有 URL 参数。新增 `?editor=0` 用于无工具运行验证。

`__RANGE_ROOM__` 的 world、room、inspection、render、snapshot 等接口由 app/diagnostics 适配。诊断字段 inspection.fly 可以继续存在，指向 Editor 的相机控制对象；它不是旧 FlyController 公共模块。

| 旧位置 | 新归属 |
| --- | --- |
| engine/core/engine.js | runtime/engine.js |
| engine/core/scheduler.js | 删除，Engine 显式编排 |
| engine/core/size.js | runtime/platform/size.js |
| engine/core/disposer.js | 通用部分到 core；GPU 树释放到 resource |
| engine/resources | runtime/resource |
| engine/function | 通用能力到 runtime/function |
| fly-controller | editor/camera-controls，合并观察模式 |
| world/range-room.js、room-inspection 的关卡组装 | game/range-room/level.js |
| world/player.js | game/player，参数与行为分开 |
| 观察 HUD、debug/probe panel | engine/editor/panels |
| main.js 的运行时与游戏组装 | Context 与 app/bootstrap |

RenderSystem 通过 `size` 注入视口；PhysicsSystem.fixedUpdate 接收固定秒数。同步更新所有调用方，不保留旧目录转发文件。历史设计文档保持历史语义，维护中的架构和使用文档更新到当前路径。

## 9. 验收

1. 目录与依赖检查、无循环、无失效引用，公共运行时 API 在无 DOM 的 Node 环境可导入。
2. Engine 顺序、0–5 固定步、暂停恢复、逻辑／渲染独立调用。
3. Context 初始化失败回滚、初始化中销毁、迟到 renderer 释放、逆依赖关闭与实例隔离。
4. WorldManager 排他加载、取消、失败、销毁中加载、卸载／重载与工具清理顺序。
5. 静态／动态对象、组件所有权、阶段内增删与玩家物理唯一推进路径。
6. 构建、ESLint、既有单元与浏览器回归；真实关卡有／无 Editor 的重载、输入、渲染和销毁。

迁移前基线：73/76 测试通过，3 项碰撞数量断言为 390，而资产实际为 399。本轮记录为既有失败，不能通过调整这些断言掩盖架构回归。临时构建、截图、浏览器配置与报告放在 `D:/opencode-temp`。

后续确认：用户已确认 399 为正确碰撞盒数量，测试及线框数量断言已同步修正；进入组件化修订前，`npm test` 为 89/89 通过。
