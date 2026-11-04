# Render 层升级设计

日期：2026-11-04
three 版本：r187（无需升级，所需 addon 均已内置）

## 目标

把 `src/engine/systems/render/` 从 TODO 占位升级为完整 render 系统，为 PC 独显上的 Minecraft 风格战术射击游戏（类 Valorant）服务：

- GI：静态地图用 `LightMapper` 烘焙 lightmap（光源为 VXGI），动态物体用 `LightProbeGrid`
- GTAO
- 抗锯齿：SMAA / TRAA 代码内可切换
- `RenderPipeline` 节点后处理管线
- Tone mapping：Khronos PBR Neutral
- Color grading：3D LUT

## 非目标

- 不做实时 VXGI（逐像素锥追踪开销高、噪点依赖 TRAA，不适合高帧率竞技）
- 不做 lightmap 离线导出持久化（第一版每次加载时在 GPU 上重新烘焙）
- 不加任何调参面板（见 `.cursor/rules/no-lookdev-panels.mdc`），所有参数写在代码里
- 不改 `main.js` 中现有 Tweakpane
- 不做设备丢失恢复

## 模块

所有代码位于 `src/engine/systems/render/`。

| 文件 | 职责 | 依赖 |
|---|---|---|
| `index.js` | `createRenderSystem({ engine, canvas, scene, camera, aa })`：创建并 `init()` WebGPURenderer；订阅 `engine.size` resize；`update()` 调 `pipeline.render()`；`dispose()` 释放 renderer、pipeline、GI 资源、LUT 纹理。对外暴露 `setAA(mode)`、`bakeGI({ staticRoot, dynamicBox })`。 | pipeline.js, gi.js, lut.js |
| `pipeline.js` | `buildPipeline(renderer, scene, camera, { aa, lut })` → `RenderPipeline`。只负责节点连线。 | three/tsl, GTAONode, DenoiseNode, TRAANode, SMAANode, Lut3DNode |
| `gi.js` | 静态部分：`unwrapUVs(staticRoot)` 生成 `uv1`，`VXGIVolume.update()`，用 `LightMapper` 逐帧累积烘焙，结果赋给静态材质的 `lightMap`。动态部分：在 `dynamicBox` 内建 `LightProbeGrid` 并 `bake()` 一次，只作用于动态物体。返回 `{ update(), dispose() }`；`update()` 在 lightmap 累积期间每帧调用。 | unwrapUVs, LightMapper, VXGIVolume, vxgiIrradiance, LightProbeGrid |
| `lut.js` | `loadLut(url)` → `{ texture3D, size }`，按扩展名选 `LUTCubeLoader` 或 `LUTImageLoader`。 | LUT loaders |

资源与工具：

- `public/luts/stylized.cube`：33³，暗部偏青、亮部偏暖、轻微提饱和
- `public/luts/identity.png`：identity 条带，供 PS / DaVinci 调色后替换
- `tools/gen_luts.mjs`：生成上述两个文件的 Node 脚本

`main.js` 改动：

- 用 `createRenderSystem` 替换现有 renderer 创建、resize 监听、render system 三段
- 加载 `public/model/map.glb` 作为静态地图
- 移除 `HemisphereLight`（环境光改由 lightmap 和 probe 提供，避免重复计算）
- 地图加载后调用一次 `bakeGI(...)`

## 每帧数据流

```
prePass(depth + normal, 低开销材质)
  └─ GTAO（resolutionScale 0.5）
       ├─ SMAA 模式：denoise(ao, depth, normal, camera)
       └─ TRAA 模式：useTemporalFiltering = true
scenePass(samples: 0)
  contextNode = builtinAOContext(ao)      // AO 只压间接光
  静态网格：material.lightMap 提供间接漫反射
  动态物体：LightProbeGrid 提供间接漫反射
  直接光（太阳 DirectionalLight + 阴影）保持实时
  TRAA 模式：MRT { output, velocity } → traa(output, depth, velocity, camera)   // HDR
renderOutput(color)                        // outputColorTransform = false；Neutral tone mapping + 曝光 + sRGB
lut3D(color, lut, size, intensity)         // LDR / sRGB
SMAA 模式：smaa(color)                     // 最终 LDR
```

固定参数（写在代码中）：

- `renderer.toneMapping = NeutralToneMapping`，`toneMappingExposure = 1.0`
- GTAO：`resolutionScale = 0.5`，其余用默认值，实现时按画面调整
- LUT intensity：`1.0`
- Probe 烘焙：`cubemapSize: 16`，`bounces: 1`
- VXGI：`resolution: 256`，`coneCount: 3`
- LightMapper：atlas `2048`，`padding: 3`，`64` 个样本

## GI 设计

### 目标地图 `public/model/map.glb`（实测）

- 201 个网格，201 个材质，约 16 万三角面、31 万顶点
- 没有 `uv1`、没有蒙皮、没有 GPU 实例化，`LightMapper` 和 `unwrapUVs` 都可以直接用
- 所有节点带绕 X 轴 90° 的旋转。换算后的世界尺寸约为 149 × 53 × 115（X × Y × Z），按 1 单位 = 1 格计
- VXGI 在最长轴 256 体素下，体素大小约 0.58 格，1 格厚的墙能分辨出来（约 1.7 个体素）

### 静态和动态分开

| | 静态地图 | 动态物体（玩家、武器、道具） |
|---|---|---|
| 间接光来源 | lightmap（`uv1`） | `LightProbeGrid` |
| 烘焙光源 | `vxgiIrradiance` + 天空光补偿 | 探针 cubemap 捕获，天然包含天空 |
| 运行时开销 | 每像素采样一次贴图 | 每像素采样一次 3D 纹理 |

`LightMapper` 不支持蒙皮和实例化网格，所以动态物体必须走 probe。

### 天空光补偿（需要先验证）

`VXGIVolume` 只注入直接光源，不包含天空和背景。直接拿 `vxgiIrradiance` 烘焙，户外背光面就只剩太阳的反弹光，会偏暗。

方案是写一个自定义的 irradiance 函数，基于 `createConeTracer` 和 `gather` 的思路：每条锥除了拿到 `color`，还用 `(1 - alpha)` 表示天空可见度，再乘以天空颜色，补进结果里。

如果这个方案效果不好，就回退为用 `LightProbeGrid` 作为 lightmap 的烘焙光源。示例里已经支持这种用法，而且它会自动包含天空。

### Probe 只作用于动态物体（需要先验证）

`LightProbeGrid` 是一个 Light，加到场景里会作用于所有受光材质，这会让静态网格重复计算间接光。候选做法有两个：

1. 不把 grid 加入场景。在动态物体的材质上，通过 `builtinGIContext` 和 `lightProbeGridIrradiance` 单独注入。
2. 把 grid 加入场景，然后查清 r187 中 lightmap 和 probe 的叠加规则。

先验证第 1 种。

### Probe 网格范围

`dynamicBox` 只覆盖玩家能活动的高度范围，不覆盖整张地图的高度。间距约 4 格，按 149 × 16 × 115 的范围算，大约 37 × 4 × 29 ≈ 4300 个探针。

## AA 切换

`setAA('smaa' | 'traa')` 释放旧管线并用 `buildPipeline` 重建。两种模式的场景 pass 都设 `samples: 0`；只有 TRAA 模式才输出 velocity。

## 错误处理

- LUT 加载失败：`console.warn`，管线不含 LUT 节点继续运行
- `unwrapUVs` 返回 null（atlas 装不下）：`console.warn`，静态地图不使用 lightmap，只用 probe 继续运行
- WebGPU 不可用：沿用 `main.js` 现有提示

## 验证

- 在浏览器里截图对比：SMAA 与 TRAA，AO 开与关，lightmap 开与关，有无天空光补偿
- 记录 `unwrapUVs` 的 CPU 耗时、VXGI 更新耗时、lightmap 累积到 64 个样本的总耗时；`unwrapUVs` 超过 3 秒就改为离线预处理并把 `uv1` 写入 glb
- 检查 `unwrapUVs` 返回的警告数（排除的面、过小的面）以及是否返回 null（atlas 装不下）
- 控制台无报错与警告
- 用 GPU timing 分析各 pass 耗时
- 构建通过：`pnpm build`
