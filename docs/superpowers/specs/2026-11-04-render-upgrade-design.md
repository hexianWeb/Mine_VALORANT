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
| `index.js` | `createRenderSystem({ engine, canvas, scene, camera, aa })`：创建并 `init()` WebGPURenderer；订阅 `engine.size` resize；`update()` 调 `pipeline.render()`；`dispose()` 释放 renderer、pipeline、GI 资源、LUT 纹理。对外暴露 `setAA(mode)`、`bakeGI({ mapRoot, probeBox, sky })`。 | pipeline.js, gi.js, lut.js |
| `pipeline.js` | `buildPipeline(renderer, scene, camera, { aa, lut })` → `RenderPipeline`。只负责节点连线。 | three/tsl, GTAONode, DenoiseNode, TRAANode, SMAANode, Lut3DNode |
| `gi.js` | 把 `mapRoot` 下的网格按"有没有 `uv1`"分成两组。有 `uv1` 的：`VXGIVolume.update()`，用 `LightMapper` 和自定义的 `skyVxgiIrradiance` 逐帧累积烘焙，结果赋给材质的 `lightMap`。没有 `uv1` 的细碎物件，以及所有动态物体：在 `probeBox` 内建 `LightProbeGrid` 并 `bake()` 一次。返回 `{ update(), dispose() }`；`update()` 在 lightmap 累积期间每帧调用。 | LightMapper, VXGIVolume, createConeTracer, LightProbeGrid, pmremTexture |
| `sky-irradiance.js` | `skyVxgiIrradiance(volume, skyTexture, skyIntensity)`：改写自 `vxgiIrradiance` 和 `gather`，每条锥额外加上 `(1 - alpha)` × 天空颜色。 | VXGIConeTracer, three/tsl |
| `lut.js` | `loadLut(url)` → `{ texture3D, size }`，按扩展名选 `LUTCubeLoader` 或 `LUTImageLoader`。 | LUT loaders |

资源与工具：

- `public/luts/stylized.cube`：33³，暗部偏青、亮部偏暖、轻微提饱和
- `public/luts/identity.png`：identity 条带，供 PS / DaVinci 调色后替换
- `tools/gen_luts.mjs`：生成上述两个文件的 Node 脚本
- `tools/add_lightmap_uv.py`：Blender 脚本，把下文"Lightmap UV"一节的试验步骤固化下来，用法和 `fix_mcprep_gltf_alpha.py` 一样，在 MCprep 导出前运行
- `public/model/map_lightmap.glb`：试验产物，带 `TEXCOORD_1`，已生成

`main.js` 改动：

- 用 `createRenderSystem` 替换现有 renderer 创建、resize 监听、render system 三段
- 加载 `public/model/map_lightmap.glb` 作为静态地图
- `scene.background` 设为 `public/hdr/skybox-day.png`（等距柱状投影，`SRGBColorSpace`）
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
  有 uv1 的静态网格：material.lightMap 提供间接漫反射
  细碎物件和动态物体：LightProbeGrid 提供间接漫反射
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
- LightMapper：atlas `2048`，`64` 个样本
- 天空强度 `skyIntensity`：初始 `1.0`，实现时按画面调整

## GI 设计

### 目标地图 `public/model/map.glb`（实测）

- 201 个网格，201 个材质，约 16 万三角面、31 万顶点
- 原文件没有 `uv1`；没有蒙皮、没有 GPU 实例化，`LightMapper` 可以直接用
- 所有节点带绕 X 轴 90° 的旋转。换算后的世界尺寸约为 149 × 53 × 115（X × Y × Z），按 1 单位 = 1 格计
- VXGI 在最长轴 256 体素下，体素大小约 0.58 格，1 格厚的墙能分辨出来（约 1.7 个体素）

### 静态和动态分开

| | 大块静态方块（140 个对象） | 细碎物件（61 个对象）和动态物体 |
|---|---|---|
| 判定规则 | 网格有 `uv1` | 网格没有 `uv1` |
| 间接光来源 | lightmap | `LightProbeGrid` |
| 烘焙光源 | `skyVxgiIrradiance`（VXGI 反弹光 + 天空光） | 探针 cubemap 捕获，天然包含 `scene.background` |
| 运行时开销 | 每像素采样一次贴图 | 每像素采样一次 3D 纹理 |

`LightMapper` 不支持蒙皮和实例化网格，所以动态物体必须走 probe。细碎物件走 probe 是因为它们的 UV 块很碎，进 atlas 占地多、效果差。

### Lightmap UV（Blender 离线展开，已试验）

运行时不调用 `unwrapUVs`，改为在 Blender 里离线生成第二层 UV，随 glb 一起导出。

细碎物件的判定：平均每个面的面积小于 0.4 m²。整块方块的面接近 1 m²，栅栏、墙柱、按钮、告示牌、灯笼、花盆、地毯、铁栏杆的面都远小于这个值。按"分块数 / 面数"判定会误判零散分布的整块方块，所以不用这个规则。

| 分组 | 对象数 | 面数 | 表面积 |
|---|---|---|---|
| 进 lightmap | 140 | 50805 | 约 45900 m² |
| 走 probe | 61 | 29374 | 约 5600 m² |

Blender 4.3.2 中的步骤，对 140 个对象一起操作：

1. 新建 UV 层 `Lightmap`，设为当前编辑层。渲染用的 UV 层仍然是 `UVMap`。
2. 多对象编辑模式下全选，执行 `uv.smart_project(angle_limit=5°, island_margin=0)`。
3. 执行 `uv.average_islands_scale()`，让所有对象的像素密度一致。
4. 执行 `uv.pack_islands(rotate_method='CARDINAL', margin_method='FRACTION', margin=3/2048, shape_method='AABB')`。
5. 导出 GLB，第二层 UV 会被写成 `TEXCOORD_1`。

实测结果：

- UV 展开加打包耗时 0.4 秒，导出耗时 1 秒
- 2048 atlas 的覆盖率是 30%，每格方块边长约 5.2 个像素。像素数不多，但 lightmap 只存间接光，够用
- 只允许 90° 旋转时，矩形 UV 面之间重叠为 0
- 导出文件和原 `map.glb` 相比，网格、材质、透明模式（141 个 OPAQUE、54 个 MASK）、贴图、采样器都一致；顶点多 1070 个，来自新 UV 的接缝拆分

### 天空光补偿

`VXGIVolume` 只注入直接光源，不包含天空和背景。锥追踪器 `createConeTracer` 会给每条锥返回 `{ color, alpha }`，锥离开体积后不再累积，所以 `1 - alpha` 就是这个方向的天空可见度。

`skyVxgiIrradiance` 改写 `gather` 的循环，每条锥的结果变为：

```
cone.color + (1 - cone.alpha) * sky(direction) * skyIntensity
```

`sky(direction)` 用 `pmremTexture(skyTexture)` 采样，粗糙度按锥的半角（20°）匹配。这样被墙挡住的室内自然变暗，户外背光面能得到天空的蓝色环境光。

天空图来源：`public/hdr/skybox-day.png`。它是 4096×2048 的等距柱状投影图，8 位调色板格式，不是真 HDR：

- 漫反射天空光只需要低频颜色，PMREM 模糊后色带看不出来，精度够用
- 亮度没有物理意义，靠 `skyIntensity` 调整
- 太阳圆盘最亮只到 1.0，和天空亮度接近，不会和 `DirectionalLight` 重复计算；`DirectionalLight` 的方向对齐图里太阳的位置
- `skybox-night.png` 可以用于夜晚，但 lightmap 是静态的，昼夜要分别烘焙

已知局限：天空光照到地面后再反弹的二次天空光不会被计算，因为 VXGI 体积里没有天空光。

运行时不设置 `scene.environment`，否则所有材质都会再加一份漫反射环境光，和 lightmap 重复。

如果这个方案效果不好，就回退为用 `LightProbeGrid` 作为 lightmap 的烘焙光源，它会自动包含天空。

### Probe 只作用于没有 lightmap 的网格（需要先验证）

`LightProbeGrid` 是一个 Light，加到场景里会作用于所有受光材质，这会让有 lightmap 的网格重复计算间接光。候选做法有两个：

1. 不把 grid 加入场景。在没有 `uv1` 的网格和动态物体的材质上，通过 `builtinGIContext` 和 `lightProbeGridIrradiance` 单独注入。
2. 把 grid 加入场景，然后查清 r187 中 lightmap 和 probe 的叠加规则。

先验证第 1 种。

### Probe 网格范围

`probeBox` 只覆盖玩家能活动的高度范围，不覆盖整张地图的高度。间距约 4 格，按 149 × 16 × 115 的范围算，大约 37 × 4 × 29 ≈ 4300 个探针。

## AA 切换

`setAA('smaa' | 'traa')` 释放旧管线并用 `buildPipeline` 重建。两种模式的场景 pass 都设 `samples: 0`；只有 TRAA 模式才输出 velocity。

## 错误处理

- LUT 加载失败：`console.warn`，管线不含 LUT 节点继续运行
- 网格没有 `uv1`：不报错，按规则走 probe
- WebGPU 不可用：沿用 `main.js` 现有提示

## 验证

- 在浏览器里截图对比：SMAA 与 TRAA，AO 开与关，lightmap 开与关，有无天空光补偿
- 记录 VXGI 更新耗时、lightmap 累积到 64 个样本的总耗时
- 用调试视图直接显示 lightmap，检查 UV 接缝处有没有漏色或黑边
- 对比地毯这类被划到 probe 组的物件，和周围有 lightmap 的地面亮度是否一致
- 控制台无报错与警告
- 用 GPU timing 分析各 pass 耗时
- 构建通过：`pnpm build`
