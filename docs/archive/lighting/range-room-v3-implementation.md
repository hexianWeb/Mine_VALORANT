# renderer V1 · 练枪房实施与验证记录

> 归档。本文保留 V1 历史记录。2026-11-07 的管线优化及最新验证见 [renderer V2 优化与验证](../../lighting/renderer-v2-optimization.md)。文档索引见 [docs/README.md](../../README.md)。

日期：2026-11-06。练枪房渲染计划已在首版落地后从仓库移除；本文保留该轮的实施与验证记录。

本次提交将运行时渲染基线暂定为 **renderer V1**；`range-room-v3` 仍是现有资产版本，不因此修改资源 hash 或重新导出。

## 已交付

- 独立 WebGPU render system，房间异步加载、resize、错误诊断、销毁和后处理切换。
- 正式 `range-room.glb`、五张降噪半浮点线性 EXR、SHA-256 与逐 primitive 绑定 manifest。
- 烘焙外观使用不受光材质；未烘焙物体保留 PBR、原始纹理、透明裁剪和双面语义。
- 三排实测顶灯的位置、大小、颜色、朝向及长轴；日间天空环境与三盏走廊点光。
- 全场景深度/法线预通道，GTAO 仅调制实时材质间接光，空间去噪、Reinhard 曝光强度 1.2、显示域 LUT 与 SMAA。
- 按最新要求，未烘焙像素贴图使用最近邻；烘焙 atlas 保留线性/三线性、有限 mip 与 16× 各向异性。
- AO/LUT 调试面板，参数、预设、`.cube` 导入、AO 单独预览与重置。
- 资产校验 CLI、Node 回归测试、无额外测试依赖的 Chrome CDP 检查。
- 后台 Blender 副本导出工具，集成按真实 alpha 分类；拒绝覆盖已有资源，不重展 UV 或重烘。

最终资源包含 **135 个非空 mesh 节点、199 个 primitive、47,596 个源三角形**。源场景另有 7 个空 mesh，不产生渲染 primitive。运行时分类：18 个 baked-appearance、178 个 realtime、3 个 fixture-emissive。

## 解决的接入问题

1. **参考机位**：OrbitControls 构造时会先更新相机；现在先保存原始观察方向，再初始化 target，并数值验证位置与四元数等价。
2. **Atlas V 轴**：本批 glTF UV 与 EXRLoader 的扫描线方向相反。EXR 纹理保留 `flipY=false`，烘焙材质显式翻转一次 V；已对照 Blender 参考截图，不能再额外翻转图片。
3. **透明与深度**：集成工作区的模型修复后，材质为 109 OPAQUE、35 MASK、4 BLEND；烘焙不透明表面也不再继承旧 BLEND 的 `depthWrite=false`。
4. **资源所有权**：显式拥有 SMAA 输入转换产生的 RTT；关闭效果后不遗留其输入渲染目标。共享源纹理和 geometry 仍归 ResourceManager 所有。
5. **后台惰性图像加载**：执行 alpha 检查前读取打包纹理缓冲，避免把“尚未加载”误报成丢失图片。

## 可复跑验证

```bash
npm test
npm run validate:room
npm run build
npm run preview
node tools/check-room-browser.mjs http://localhost:4173/
```

实际验证：

| 项目 | 结果 |
|---|---|
| Node 回归 | 16/16 通过，包括 EXR/alpha/材质隔离、最近邻采样、有限 mip、天空代理、LUT 校验、走廊灯和取消加载后的释放 |
| 资产检查 | 模型/五页 SHA-256、完整 primitive 绑定、UV 属性均通过 |
| ESLint | 本次修改的渲染、资源、入口与测试/CLI 文件无错误 |
| 生产构建 | 通过；Three.js WebGPU 主包仍有大 chunk 提示，未以隐藏告警替代优化 |
| Chrome WebGPU | 实际 NVIDIA Lovelace 适配器，错误列表为空 |
| 参考相机 | 位置与四元数等价检查通过 |
| resize / dispose | 800×600 resize 和 engine.destroy 检查通过 |
| 相机位移 | 平移、降低高度并前移后持续渲染，engine 保持 running，无新增运行错误 |
| 采样分工 | 浏览器确认 142 张表面贴图均为最近邻、无 mip 混合；5 张 atlas 仍为线性/三线性、3 级 mip |
| 面板交互 | 实际 DOM 事件修改 AO 参数/采样/分辨率，灰度预览、重置、LUT 预设/开关/曝光/导入/错误恢复均通过 |

### HDR 像素隔离测试

在当前参考机位，通过射线选取 5 个可见烘焙表面像素、24 个实时表面像素，读取 scene pass 的线性 HDR 值，而不是比较经过 AA 的截图：

| 开关对照 | 最大 RGB 绝对差 |
|---|---:|
| GTAO 开/关：烘焙表面 | **0** |
| GTAO 开/关：实时表面 | **0.0263672** |
| 运行时灯开/关：烘焙表面 | **0** |
| 运行时灯开/关：实时表面 | **0.2521973** |

这证明主房间烘焙表面没有重复受光/叠 AO，同时实时物体确实受光并获得 AO，而不只是存在一个未生效的效果配置。走廊是用户要求的局部补光例外，独立验证见下节。

### 同日追加：走廊、显示与像素风

- **走廊补光有效**：走廊检查机位取 96 个 HDR 像素，仅切换三盏新点光；baked 最大 RGB 增量 **0.1801758**，实时表面 **0.2358398**，分别有 16 / 34 个样本变亮。截图确认原黑色走廊开口可见；主房间的原顶灯/环境/AO 隔离不变。
- **像素风恢复**：未烘焙表面 `minFilter = magFilter = NearestFilter`，关闭 mip 生成和插值；sRGB 解码不变。WebGPU 各向异性要求所有过滤模式为 linear，因此这些原始贴图设 anisotropy 1，atlas 仍可用 16×。近景砖块、木桌和地板小物件不再被双线性采样模糊。
- **LUT 确实改变显示输出**：暖色预设与 identity 的截图平均通道差约 **3.00 / 255**；关闭 LUT 后差 **0.037 / 255**；两次重置均恢复到差 **0**。2³ `.cube` 导入产生约 **8.11 / 255** 的差异，错误导入保留有效 LUT。曝光可从面板改到 1.5 并重置为 **1.2**。
- **AO 预览**：面板实际切换到 8 samples、半分辨率、半径 0.8、强度 0.6 后，截图样本为灰度、范围 **220–255**；重置恢复默认完整场景。
- **天空显存控制**：全分辨率 4K LDR 背景与 1K 环境代理分离；相较最初直接以 4K 天空生成 PMREM 的同流程 1080p 统计，减少约 **58 MiB**。不改天空源文件，不把它当成 HDR 数据。

### 性能快照，不是帧率承诺

Chrome headless、960×540、DPR 1、NVIDIA Lovelace、每档 12 个暖机后样本。每次样本跨越新的动画帧，再解析 GPU timestamps，避免把缓存的 fullscreen quad 误当完整帧。

| 管线 | 整管线 GPU P50 / P95 |
|---|---:|
| GTAO + 空间去噪 + SMAA | 约 **1.059 / 1.064 ms** |
| 无 GTAO、保留 SMAA | 约 **0.454 / 0.460 ms** |
| 无 GTAO、无 AA | 约 **0.376 / 0.394 ms** |

这些是其中一轮整帧管线的不同配置，不是各独立 pass 的精确计时，也不是浏览器最终显示 FPS。不同测试轮次存在波动，最新值见 `report.json`。CPU 提交统计与 GPU 时间分开记录；首次编译尖峰不冒充稳态性能。

追加的 **1920×1080 / DPR 1** 对照同样通过：GTAO + 去噪 + 默认 identity LUT + SMAA 的整管线 GPU **P50 约 3.979 ms，P95 约 3.984 ms**，每档 12 个样本；不是已承诺的目标帧率。

五页 atlas 基础级为 160 MiB，当前 0–2 级共 **210 MiB**；含天空、环境和测试中切换的管线资源，960×540 基线 renderer GPU 资源统计约 **491.2 MiB**，1080p 约 **599.9 MiB**。这是 renderer 的统计，不是驱动层总显存。有限 mip 已做截图和位移检查，但完整 mip 链、长时间远景运动质量仍不能视为最终验收。

## 证据文件

当前机器的临时结果位于：

- `D:/opencode-temp/opencode/range-room-browser/report.json`：完整浏览器报告，包含像素、GPU 时间、全高清检查与释放结果。
- `D:/opencode-temp/opencode/range-room-browser/room-gtao-smaa.png`：960×540 基线。
- `D:/opencode-temp/opencode/range-room-browser/room-no-ao-no-aa.png`：无效果对照。
- `D:/opencode-temp/opencode/range-room-browser/room-fullhd-gtao-smaa.png`：已生成的 1920×1080 对照。
- `D:/opencode-temp/opencode/range-room-browser/room-motion-inspection.png`：相机位移后的全高清检查画面。
- `D:/opencode-temp/opencode/range-room-browser/room-ao-preview.png`：AO 灰度调试视图。
- `D:/opencode-temp/opencode/range-room-browser/room-lut-warm.png`：面板暖色 LUT 对照。
- `D:/opencode-temp/opencode/range-room-browser/room-corridor-lit.png` 与 `room-corridor-unlit.png`：仅切换走廊三点光，显示最近邻原始纹理与局部补光差异。
- `D:/opencode-temp/opencode/range-room-v3-4ea455ea/blender-reference.png`：后台 Blender 副本的同机位参考。
- `D:/opencode-temp/opencode/range-room-v3-4ea455ea/alpha-export-check.log`：后台副本中确认 alpha 修复得到 109/35/4 分类，且修复前后 geometry/UV hash 不变。

临时快照和浏览器配置不放进项目。旧异常图不作为当前画面验收结果。

## 明确保留的边界

- 顶灯 intensity 目前为 **5 的初始拟合**，环境强度 **0.35**；不是把 510 W 直接当 intensity，也不宣称已经物理等效于 Cycles。
- RectAreaLight 无阴影、无对应 Spread；若实际遮挡不能接受，按设计再进入少量 Spot 近似的对照阶段，不无条件叠加完整照明。
- Reinhard 按用户要求替代早期 AgX，曝光强度为 1.2；不是以此宣称与 Blender OCIO 完全一致。
- 已实现用户要求的 LUT，未实现可选 TRAA、探针或烘焙表面接收动态阴影；本轮不新增玩家控制或碰撞系统。
- 最终灯光观感、目标设备/分辨率/刷新率、完整 mip/远景运动检查仍需按使用要求验收，不能仅凭上述 headless 数字宣称竞技高帧率达标。
