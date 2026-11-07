# 单张 Lightmap 试验记录（方案已否决）

状态：2026-11-05 用户检查导出 atlas 后否决此方案。以下只保留试验过程。当前渲染以 [练枪房实施与验证记录](./range-room-v3-implementation.md) 为准。

复核结果：97 个地块、约 40,224 m² 表面积、43,871 个 UV 岛；2048² atlas 的实际表面覆盖率仅 14.65%，面积加权光照密度约 3.91 texel/m。文件格式、亮度换算和单视角预览验证不足以证明整图画质合格。本资源集仅作为失败试验及亮度/坐标协议的参考。

日期：2026-11-04
修订：2026-11-05，静态 GI 改为 Blender 离线烘焙，并导出光照 info。
three 版本：r187（无需升级，所需 addon 均已内置）

本次实际烘焙使用用户当前 Blender 布光：纯色 World、1 盏 Sun、7 盏区域补光及地块自发光。用户已确认区域补光一并烘焙。实际产物为 `public/model/map_day.glb`、`public/lightmaps/map_day.exr`、`public/lighting/map_day.lighting.json`；下文天空图版本仍是资源协议示例，当前参数以导出的 info 为准。

## 目标

把 `src/engine/systems/render/` 从 TODO 占位升级为完整 render 系统，为 PC 独显上的 Minecraft 风格战术射击游戏（类 Valorant）服务：

- GI：静态地块在 Blender / Cycles 中离线烘焙 lightmap，Three.js 加载成品；细碎物件和动态物体用 `LightProbeGrid`
- 光照同步：烘焙时导出 `map_day.lighting.json`，作为 Three.js 的太阳、天空、lightmap 绑定和坐标约定的统一来源
- GTAO
- 抗锯齿：SMAA / TRAA 代码内可切换
- `RenderPipeline` 节点后处理管线
- Tone mapping：Khronos PBR Neutral
- Color grading：3D LUT

## 非目标

- 不在浏览器中执行 VXGI 或 LightMapper；静态地图的间接光直接加载离线资源
- 不做实时动态 GI；地图几何、太阳或天空变化后，重新离线烘焙对应光照版本
- 不加任何调参面板（见 `.cursor/rules/no-lookdev-panels.mdc`）；渲染参数写在代码里，烘焙关联参数由光照 info 驱动
- 不改 `main.js` 中现有 Tweakpane
- 不做设备丢失恢复

## 模块

所有代码位于 `src/engine/systems/render/`。

| 文件 | 职责 | 依赖 |
|---|---|---|
| `index.js` | `createRenderSystem({ engine, canvas, scene, camera, aa })`：创建并 `init()` WebGPURenderer；订阅 `engine.size` resize；`update()` 调 `pipeline.render()`；`dispose()` 释放 renderer、pipeline、GI 资源、天空及 LUT 纹理。对外暴露 `setAA(mode)`、异步 `loadGI({ mapRoot, infoUrl })`、`attachProbeGI(object)`。 | pipeline.js, lighting-info.js, gi.js, lut.js |
| `pipeline.js` | `buildPipeline(renderer, scene, camera, { aa, lut })` → `RenderPipeline`。只负责节点连线。 | three/tsl, GTAONode, DenoiseNode, TRAANode, SMAANode, Lut3DNode |
| `lighting-info.js` | 加载光照 info，校验资源绑定与坐标约定；依据导出的方向、线性颜色和强度设置太阳，加载天空并应用其旋转、强度，设置曝光。 | DirectionalLight, TextureLoader |
| `gi.js` | 按 info 的对象角色加载并绑定 EXR lightmap。地块光照就绪后，临时屏蔽细碎物件和动态物体，在指定范围捕获一次 `LightProbeGrid`，再恢复可见性并为 probe 组绑定材质级 GI。提供动态物体的 `attachProbeGI(object)` 和资源 `dispose()`。 | EXRLoader, LightProbeGrid, lightProbeGridIrradiance, three/tsl |
| `lut.js` | `loadLut(url)` → `{ texture3D, size }`，按扩展名选 `LUTCubeLoader` 或 `LUTImageLoader`。 | LUT loaders |

资源与工具（除标注已有的文件外，均为待实现/生成）：

- `public/luts/stylized.cube`：33³，暗部偏青、亮部偏暖、轻微提饱和
- `public/luts/identity.png`：identity 条带，供 PS / DaVinci 调色后替换
- `tools/gen_luts.mjs`：生成上述两个文件的 Node 脚本
- `tools/add_lightmap_uv.py`：Blender 脚本，把下文"Lightmap UV"一节的试验步骤固化下来，复用已有合格 UV 时无需重新展开
- `tools/bake_map_lightmap.py`：Blender 离线工具，使用已有 `Lightmap` UV，按对象角色屏蔽细碎物件，分离天空/太阳烘焙，导出 EXR 与光照 info；完整恢复源场景状态后导出包含全部对象的 GLB
- `public/model/map_lightmap.glb`：已有 UV 试验产物，带 `TEXCOORD_1`；正式导出需增加对象角色和稳定 ID
- `public/lightmaps/map_day.exr`：地块间接光，half-float、scene-linear，具体存储语义见下文
- `public/lighting/map_day.lighting.json`：与 GLB、EXR 成套导出的光照 info

试验工具为 `tools/bake_map_lightmap.py` 和 `tools/verify_lightmap.mjs`。前者实现本次单 atlas 试验，后者只检查二进制资源和数值契约，不代表画质验收通过。

`main.js` 改动：

- 用 `createRenderSystem` 替换现有 renderer 创建、resize 监听、render system 三段
- 加载 `public/model/map_lightmap.glb` 作为静态地图
- 从 info 设置太阳与天空；日间默认天空为 `public/hdr/skybox-day.png`（等距柱状投影，`SRGBColorSpace`）
- 移除 `HemisphereLight`（环境光改由 lightmap 和 probe 提供，避免重复计算）
- 地图加载后调用一次 `loadGI({ mapRoot, infoUrl: '/lighting/map_day.lighting.json' })`
- 后续创建的角色等动态物体调用 `attachProbeGI(object)`，按位置读取同一份探针光照

## 每帧数据流

```
prePass(depth + normal, 低开销材质)
  └─ GTAO（resolutionScale 0.5）
       ├─ SMAA 模式：denoise(ao, depth, normal, camera)
       └─ TRAA 模式：useTemporalFiltering = true
scenePass(samples: 0)
  contextNode = builtinAOContext(ao)      // AO 只压间接光
  info 标记为 terrain 的静态网格：material.lightMap 提供间接漫反射
  细碎物件和动态物体：LightProbeGrid 提供间接漫反射
  直接光（太阳 DirectionalLight + 阴影）保持实时
  TRAA 模式：MRT { output, velocity } → traa(output, depth, velocity, camera)   // HDR
renderOutput(color)                        // outputColorTransform = false；Neutral tone mapping + 曝光 + sRGB
lut3D(color, lut, size, intensity)         // LDR / sRGB
SMAA 模式：smaa(color)                     // 最终 LDR
```

固定参数（后处理写在代码中，光照相关值写入导出的 info）：

- `renderer.toneMapping = NeutralToneMapping`，`toneMappingExposure = 1.0`
- GTAO：`resolutionScale = 0.5`，其余用默认值，实现时按画面调整
- LUT intensity：`1.0`
- Probe 捕获：`cubemapSize: 16`，`bounces: 0`；捕获时地块已经包含离线 GI，避免再次反馈同一份间接光
- Cycles：atlas `2048`，初始 `256` samples，`4` diffuse bounces（总 bounce 上限不小于该值）；这些是起始配置，效果验证后固定并记录
- 天空强度：以 Blender 烘焙设置及统一亮度换算为准，导出后 Three.js 读取同一值

## GI 设计

### 方案决策：离线烘焙替代加载时 VXGI

原方案选择 VXGI + LightMapper，是为了让浏览器仅凭地图和光源即可自行生成 lightmap。既然地图静态、已有 Blender 资产流程和第二套 UV，就采用 Cycles 离线路径追踪：烘焙时间移到资产制作阶段，运行时直接加载固定结果。

这样可以提高反弹光质量、减少体素漏光，并自然计算天空照亮表面后的后续反弹；也省去每次加载时的体素化、锥追踪和 lightmap 累积。已有 UV 是保存光照的位置，Cycles 替代的是原先由 VXGI 负责的光照求解。

最终分工：

```
Blender：地块 + 太阳 + 天空
  └─ Cycles 离线烘焙 → GLB + lightmap.exr + lighting.json

Three.js：读取 lighting.json
  ├─ 恢复太阳、天空与资源绑定
  ├─ 地块：离线 lightmap + 实时太阳直射/阴影
  └─ 捕获已照亮的地块和天空 → LightProbeGrid → 细碎物件/动态角色
```

### 目标地图 `public/model/map.glb`（实测）

- 201 个网格，201 个材质，约 16 万三角面、31 万顶点
- 原文件没有 `uv1`；已有 `map_lightmap.glb` 包含离线展开的第二套 UV
- 所有节点带绕 X 轴 90° 的旋转。换算后的世界尺寸约为 149 × 53 × 115（X × Y × Z），按 1 单位 = 1 格计
- 导出光源方向时使用与 GLB 一致的世界坐标转换，不能再次套用模型节点内部的 90° 旋转

### 静态和动态分开

| | 静态地块 | 树叶、栅栏等细碎物件和动态物体 |
|---|---|---|
| 判定规则 | info 中 `role: terrain`，且有 `uv1` | info 中 `role: detail`，或运行时动态对象 |
| 间接光来源 | lightmap | `LightProbeGrid` |
| 烘焙光源 | Cycles：天空照明 + 太阳反弹光 | 捕获已应用 lightmap 的地块、实时太阳照亮的表面以及天空 |
| 运行时开销 | 每像素采样一次 lightmap | r187 对 SH atlas 进行 7 次 3D 纹理采样，再求值球谐光照 |

角色移动时读取静态空间光照场，不重新计算 GI。细碎物件走 probe，避免占用大量零碎 atlas 区域。

### 烘焙对象与屏蔽规则

烘焙仅保留地形、墙面、建筑主体等地块；树叶、栅栏、铁栏杆、按钮、告示牌、灯笼、花盆、地毯等物件全部从烘焙场景屏蔽。

- 对象角色以 Blender 集合/显式标记为准；平均面面积只作为自动初筛，不能仅凭 `uv1` 或面积判定。树叶也可能由完整方形面组成，即使已有 `uv1` 仍要排除。
- 工具为对象写入稳定的 `bakeId` 和 `giRole`，随 glTF `extras` 导出；info 同时保存最终对象角色和 atlas 绑定。加载后从 `userData` 读取，处理导出器拆成多个 primitive 的情况，不依赖材质显示名称。
- 屏蔽是从所有烘焙光线路径中移除，包括投影、遮挡和反弹；仅取消选中或关闭相机可见性不够。使用独立烘焙场景/视图层，并在结束或异常时恢复源场景状态。
- 正式 GLB 保留全部对象。屏蔽只属于烘焙阶段，进入 Three.js 后细碎物件正常显示、读取 probe，并可接受和投射实时太阳阴影。
- 因为完全排除这些物件，lightmap 中也不会有树叶造成的天空遮蔽或绿色反弹；这是本次“只烘焙地块”的确定规则。

### Lightmap UV（Blender 离线展开，已试验）

运行时不调用 `unwrapUVs`，改为在 Blender 里离线生成第二层 UV，随 glb 一起导出。

原 UV 试验以平均面面积小于 0.4 m² 初筛细碎物件，得到下表。正式烘焙还要按上述角色排除树叶等对象，数量以工具实际导出的 info 为准。排除对象后可以保留 atlas 空位，不必为此次烘焙重新展开全部 UV。

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
- 2048 atlas 的覆盖率是 30%，每格方块边长约 5.2 个像素。作为间接光的起始分辨率，是否足够由烘焙后的接缝、室内漏光及近景检查决定
- 只允许 90° 旋转时，矩形 UV 面之间重叠为 0
- 导出文件和原 `map.glb` 相比，网格、材质、透明模式（141 个 OPAQUE、54 个 MASK）、贴图、采样器都一致；顶点多 1070 个，来自新 UV 的接缝拆分

### Cycles 烘焙内容：天空照明 + 太阳反弹光

lightmap 的职责是提供运行时缺少的漫反射照明：

```
lightmap = 天空直接到达表面的照明
         + 天空经过场景反弹的照明
         + 太阳经过场景反弹的照明

最终表面照明 = lightmap + 实时太阳直射（含实时阴影）
```

这里有一个关键区别：Cycles 的 Diffuse Direct 包含天空直接照到表面的光，而本项目把这部分也交给 lightmap。不能对完整场景仅勾选 Indirect，否则会丢掉户外主要的天空照明。

采用两次线性烘焙后相加：

| 烘焙 | 启用光源 | Diffuse Direct | Diffuse Indirect | Color |
|---|---|---|---|---|
| A：天空 | 仅 World 天空，关闭太阳及其他灯 | 开 | 开 | 关 |
| B：太阳反弹 | 仅 Sun，World 黑色/零强度 | 关 | 开 | 关 |

本次布光扩展：用户确认的静态区域灯及地块自发光加入 A，烘焙其对地块的直接和间接漫反射贡献；B 关闭它们，确保太阳反弹单独计算。区域灯参数另外写入 `bakedLights`，运行时不能再给 terrain 叠加同一份区域灯直射。动态物体的区域灯直接照明需单独评估，地块 lightmap 不会自动为角色提供这部分直接光。

1. 在同一套地块、原始材质和 `Lightmap` UV 上执行 A、B；按上述配置分离光源。Cycles 关闭 Fast GI，避免将间接反弹替换为 AO 近似。
2. 原材质的颜色贴图仍显式读取 `UVMap`，烘焙目标使用 `Lightmap`。每个材质设置独立的、未连接到 BSDF 的活动目标 Image Texture 节点；已有材质纹理保持用于反弹光计算。
3. Color 关闭，避免把接收面的 albedo 烘进光照后在 Three.js 再乘一次；其他表面的颜色仍参与反弹，不能把全场景材质统一换成白色。
4. A、B 各自初始化独立 atlas；逐对象烘焙时只在开始清空一次，后续不能清掉其他对象已写入的区域。
5. 在线性空间合成并转换为约定的 irradiance，然后扩边、导出；不烘入独立 AO、曝光、AgX、tone mapping 或 LUT。

太阳直射及其静态阴影也保持实时，因此细碎物件恢复可见后产生的太阳阴影不会和一份烘焙直射光叠加。

### Lightmap 文件与数值约定

- 格式：RGB half-float OpenEXR，scene-linear Rec.709 / Linear-sRGB，保留大于 1 的光照值。
- 语义：无接收面 albedo 的漫反射 irradiance；Three.js 在着色时再乘材质颜色和漫反射 BRDF。
- 去掉 Color 的漫反射烘焙结果与 Three.js 的 `lightMap` 输入不能未经确认直接等同。白色 Lambert 接收面的出射值为 `E / π`，而 r187 的 lightmap 输入是 `E`；导出前用白漫反射基准场景确认 π 因子及 Blender→运行时的统一亮度换算，并把实际比例写入 info。EXR 中已完成换算，运行时默认 `lightMapIntensity = 1`，不再重复乘 π。
- 烘焙的中间结果、太阳强度及天空强度使用同一亮度标定，不能单独拉高 lightmap 去补偿太阳或天空单位不匹配。先用纯漫反射基准确认数值，再验证实际 MCprep 材质。
- 加载使用 `EXRLoader`、`LinearSRGBColorSpace`、`texture.channel = 1`。标准化导出图像的行方向，与 glTF 导出的 UV 配套后使用 `flipY = false`；用四角不同色的测试图确认，不根据扩展名猜测翻转方式。
- 第一版采用线性过滤、禁用 mipmap。当前 UV 岛间距约 3 像素，先使用 1 像素扩边；更大的扩边或 mipmap 需要配套更宽 UV 间距，不能直接用 Blender 默认大范围 margin 覆盖邻岛。
- glTF 核心规范不提供 Three.js lightmap 的自动绑定；EXR 作为外部资源，通过 info 显式绑定。跨地块/probe 组共享的材质需要克隆，避免互相修改。

### 光照 info：与资产一起导出

文件：`public/lighting/map_day.lighting.json`。由烘焙工具从实际场景读取并生成，Three.js 不再独立手写一套太阳方向和天空参数。

以下是结构示例，方向、强度、范围和对象 ID 仅示意；正式值来自同一次资产导出与亮度标定：

```json
{
  "version": 1,
  "model": "/model/map_lightmap.glb",
  "coordinateSystem": "RH_Y_UP",
  "metersPerUnit": 1,
  "sun": {
    "directionToSun": [0.6, 0.8, 0],
    "colorLinear": [1, 1, 1],
    "intensity": 3,
    "blenderEnergy": 3,
    "angularDiameterRadians": 0.00918
  },
  "sky": {
    "url": "/hdr/skybox-day.png",
    "projection": "equirectangular",
    "colorSpace": "srgb",
    "rotationQuaternion": [0, 0, 0, 1],
    "intensity": 1
  },
  "lightmaps": [{
    "id": "terrain-day",
    "url": "/lightmaps/map_day.exr",
    "size": [2048, 2048],
    "uvChannel": 1,
    "encoding": "linear-irradiance",
    "colorSpace": "srgb-linear",
    "intensity": 1,
    "flipY": false,
    "generateMipmaps": false,
    "includes": ["sky-direct", "sky-indirect", "sun-indirect"]
  }],
  "objects": [
    { "bakeId": "terrain-example", "role": "terrain", "lightmap": "terrain-day" },
    { "bakeId": "leaves-example", "role": "detail", "lightmap": null }
  ],
  "probeGrid": {
    "min": [-74.5, 0, -57.5],
    "max": [74.5, 16, 57.5],
    "resolution": [37, 4, 29],
    "cubemapSize": 16,
    "near": 0.1,
    "far": 256,
    "bounces": 0
  },
  "bake": {
    "engine": "cycles",
    "samples": 256,
    "diffuseBounces": 4,
    "sourceToRuntimeScale": 1,
    "diffuseToIrradianceScale": 3.141592653589793,
    "excludedObjectIds": ["leaves-example"]
  },
  "display": { "toneMapping": "neutral", "exposure": 1 }
}
```

约定：

- `directionToSun` 是**从场景指向太阳**的世界空间单位向量，不是光线传播方向。Three.js 用 `light.position = target + directionToSun * distance`，把 `light.target` 加入场景；distance 用于阴影相机布置，不改变平行光照度。
- Blender Sun 沿局部 `-Z` 发光，因此先由其世界变换得到局部 `+Z` 对应的“指向太阳”方向，再应用与模型导出相同的坐标转换。标准 Z-up→Y-up 为 `(x, y, z) → (x, z, -y)`；父级变换和额外轴修正必须包含在最终转换里。
- info 的向量、探针范围都已是最终 Three.js 世界坐标。第一版按 GLB 导出位置加载，不再独立居中、缩放或旋转地图；若资产流程增加根变换，光源、天空与探针范围必须同步转换。
- `rotationQuaternion` 使用 `[x, y, z, w]`，表达最终 Three.js `scene.backgroundRotation` 的旋转约定；由工具转换成该约定，不能原样复制 Blender World Mapping 节点的欧拉角。要验证等距柱状图的接缝、水平朝向及六个轴方向。
- 天空图 sRGB 解码后才参与光照。`sky.intensity` 对应经过统一标定的 World 强度，并用于 `scene.backgroundIntensity` 和 probe 捕获。当前 `skybox-day.png` 是 4096×2048 的 LDR 天空，亮度是艺术设定值；两端使用同一文件、旋转和强度，太阳方向对齐图中的太阳位置。
- `sun.colorLinear` 是线性 RGB；`sun.intensity` 是最终 Three.js 强度。`blenderEnergy` 留作源设置记录，不能把 Blender 的功率单位与 Three.js 的照度单位未经标定就宣称物理等价。
- `sourceToRuntimeScale` 统一转换源光照亮度；`diffuseToIrradianceScale` 记录去 albedo 烘焙值到 irradiance 的因子。EXR 已包含两者，太阳和天空的运行时强度已包含前者，loader 不再追加转换。
- `angularDiameterRadians` 记录源太阳角直径。普通 `DirectionalLight` 没有直接等价的面积光参数，实时阴影软硬程度需单独匹配，不能承诺与 Cycles 逐像素一致。
- GLB、EXR、info 与天空文件作为同一版本发布；几何/UV、地块材质、太阳或天空改变后生成一整套新资源。昼夜使用分别烘焙的资源集。

运行时不再加 `HemisphereLight` 或漫反射 `scene.environment`，避免叠加已烘焙的天空光。Tone mapping 和 LUT 只作用于最后显示；比较两端光照时先比线性结果，不能拿 Blender 的 AgX 预览直接和 Three.js Neutral 的显示结果判定亮度错误。

### Probe 捕获顺序与作用范围

1. 按 info 设置太阳和天空，并给地块完整绑定离线 lightmap。
2. 在独立捕获场景或临时可见性范围内，只保留地块、太阳和天空；屏蔽细碎物件、角色和其他动态对象，和 Blender 烘焙角色规则一致。
3. 更新覆盖捕获区域的太阳阴影，直接捕获线性 HDR 场景；不经过 GTAO、tone mapping、LUT 或抗锯齿后处理。
4. `grid.bake(renderer, scene, { cubemapSize: 16, near, far, bounces: 0 })` 捕获一次，near/far 从 info 读取，并保证 far 覆盖探针可见的地图范围。这里的 `0` 表示不追加探针反馈轮次；被捕获的地块本来就已有完整离线反弹光。原设计的 `bounces: 1` 不再沿用，避免在 lightmap 之上重复反馈。
5. 恢复所有对象，并对 detail 组及动态对象注入 `lightProbeGridIrradiance`。探针本体不作为全局 Light 加入正常渲染场景。

r187 的 lightmap、probe 和材质 GI 都可相加，并不会自动互斥；必须按对象角色显式选择来源。材质级 GI 采用 context 的 `getGI` 注入，并保留场景 pass 的 `getAO`，集成时验证两组材质的 AO 行为一致。不能直接假定 `builtinGIContext` 只是普通加光，因为它还有抵消 GI 所受 AO 的逻辑。

每次加载仍需捕获一次 probe；静态地块的 lightmap 已彻底改为离线资源。probe 是低频近似，约 4 格间距在薄墙附近的漏光和细碎物件/地块亮度差仍需实测。

### Probe 网格范围

`probeGrid.min/max` 只覆盖玩家能活动的高度范围，不覆盖整张地图的高度。间距约 4 格，按 149 × 16 × 115 的范围算，大约 37 × 4 × 29 ≈ 4300 个探针。实际范围由关卡可活动区域确定并随 info 导出。

## AA 切换

`setAA('smaa' | 'traa')` 释放旧管线并用 `buildPipeline` 重建。两种模式的场景 pass 都设 `samples: 0`；只有 TRAA 模式才输出 velocity。

## 错误处理

- LUT 加载失败：`console.warn`，管线不含 LUT 节点继续运行
- detail 组没有 `uv1`：正常走 probe
- terrain 组没有 `uv1`、info 绑定对象缺失或 lightmap 加载失败：报告对应资源/对象的加载错误，避免显示错误光照的地图
- WebGPU 不可用：沿用 `main.js` 现有提示

## 验证

- 在白漫反射基准场景中分别验证纯天空、纯太阳直射及太阳反弹，确认 irradiance 换算、亮度标定和无重复直射；正式烘焙前完成
- 检查烘焙时树叶、栅栏等全部被屏蔽，完成/异常后源场景可见性恢复，GLB 导出保留全部对象
- 验证 info 的太阳方向、天空太阳位置、坐标轴与地图阴影朝向一致；用六轴天空图和四角色块验证天空/EXR 的旋转与翻转
- 对比 Blender 与 Three.js 的线性光照结果；显示效果另按 Neutral、曝光与 LUT 检查
- 在浏览器里截图对比：SMAA 与 TRAA，AO 开与关，lightmap 开与关
- 记录离线烘焙时间、资源大小、浏览器加载时间与 probe 捕获时间
- 用调试视图直接显示 lightmap，检查 UV 接缝处有没有漏色或黑边
- 对比地毯这类被划到 probe 组的物件，和周围有 lightmap 的地面亮度是否一致
- 控制台无报错与警告
- 用 GPU timing 分析各 pass 耗时
- 构建通过：`pnpm build`
