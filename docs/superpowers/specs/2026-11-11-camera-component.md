# CameraComponent：第一人称相机独立组件

- 日期：2026-11-11
- 来源：用户要求把 camera 从 Player 中分出，并参考 Piccolo CameraComponent。
- 状态：实现完成；验证结果见末节。
- 前置：[阶段优先组件 Tick](2026-11-11-phase-first-component-tick.md)。

## 1. Piccolo 对照

源码固定在提交 `f5053707fed4d3f94d270a436fb0d3a8ae54e3e5`：

- [CameraComponent 声明](https://github.com/BoomingTech/Piccolo/blob/f5053707fed4d3f94d270a436fb0d3a8ae54e3e5/engine/source/runtime/function/framework/component/camera/camera_component.h)
- [CameraComponent 实现](https://github.com/BoomingTech/Piccolo/blob/f5053707fed4d3f94d270a436fb0d3a8ae54e3e5/engine/source/runtime/function/framework/component/camera/camera_component.cpp)
- [Camera 参数资源](https://github.com/BoomingTech/Piccolo/blob/f5053707fed4d3f94d270a436fb0d3a8ae54e3e5/engine/source/runtime/resource/res_type/components/camera.h)

Piccolo 在挂接时读取 first_person／third_person／free 参数和 FOV。tick 检查 owner 是否为当前活动角色；第一人称逻辑读取输入、计算朝向与竖直偏移，将 view matrix 提交到 RenderSwapContext，同时把水平朝向同步给 Character。

本项目沿用其第一人称职责边界，并适配已有架构：

| Piccolo | 当前实现 |
| --- | --- |
| CameraComponent 持有视角与跟随偏移 | Camera 持有 pitch、俯仰上限、目标／当前眼高和缓动参数 |
| 第一人称视角同步 Character rotation | `look()` 更新 Transform yaw；pitch 仅作用于相机 |
| 直接读取全局 InputSystem | Player 每帧消费一次鼠标并转换为弧度命令，调用 Camera.look |
| 跟随当前角色的位置 | Camera 只依赖同 GO 的 Transform，presentation 采样固定步历史 |
| 活动角色检查 | Level 的 active／enabled／disposed 判断，加 app 的模式交接 |
| 提交 CameraSwapData | presentation 写入注入的共享 Three.js 相机，rendererTick 只绘制 |
| 相机 FOV 资源 | RuntimeContext 创建渲染相机，Level 配置 FOV／近远裁面，RenderSystem 更新 aspect |

坐标约定为 Three.js 的 +Y 向上、相机 -Z 向前；身体 Transform 为水平 yaw，视角为 YXZ 的 yaw／pitch。Piccolo 的 third_person／free 与本项目 Editor 的 fly／orbit 是各自的相机模型；当前运行时组件实现第一人称跟随，观察工具使用 CameraControls。

## 2. 装配与阶段

```text
Player GO
  TransformComponent
  MotorComponent(fixed, characterMotion)
  CameraComponent
  PlayerComponent

input:
  Player 读取输入，应用游戏灵敏度
    → Camera.look(deltaYaw, deltaPitch)
    → Motor.command
fixed:
  Motor 读取本帧 yaw，运动／碰撞后写回 Transform
postPhysics:
  Player 检查重生，根据实际 crouched 设置 Camera.verticalOffset
presentation:
  Camera 用 alpha 采样位置、rawDelta 平滑眼高，输出相机姿态
rendererTick:
  绘制已准备好的相机
```

Camera 的 `requires = [TransformComponent]`，`phases = ['presentation']`；Player 的阶段为 input／postPhysics。Camera 在 input 接收的是即时命令，真正的视图发布统一发生在 presentation。这样同阶段组件的装配顺序不会形成眼高或运动数据依赖。

Camera 可装配在仅有 Transform 的 GO 上，由脚本提供视角／偏移目标。Player 的依赖现在包括 CameraComponent，以便在装配和移除时校验完整组合。

## 3. 状态与 API

位置：`src/engine/runtime/function/framework/component/camera/camera-component.js`，由 `framework/index.js` 导出。

| API | 契约 |
| --- | --- |
| `new CameraComponent({ camera, verticalOffset, offsetSmoothing, maxPitch })` | 注入共享渲染 camera；offset 为世界 Y 偏移，smoothing 单位为每秒，maxPitch 使用弧度 |
| `yaw` | 从 Transform 读取的水平朝向，只有一份权威状态 |
| `pitch` | Camera 持有的只读俯仰值 |
| `verticalOffset` | 可修改的目标偏移；默认 0 |
| `currentVerticalOffset` | 平滑后的只读偏移 |
| `setAngles(yaw, pitch)` | 设置身体 yaw 和受限的视角 pitch |
| `look(deltaYaw, deltaPitch)` | 累加弧度视角增量 |
| `reset({ yaw, pitch, verticalOffset })` | 重置视角及偏移历史；位置历史由 Transform／Motor 重置 |
| `readCameraPose(verticalOffset)` | 从当前输出相机得到候选身体位置、yaw、pitch，交由游戏规则判定放置 |
| `enabled` | 参与 presentation 的控制开关，遵循通用组件生命周期 |

平滑为 `current += (target - current) * (1 - exp(-offsetSmoothing * rawDelta))`，零 smoothing 表示直接采用目标。rawDelta 驱动平滑，timeScale 为 0 时仍可观察；位置插值仍使用模拟时钟 alpha。

Player 保留 `look()` 的输入计数／灵敏度映射、`teleport()`、`respawn()`、`placeAtCamera()` 和现有 snapshot 字段。yaw／pitch 委托 Camera 读取；Euler、俯仰钳制、眼高历史与共享相机写入集中到 CameraComponent。站蹲目标来自 Motor 解算后的状态，因此低天花板阻止站起时也保持低眼高。

## 4. 控制权与生命周期

- RuntimeContext 拥有一个共享渲染相机，CameraComponent 借用其姿态输出接口。
- `createPlayer()` 初始禁用 Motor／Camera／Player；Level 启用玩家时三者一起启用。
- app 切到 fly／orbit 时通过 `setPlayerEnabled(false)` 关闭 Camera 的表现写入，再由对应 Editor 控件驱动观察机位。setMode 是同步交接，下一帧只有对应模式的写入者生效。
- 返回 player 时关闭 Editor 写入；Camera 读取当前机位，Player 做碰撞测试，安全则放置，否则重生。重置位置与眼高历史后，下一 presentation 直接使用新姿态。
- 禁用、挂接、移除、Level 卸载都不写入共享相机。相机组件销毁后，runtime 的 camera 仍可供下一关借用。
- 同一渲染相机由装配者选择当前写入者；多个 GO 可分别装配并通过 enabled 交接。

## 5. 验证

| 检查 | 结果 |
| --- | --- |
| `npm test` | 115/115 通过（原 107，加 8 个相机／玩家集成测试） |
| `npx eslint src tests tools eslint.config.js` | 0 错误，6 项既有 JSDoc 警告 |
| Vite 生产构建 | 通过，97 个模块 |
| 浏览器 runtime | 有／无 Editor 各两次重载通过；共享输出、控制权交接、投影、销毁与重复渲染隔离全部通过 |
| 浏览器 player | 通过；移动、墙碰撞、跳跃、重生与模式切换正常 |
| 浏览器 inspection | 通过；fly／orbit、焦点输入、茶壶表现与阴影正常 |

单元覆盖独立 Transform + Camera、插值不写回模拟、双向 pitch 限制、rawDelta 平滑与帧率一致性、零步／多步输入消费、实际蹲姿、传送／重生历史和候选机位读取。浏览器 runtime 覆盖 player ↔ fly、player ↔ orbit 和无 Editor 时的启停交接，四次重载均保持 4 个 GO，旧 Camera 释放而共享 render camera 复用。

构建目录：`D:/opencode-temp/opencode/mc-valorant-camera-component-build/`。

浏览器三套报告均为 `passed: true`、`errors: []`。证据目录：`D:/opencode-temp/opencode/mc-valorant-camera-component-browser/`，子目录 runtime、player、inspection。
