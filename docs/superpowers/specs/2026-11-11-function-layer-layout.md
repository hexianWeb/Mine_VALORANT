# function 层结构重构

- 日期：2026-11-11
- 状态：**已实施并验收通过**
- 来源：用户提供的 Piccolo function 目录结构。
- 前置：[组件组合与类型 Tick 消融](2026-11-10-component-based-game-objects.md)。
- 完整当前目录及验收：[运行时架构](../../architecture.md#2026-11-11-function-结构验收)。

后续修订：Level 调度改为[阶段扫描](2026-11-11-phase-first-component-tick.md)，并新增 [CameraComponent](2026-11-11-camera-component.md)。下方职责与导出已同步；验收节保留本次目录迁移的记录。

## 1. 职责划分

| 目录 | 职责 |
| --- | --- |
| `framework/component/` | Component 基类和 Transform / Mesh / Motor / Camera 通用组件；每类组件独立子目录 |
| `framework/level/` | Level 的对象归属、阶段扫描与组件快照 |
| `framework/object/` | GameObject 的装配、直接依赖校验和释放 |
| `framework/world/` | WorldManager 的关卡加载、取消、发布、卸载 |
| `character/` | 角色运动规则及角色包围盒的普通函数 |
| `controller/` | 运动学碰撞解算，包括扫掠、台阶和贴地 |
| `global/` | RuntimeContext 实例的系统构造、依赖注入与关闭顺序 |
| `input/` | 输入系统 |
| `physics/` | 碰撞世界、查询及同步解算服务 |
| `render/` | 渲染系统、管线、配置、计时、资源辅助、材质、passes 和 debugdraw |

组件承担对象装配和生命周期；普通函数与系统承担领域算法。PlayerComponent 在 game/player 内组织玩家控制，茶壶的普通运动函数在 game/range-room 内提供。

## 2. 文件迁移

下表路径相对 `src/engine/runtime/`：

| 原位置 | 当前位置 |
| --- | --- |
| `function/framework/component.js` | `function/framework/component/component.js` |
| `function/framework/transform-component.js` | `function/framework/component/transform/transform-component.js` |
| `function/render/mesh-component.js` | `function/framework/component/mesh/mesh-component.js` |
| `function/motion/motor-component.js` | `function/framework/component/motor/motor-component.js` |
| `function/framework/level.js` | `function/framework/level/level.js` |
| `function/framework/game-object.js` | `function/framework/object/game-object.js` |
| `function/framework/world-manager.js` | `function/framework/world/world-manager.js` |
| `function/motion/character-motion.js` | `function/character/character-motion.js` |
| `function/physics/character-controller.js` | `function/controller/character-controller.js` |
| `runtime-context.js` | `function/global/runtime-context.js` |
| `function/input-system.js` | `function/input/input-system.js` |
| `function/render/config.js` | `function/render/render-config.js` |
| `function/render/pipeline.js` | `function/render/render-pipeline.js` |
| `function/render/debug/profiling.js` | `function/render/render-profiler.js` |
| `function/render/debug/collision-debug.js` | `function/render/debugdraw/collision-debug.js` |

`render/color-grading.js` 是 LUT 数据与资源模块，`render-pipeline.js` 负责其 pass 连接；debugdraw 归类为辅助几何绘制，性能计时由 render-profiler 管理。

## 3. 导出与依赖

1. `runtime/index.js` 导出 RuntimeContext；其具体实现位于 function/global。
2. `framework/index.js` 统一导出 Component、Transform、Mesh、Motor、Camera、GameObject、Level、WorldManager。组件内部引用具体相邻文件。
3. `physics/index.js` 导出 CollisionWorld、overlaps、createPhysicsSystem。运动学算法 `moveAABB` 使用 controller 的明确文件入口。
4. `global/runtime-context.js` 是装配根，可构造 Engine 及各层服务；其他功能模块通过参数获得服务。
5. 架构测试验证引用有效、运行时依赖方向、global 的入口限制、无环和公共 API 的 Node 导入。

```text
PlayerComponent → motor.command
MotorComponent → characterMotion（注入的普通函数）
MotorComponent → PhysicsSystem.move → controller.moveAABB → CollisionWorld
MotorComponent → Transform
PlayerComponent → CameraComponent.look / verticalOffset
MeshComponent / CameraComponent → Transform 采样
```

## 4. 验收

- 单元与架构测试：95/95 通过。
- ESLint：0 错误，6 项既有 JSDoc 警告。
- Vite 生产构建：通过。
- 浏览器 inspection / player / runtime / probes 四套均 `passed: true`、`errors: []`。完整证据见[运行时架构](../../architecture.md#2026-11-11-function-结构验收)。
