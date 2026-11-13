# 文档

按主题列出。上面是现行说明，下面是设计过程和归档。归档文档保留已被替代或否决的记录，不要按它们继续实现。

## 现行

### 运行时

| 文档 | 内容 |
| --- | --- |
| [运行时架构](architecture.md) | 当前目录、依赖、tick、对象组合、生命周期和公共接口 |
| [阶段优先组件 Tick](superpowers/specs/2026-11-11-phase-first-component-tick.md) | 当前更新契约：Engine 编排阶段，Level 扫描对象，组件承载行为 |
| [function 层结构](superpowers/specs/2026-11-11-function-layer-layout.md) | `component / level / object / world` 与 `function/global` 的目录迁移 |
| [CameraComponent](superpowers/specs/2026-11-11-camera-component.md) | 相机组件提取时的记录；当前玩家固定 AimState 历史接线以运行时架构为准 |
| [武器玩法模块](weapons/gameplay.md) | Classic/Phantom 游戏闭环、控件、装备事务、固定瞄准、延迟 HUD 与生命周期 |
| [武器发布与动画播放](weapons/animation-and-assets.md) | 发布包、AnimationPlayer、WeaponAssets、独立视模 pass、预览与主游戏验收 |
| [武器运行时音频](weapons/audio.md) | 双枪本地声音、AudioBank、Web Audio 时钟、取消/暂停/变速与实际波形验收 |
| [稀疏控制与弹药显示](weapons/runtime-controls.md) | Mixer 后的显式属性覆盖、Judge/Odin 源曲线、弹药事实与数值验收边界 |

### 光照与场景

| 文档 | 内容 |
| --- | --- |
| [renderer V2](lighting/renderer-v2-optimization.md) | 当前渲染管线与验证 |
| [Lightmap v1](lighting/lightmap-v1.md) | 预烘焙集合重烘、补烘和回退 |
| [室内 LightProbeGrid](lighting/light-probes.md) | Blender Box 驱动的探针体积 |
| [超平坦外部地面](lighting/superflat-ground.md) | 房间外石英砖与草皮 |
| [茶壶、阴影与飞行观察](lighting/room-inspection.md) | 茶壶、动态阴影和飞行／轨道操作。默认进入的是玩家模式，飞行操作见本文 |

### 物理与资产

| 文档 | 内容 |
| --- | --- |
| [练枪房碰撞层 v1](physics/collision-layer.md) | `public/collision/range-room.json` 的格式、坐标和重新导出 |
| [Blender → Three.js 导出](blender-to-threejs-export-workflow.md) | 房间资源成套导出。文内范围写于 2026-11-07，以 appearance 资源套件为主 |
| [Alpha 缺面修复](blender-alpha-repair.md) | 已完成的透明模式修复；后续导出沿用修复后的源文件 |
| [tools 脚本](../tools/README.md) | `tools/` 里每个 `.py` / `.mjs` 何时跑、命令和不要单独运行的库 |

## 待实施设计

| 文档 | 范围 | 状态 |
| --- | --- | --- |
| [动画运行时与多枪切换](superpowers/specs/2026-11-11-animation-and-multi-weapon-design.md) | animation 层、武器实例与背包、切换事务、资源发布、换肤、音频与验收 | 阶段 1—4、双枪本地音频、稀疏控制及弹药事实采样已实现；其余枪型完整发布/空间声待实施，后续皮肤素材由用户处理 |
| [武器材质与质感优化路线图](weapons/material-quality-roadmap.md) | 分区 PBR、室内反射、接触遮蔽、边缘细节与材质校准 | 优化思路，尚未实施；建议先做分区材质和静态室内反射小样 |

## 设计过程

这些记录已经落地。读当前行为时先看[运行时架构](architecture.md)；只有需要当时的取舍时再往下读。

| 文档 | 仍可参考 | 不要再当成当前实现 |
| --- | --- | --- |
| [组件组合消融](superpowers/specs/2026-11-10-component-based-game-objects.md) | 组件粒度，以及茶壶动作用普通函数 | 按组件类型索引的 tick；视角合入 Player |
| [Piccolo 运行时重构](superpowers/specs/2026-11-10-piccolo-runtime-architecture.md) | 第一轮目录边界和所有权 | 之后的组件调度与 function 目录 |
| [Tick 对照](superpowers/specs/2026-11-11-component-tick-piccolo-comparison.md) | Piccolo 调用链和当时的差距 | 文中的目标契约；已实施版本是阶段优先 Tick |
| [P2.1 物理 PRD](superpowers/specs/2026-11-09-phase2-physics-collision-design.md) | 碰撞层格式、移动手感和验收口径 | `src/engine/systems/` 等当时路径 |
| [P2.1 实施计划](superpowers/plans/2026-11-09-p2-1-physics-collision.md) | 当时的任务拆分 | 未更新的勾选框和 `src/world/` 路径 |

## 归档

| 文档 | 原因 |
| --- | --- |
| [renderer V1 实施记录](archive/lighting/range-room-v3-implementation.md) | 首版接入记录，管线已由 V2 接替 |
| [单张 Lightmap 试验](archive/lighting/2026-11-05-single-atlas-experiment.md) | 2026-11-05 否决 |
| [Render 层升级设计](archive/render/2026-11-04-render-upgrade-design.md) | 2026-11-06 被练枪房渲染计划替代 |
| [离线探针路线小样](archive/render/2026-11-04-range-probe-validation.md) | 未进入当前渲染 |

新的设计规格仍放在 `superpowers/specs/`，实施计划仍放在 `superpowers/plans/`。
