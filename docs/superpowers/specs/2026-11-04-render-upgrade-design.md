# Render 层升级设计

日期：2026-11-04
three 版本：r187（无需升级，所需 addon 均已内置）

## 目标

把 `src/engine/systems/render/` 从 TODO 占位升级为完整 render 系统，为 PC 独显上的 Minecraft 风格战术射击游戏（类 Valorant）服务：

- Light probe GI（`LightProbeGrid`）
- GTAO
- 抗锯齿：SMAA / TRAA 代码内可切换
- `RenderPipeline` 节点后处理管线
- Tone mapping：Khronos PBR Neutral
- Color grading：3D LUT

## 非目标

- 不做 `LightMapper` / UV2 展开 / VXGI
- 不加任何调参面板（见 `.cursor/rules/no-lookdev-panels.mdc`），所有参数写在代码里
- 不改 `main.js` 中现有 Tweakpane
- 不做设备丢失恢复

## 模块

所有代码位于 `src/engine/systems/render/`。

| 文件 | 职责 | 依赖 |
|---|---|---|
| `index.js` | `createRenderSystem({ engine, canvas, scene, camera, aa })`：创建并 `init()` WebGPURenderer；订阅 `engine.size` resize；`update()` 调 `pipeline.render()`；`dispose()` 释放 renderer、pipeline、probe grid、LUT 纹理。对外暴露 `setAA(mode)`、`bakeGI(box)`。 | pipeline.js, gi.js, lut.js |
| `pipeline.js` | `buildPipeline(renderer, scene, camera, { aa, lut })` → `RenderPipeline`。只负责节点连线。 | three/tsl, GTAONode, DenoiseNode, TRAANode, SMAANode, Lut3DNode |
| `gi.js` | `bakeProbeGrid(renderer, scene, box, spacing)` → `LightProbeGrid`。按包围盒和间距计算探针数，加入场景并 `bake()` 一次。 | LightProbeGrid |
| `lut.js` | `loadLut(url)` → `{ texture3D, size }`，按扩展名选 `LUTCubeLoader` 或 `LUTImageLoader`。 | LUT loaders |

资源与工具：

- `public/luts/stylized.cube`：33³，暗部偏青、亮部偏暖、轻微提饱和
- `public/luts/identity.png`：identity 条带，供 PS / DaVinci 调色后替换
- `tools/gen_luts.mjs`：生成上述两个文件的 Node 脚本

`main.js` 改动：

- 用 `createRenderSystem` 替换现有 renderer 创建、resize 监听、render system 三段
- 移除 `HemisphereLight`（环境光由 probe 提供，避免重复计算）
- 启动后调用一次 `bakeGI(box)`

## 每帧数据流

```
prePass(depth + normal, 低开销材质)
  └─ GTAO（resolutionScale 0.5）
       ├─ SMAA 模式：denoise(ao, depth, normal, camera)
       └─ TRAA 模式：useTemporalFiltering = true
scenePass(samples: 0)
  contextNode = builtinAOContext(ao)      // AO 只压间接光
  LightProbeGrid 作为 Light 自动提供间接漫反射
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

## AA 切换

`setAA('smaa' | 'traa')` 释放旧管线并用 `buildPipeline` 重建。两种模式的场景 pass 都设 `samples: 0`；只有 TRAA 模式才输出 velocity。

## 错误处理

- LUT 加载失败：`console.warn`，管线不含 LUT 节点继续运行
- WebGPU 不可用：沿用 `main.js` 现有提示

## 验证

- 在浏览器里截图对比：SMAA 与 TRAA，AO 开与关
- 控制台无报错与警告
- 用 GPU timing 分析各 pass 耗时
- 构建通过：`pnpm build`
