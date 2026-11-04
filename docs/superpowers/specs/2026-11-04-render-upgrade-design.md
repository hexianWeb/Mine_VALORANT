# Render 层升级设计

日期：2026-11-04
three 版本：r187。实现前对齐依赖与锁文件，保证冻结安装可复现。

本次确定采用 Blender 离线烘焙静态光照、局部 SH 探针和少量实时灯光。第一阶段集中在练枪房、门口和相连长廊，让已有体素资产获得更自然的光影和材质表现，再扩展覆盖范围。

这是目标设计。现有成果包括带第二套 UV 的地图、Blender 窗光和三个离线探针的路线小样，正式光照贴图与完整 render system 尚待实现。探针小样的文件与复跑步骤见 [练枪房离线探针接入与验证](./2026-11-04-range-probe-validation.md)。

## 目标

把 `src/engine/systems/render/` 从 TODO 占位升级为完整 render 系统，为 PC 独显上的 Minecraft 风格战术射击游戏（类 Valorant）服务：

- 静态照明：Blender 烘焙 lightmap，随地图加载，优先保障练枪房和走廊的贴图精度
- 动态物体照明：加载离线 L2 SH 探针，按区域与空间位置插值
- 实时照明：太阳及阴影、必要的动态灯光，与离线贡献明确分工
- GTAO
- 抗锯齿：SMAA / TRAA 代码内可切换
- `RenderPipeline` 节点后处理管线
- Tone mapping：Khronos PBR Neutral
- Color grading：3D LUT，先用 identity 建立中性基准，再调写实方向的颜色
- 材质与反射：检查粗糙度、法线与环境反射，让静态环境和人物的光照一致

## 非目标

- 第一版不接入 VXGI、运行时 `LightMapper` 或全图 `LightProbeGrid.bake()`。加载阶段只读取已导出的照明资产
- 不在第一版解决连续昼夜变化、建筑破坏后的 GI 更新。固定光照或几何变更后重烘受影响区域
- 暂不接入 Clustered Lighting，待实时灯数量与 GPU 测量表明确有需要时再评估
- 不加任何调参面板（见 `.cursor/rules/no-lookdev-panels.mdc`），所有参数写在代码里
- 保留 `main.js` 中现有 Tweakpane，替换天空背景时只做必要的类型兼容调整
- 不做设备丢失恢复

## 模块

所有代码位于 `src/engine/systems/render/`。

| 文件 | 职责 | 依赖 |
|---|---|---|
| `index.js` | `createRenderSystem({ engine, canvas, scene, camera, aa })`：创建并初始化 renderer，订阅 resize，先更新动态对象的探针取样再渲染。对外暴露 `setAA(mode)`、异步 `loadLighting({ mapRoot, manifestUrl })` 及动态受光对象的注册与注销接口。负责释放本系统创建的资源。 | pipeline.js, gi.js, lut.js |
| `pipeline.js` | `buildPipeline(renderer, scene, camera, { aa, lut })` → `RenderPipeline`。只负责节点连线。 | three/tsl, GTAONode, DenoiseNode, TRAANode, SMAANode, Lut3DNode |
| `gi.js` | 读取照明 manifest，检查地图版本、变换和 lightmap 绑定，为静态接收面挂载贴图，为探针接收对象建立独立受光路径。返回加载结果以及 `update()`、`dispose()`。共享贴图遵循 ResourceManager 的资源所有权。 | EXRLoader, probe-field.js, three/tsl |
| `probe-field.js` | 读取探针与三维区域，按对象的取样点选择同区及允许相连区域的探针，连续混合 SH。处理门口、台阶和边界回退，不依赖测试路线的里程。 | SphericalHarmonics3, three/tsl |
| `lut.js` | `loadLut(url)` → `{ texture3D, size }`，按扩展名选 `LUTCubeLoader` 或 `LUTImageLoader`。 | LUT loaders |

上述接口和下列新增资源路径为实现约定。现有 GLB 的 `TEXCOORD_1` 只证明 UV 已导出，不代表已有可用的烘焙光照贴图。

资源与工具：

- `public/luts/neutral.cube`：33³，首版使用 identity，之后根据中性基准制作克制的调色版本
- `public/luts/identity.png`：identity 条带，供 PS / DaVinci 调色后替换
- `tools/gen_luts.mjs`：生成上述两个文件的 Node 脚本
- `tools/add_lightmap_uv.py`：固化第二套 UV 的生成和分区打包，在 MCprep 导出前运行
- `tools/bake_map_lighting.py`：在 Blender 中按区域烘焙，导出线性 lightmap、探针及版本信息，支持只重烘受影响区域
- `public/model/map_lightmap.glb`：已有 UV 试验产物，正式分区后按需要重新导出
- `public/lighting/range/manifest.json`：地图版本、变换、照明版本、贴图绑定、探针和区域数据引用
- `public/lighting/range/lightmaps/`：首版使用线性 EXR 保存照明，压缩格式在画质基准成立后另行评估
- `public/probes/range-probes.json`：正式探针入口。现有三点 JSON 先用于回归验证，需补充区域与光照贡献约定后再作为正式资产
- Blender 源文件和原始全景 EXR 留在制作资产目录，游戏仅加载运行需要的文件

`main.js` 改动：

- 用 `createRenderSystem` 替换现有 renderer 创建、resize 监听、render system 三段
- 加载 `public/model/map_lightmap.glb` 作为静态地图
- `scene.background` 设为 `public/hdr/skybox-day.png`（等距柱状投影，`SRGBColorSpace`）
- 对已获得 lightmap 或 probe 的物体移除测试用 `HemisphereLight` 贡献，未覆盖区域使用明确声明的临时回退
- 地图加载后调用一次 `loadLighting(...)`，校验完成后再开放可验收区域
- 天空纹理与现有背景颜色回调兼容，避免继续对纹理调用 `Color.set()`

## 资产制作与进图流程

```text
Blender 制作阶段
  固定地图、材质、天空、太阳和窗洞补光
  → 按接收表面分区，生成或调整第二套 UV
  → 烘焙静态光照贴图，同时捕获区域内探针
  → 导出线性照明、SH、区域连接关系与版本 manifest

游戏加载阶段
  初始化 renderer，加载地图、天空与 LUT
  → 加载 manifest，检查地图、UV、坐标和灯光版本
  → 绑定静态 lightmap，建立局部探针取样与实时灯
  → 进入每帧渲染
```

制作阶段可以只输出门口样板。其余区域的临时照明需要明确标记，不能据此宣称整图已完成或把未覆盖区域纳入样板画质结论。

## 每帧数据流

```
更新动态对象的区域与 SH 权重
prePass(depth + normal, 保留 alphaTest、裁剪和顶点变形)
  └─ GTAO（resolutionScale 0.5）
       ├─ SMAA 模式：denoise(ao, depth, normal, camera)
       └─ TRAA 模式：useTemporalFiltering = true
scenePass(samples: 0)
  contextNode = builtinAOContext(ao)      // 作用于渲染器的间接光通道
  静态接收面：material.lightMap 提供离线漫反射照明
  指定的细碎物件和动态物体：局部 SH 提供环境漫反射照明
  实时直接光：太阳 DirectionalLight、必要动态灯和阴影
  反射：独立校验镜面环境贡献，避免再叠加同源漫反射
  TRAA 模式：MRT { output, velocity } → traa(output, depth, velocity, camera)   // HDR
renderOutput(color)                        // outputColorTransform = false；Neutral tone mapping + 曝光 + sRGB
lut3D(color, lut, size, intensity)         // LDR / sRGB
SMAA 模式：smaa(color)                     // 最终 LDR
```

初始参数与调优边界（写在代码中）：

- `renderer.toneMapping = NeutralToneMapping`，`toneMappingExposure = 1.0`
- GTAO：`resolutionScale = 0.5`，其余用默认值，实现时按画面调整
- LUT：先使用 identity，正式调色在光照和曝光验收之后进行
- AA：先用 SMAA 建立静态与移动基准，再验收 TRAA
- Probe：现有小样为 `512 × 256` 全景、Cycles `96` samples、L2 的 `9 × RGB` 系数；后续按收敛情况调整离线采样
- lightmap 尺寸、探针数量和间距按区域验收确定，不沿用全图单张 `2048` 和约 `4300` 个探针的假定

使用 `material.lightMap` 的离线固定补光也会进入间接光通道并受到 AO 调制。因此先关闭 GTAO 验证烘焙，之后从温和强度开启，检查门洞与墙角是否重复压暗。

## GI 设计

### 目标地图 `public/model/map.glb`（实测）

- 201 个网格，201 个材质，约 16 万三角面、31 万顶点
- 原文件没有 `uv1`；另有带第二套 UV 的 `map_lightmap.glb`
- 所有节点带绕 X 轴 90° 的旋转。换算后的世界尺寸约为 149 × 53 × 115（X × Y × Z），按 1 单位 = 1 格计
- `map_lightmap.glb` 的地图整体比 `map.glb` 高约 `2.1763` 单位，现有探针 JSON 已分别记录两版坐标

### 光照贡献与接收对象

| 贡献 | 静态接收面 | 人物与探针接收物体 |
|---|---|---|
| 固定天空照明与场景反弹光 | 离线 lightmap | 离线 SH |
| 固定窗洞补光 | 直接漫反射与反弹贡献烘入 lightmap | SH 近似柔和照明，所需动态明暗细节单独验收 |
| 太阳直接光 | 实时太阳与阴影，lightmap 排除这份直射贡献 | 实时太阳与阴影，probe 排除同源直接贡献 |
| 枪口闪光等动态灯 | 实时 | 实时 |
| 镜面高光与环境反射 | 材质与反射路径 | 材质与反射路径 |

太阳照到墙面后形成的反弹仍需进入离线数据，不能通过在烘焙时关闭整盏太阳来排除直射。天空图中的太阳亮斑也要明确归属。现有三点小样没有完成全部光源拆分验收，正式导出时用逐光源开关对照确认没有重复计光。

SH 只表达低频漫反射，不能提供清晰的窗框投影、镜面反射或人物对固定补光的动态遮挡。若样板证明这些细节影响人物融入环境，再引入少量有明确用途的实时灯。被替代的离线直接贡献必须同步移除或限制接收对象，不能简单叠加。

静态面按 manifest 中的绑定使用 lightmap，同时具有 `uv1` 和有效贴图才算绑定成功。没有绑定的物件只有在探针覆盖有效时才使用 SH。初期可按单个人物取样点混合系数，并通过独立 `lightsNode` 等材质受光路径接入，避免全局探针照亮已有 lightmap 的表面。该路径仍需保留实时太阳与动态灯。不同人物的系数状态独立，共享材质时避免相互覆盖。

跨房间的大型合并网格不能只用整个网格中心选一个探针。应在离线阶段按区域拆分接收面，或在材质中按表面世界位置取样。拆分带来的 draw call 增量需要一并记录。

### Lightmap UV（Blender 离线展开，已试验）

运行时不调用 `unwrapUVs`，改为在 Blender 里离线生成第二层 UV，随 glb 一起导出。

原 UV 试验按平均每个面的面积小于 `0.4 m²` 筛出细碎物件，得到以下分组。该规则用于初筛，正式分配结合画面检查；贴地地毯、台阶边缘等处尤其需要检查与周围 lightmap 表面的亮度是否一致。

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
- 2048 atlas 的覆盖率是 30%，每格方块边长约 5.2 个像素。这是原全图试验结果，不能视为门洞和台阶细节已经达标
- 只允许 90° 旋转时，矩形 UV 面之间重叠为 0
- 原 UV 试验保持了材质、透明模式、贴图和采样器，顶点多 1070 个，来自新 UV 的接缝拆分

正式烘焙优先给练枪房和走廊分配 atlas 空间。一个材质或对象可能分布在全图，需要按实际接收面分区，不能仅按对象名称分配一张区域贴图。按最终分辨率和 mip 使用情况设置 padding、扩边与滤波，检查接缝、漏色及远处闪烁。

### 线性数据与导出约定

- lightmap 保存照明，排除接收面的基础颜色、显示曝光、AgX、LUT 和额外 AO。场景材质造成的真实反弹色仍需保留
- Three.js 的 lightmap 输入是未除以 π 的线性漫反射 irradiance。Blender 导出的 pass 按其实际含义转换，用白色漫反射测试面校准单位与 π 因子，不能把 Combined 彩色成片直接挂到 `lightMap`
- lightmap 通过第二套 UV 采样，明确设置纹理通道、线性色彩空间及与 GLB 一致的纵向方向。验证时同时检查非对称测试图案，避免翻转仍误判为采光差异
- probe 保存线性 RGB 的 L2 radiance 系数，顺序与 `SphericalHarmonics3` 一致。运行时再求 irradiance，卷积只做一次
- manifest 记录 schema、地图与照明版本、接收面标识、atlas 与 UV 通道、光源分工、probe 区域和坐标约定。模型、贴图和探针必须来自匹配的导出版本
- Blender 到 Three.js 的轴变换与 SH 方向保持一致。整体旋转地图时，同步转换采样位置和法线，或旋转 SH，不能只移动探针点。现有两版地图的高度偏移仅作兼容数据，正式资产使用统一坐标
- 灯光、天空、材质或遮挡几何改变后，重烘受影响区域及其相邻过渡样本，并更新版本。白模、标记、测试人偶从烘焙中排除

### 局部探针范围与过渡

白模覆盖练枪房内的活动空间、门口、台阶和相连长廊，作为三维布点范围。探针位置需要落在空旷处，避开墙体和天花板。胸口示例线只是首轮采样位置，相机眼睛高度独立设置，正式探针无需与相机齐平。

区域数据包含体积边界、探针位置和可连通的门洞或重叠过渡区。首版采用少量局部区域与平滑权重，只混合同区及允许相连区域的点，避免因直线距离近而跨墙混光。沿台阶跟随地面高度，在门洞、转角和明暗变化处加密。需要覆盖低处或高处接收物体时再增加采样层，不能把整个人体或全部物件的照明等同于胸口一条线。

正式取样由三维位置决定。走出某区时在预留过渡带内平滑接续，离开全部已烘焙区域时使用声明的回退照明。不能硬切最近探针，也不能在未知区域无限外推室内光照。

现有三个探针仅证明既定路线上的 SH 混合可行。小样按路线里程插值、背景使用测试灯光，因此既不证明自由移动的区域选择正确，也不证明地图静态照明已经与人物匹配。保留小样作为回归用例，正式验收增加横向移动、转身、蹲起、台阶和区域边界测试。

### 天空与反射

`public/hdr/skybox-day.png` 可继续作为背景，它是 8 位等距柱状投影图，不能自动视为具有可靠亮度的 HDR 光源。Blender 中使用的天空与游戏背景需对齐方向和观感，照明强度随烘焙版本记录。切换昼夜场景需要匹配的照明资产。

写实感还依赖粗糙度、法线及镜面反射。SH 不承担反射，后续用少量区域环境贴图和 PMREM 验证镜面贡献。直接设置 `scene.environment` 可能同时添加环境漫反射，需要通过材质节点分离或替换同源贡献，并用灰色漫反射面和金属球分别检查。镜面路径的实现以小样验收为准，不假设默认环境贴图可以无条件叠加。

## AA 切换

`setAA('smaa' | 'traa')` 释放旧管线及其拥有的 pass、历史缓冲和 render target，再用 `buildPipeline` 重建。两种模式的场景 pass 都设 `samples: 0`；只有 TRAA 模式才输出 velocity。resize、相机切换及照明资产切换后重置时序历史，检查动画与透明裁剪对象的深度、法线和速度一致性。

## 错误处理

- LUT 加载失败：`console.warn`，管线不含 LUT 节点继续运行
- 已声明的 lightmap 缺失、UV 不匹配、地图或照明版本不符：给出明确诊断，该区域不能通过验收
- 无 lightmap 的对象：在有效区域内使用 probe，否则使用明确配置的回退，避免默默变黑或采到隔墙数据
- 探针数据为空、系数非有限数或区域无法匹配：记录原因并回退，不触发运行时全图烘焙
- WebGPU 不可用：沿用 `main.js` 现有提示

## 实施顺序与验收

1. 对齐依赖与锁文件，验证冻结安装。建立最小 render system 和实际地图的固定机位，记录目标机器、分辨率、帧耗时与加载基准。
2. 完成门口样板。先接静态 lightmap 和必要实时光，再放入使用 SH 的人偶。关闭 GTAO、使用 identity LUT 和固定曝光。校准 Blender 与 Three.js 的色彩管理，统一显示变换或比较线性数据，避免把 AgX 与 PBR Neutral 的差别误判为烘焙错误。
3. 扩展到练枪房和长廊。补充局部探针、三维区域和门洞过渡，验收自由移动及静态面与人物的亮度一致性。其他区域使用已声明的回退，另行安排扩展。
4. 接入 GTAO、SMAA / TRAA、色调映射与 LUT，逐项对照。再完善材质粗糙度、法线和必要反射，检查改善是否值得对应的 GPU 成本。

门口样板至少通过以下检查后，再扩大烘焙范围：

- 墙面、台阶、窗洞的明暗方向与 Blender 一致，光照数据未烘入接收面的底色、曝光或调色
- 逐光源开关验证太阳、天空、固定补光和反射的分工，灰色测试面没有重复增亮
- 查看 lightmap 本身及最终画面，确认 UV 无重叠漏色、翻转、明显接缝或滤波黑边
- 同一人物在门口附近缓慢移动、横移与改变高度时无开关式明暗变化，跨墙区域不互相染色
- 对比地毯等 probe 接收物与周围 lightmap 表面，确认没有明显亮度断层
- 后续开启 GTAO 时，门洞和墙角不被过度压暗；两种 AA 分别检查静态边缘、移动拖影和透明裁剪物

性能检查分别记录资产大小、下载与解码耗时、纹理和历史缓冲显存、draw call、探针更新 CPU 耗时及各 pass 的 GPU 耗时。先在明确的机器、分辨率和目标帧率下建立预算，再判断是否达标；三个探针的路线结果不代表整套管线的性能。

代码实现阶段需通过 `pnpm build`，控制台无未处理错误，新增诊断能定位到相应资产。原探针回归数据与新样板截图分开保存，方便区分插值正确性和最终画质。
