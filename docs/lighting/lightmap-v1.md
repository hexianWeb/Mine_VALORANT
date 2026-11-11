# Lightmap v1 · 预烘焙集合重烘

下文保留首版和历次交付记录。当前版本额外包含末尾所述的 **B06 增量补烘**。

## 使用与回退

- 默认首页加载 `/lighting/range-room-lightmap/manifest.json`。
- 右上角显示当前方案；点击 **切回原版** 加载 `?lighting=appearance`。
- `?lighting=lightmap` 切回新方案。切换会重新加载页面，释放上一套资源。
- 原版 `public/model/range-room.glb`、`public/lighting/range-room/` 保留，可独立校验。

## 烘焙范围与内容

只重烘 Blender **预烘焙** 集合中已存在 `BakeUV` 的 11 个对象、18 个材质分区。继续使用原来的五页 2048×2048 图集、UV 和几何。其他物体参与光照/遮挡计算，但不成为 lightmap 接收者，仍使用原有实时材质。

对象：Andesite、Block_of_Quartz、Double_Stone_Slab、Gray_Concrete、Light_Carpet、Light_Concrete、Polished_Basalt、Sandstone、Smooth_Sandstone、Stone、Stone_Slab.001。

### 修正源场景的页绑定问题

源文件内的材质历史记录显示，`Double_Stone_Slab` 与 `Stone_Slab.001` 的顶面原为 `smooth_stone`，BakeUV 位于 B05；后来 Albedo 分别改用石英、砂岩，共享材质却指向 B02/B03。首轮直接依照材质绑定烘焙，会覆盖其他对象的 UV 岛，产生深色块。

本次保留这些新 Albedo 与原 UV，为两个顶面槽建立独立材质实例并明确绑定 B05。`tools/lightmap_uv.py` 在烘焙前对 1,829 个面的 UV 三角形做 texel-center 覆盖检查，修复后交叠 texel 为 **0**。不重展 UV，不改几何。

Cycles 设置：Diffuse，Direct + Indirect 开启、Color 关闭，512 samples，4 次 diffuse bounce，12 texel margin。恢复原材质的 Principled 分支进行烘焙，不采样旧相机预览的自发光外观。使用本机 CUDA 设备；OptiX 在本机发生内核编译错误，未使用其空输出。

输出是 scene-linear Rec.709、half-float RGBA EXR；lightmap 不包含接收表面的 Albedo，不烘焙显示变换。静态几何的光照遮挡与反弹染色保留。本轮使用 512 samples 原始光照结果，未额外降噪。

## 运行时合成

```text
原始 Albedo（UV0，近处像素重建 / 远处 mip + 各向异性）
  × lightmap（UV1/BakeUV，线性/有限 mip）
  × GTAO
  → 原有 Reinhard / SMAA / LUT
```

- 这些源接收材质的 Specular IOR Level 为 0，采用 `MeshLambertNodeMaterial` 恢复 diffuse-only 响应。
- `material.lightMap` 使用显式 UV channel，并在纹理矩阵中翻转 V 一次。
- Cycles Color-off diffuse 存储单位 Albedo 出射光 `E/π`；Three 的 Lambert lightMap 输入为 irradiance，故 `lightMapIntensity = π`，抵消其 BRDF 的 `1/π`。
- 材质保留 `lights=true` 接收内置 GTAO，使用 `selectiveLights([])` 排除已烘焙的原顶灯和额外环境漫反射，避免重复加光。运行时走廊顶棚补光灯已移除。
- 本轮是 **Direct + Indirect 合并 lightmap**。Three 把该图计入间接漫反射，因此 GTAO 会调制整张 lightmap，包括已烘焙的直接漫反射。这是本次尝试的明确取舍；它不等价于仅调制间接光，也不产生动态投影。

## 资源与复现

- `public/model/range-room-lightmap.glb`
- `public/lighting/range-room-lightmap/manifest.json`：schema 4，逐 primitive 绑定、hash、BakeUV、颜色约定和完整烘焙记录。
- `public/lighting/range-room-lightmap/atlases/B01.exr` 至 `B05.exr`
- `tools/bake_range_room_lightmaps.py`：后台副本烘焙，明确集合范围与页绑定，烘焙前后比较全部导出对象的几何/UV hash。`--validate-only` 仅检查准备状态和 UV 覆盖。
- `tools/export_range_room.py --lightmap-report ...`：重新导出 GLB 和独立资产版本。

后台命令示例（`scope.json` 包含原模型完整导出对象列表与 `collection: "预烘焙"`）：

```powershell
& 'F:/Blender5.3/blender.exe' --background 'D:/opencode-temp/opencode/lightmap-bake/source-snapshot.blend' --python-exit-code 1 --python tools/bake_range_room_lightmaps.py -- --project E:/graphic/MC_VALORANT --scope D:/opencode-temp/opencode/lightmap-bake/scope.json --work D:/opencode-temp/opencode/lightmap-bake --samples 512 --device CUDA
```

导出工具拒绝覆盖已有正式资源；重做时应指定另一个项目输出目录。

```bash
npm test
npm run validate:room
node tools/validate-room-assets.mjs public/lighting/range-room/manifest.json
npm run dev
node tools/check-room-browser.mjs "http://localhost:5173/"
node tools/check-room-browser.mjs "http://localhost:5173/?lighting=appearance"
node tools/check-pipeline-browser.mjs "http://localhost:5173/"
```

临时源副本、烘焙日志与浏览器报告保存在 `D:/opencode-temp/opencode/lightmap-bake/`；修正后正式烘焙日志、数据与独立 Blender 副本在其 `corrected/` 子目录。首轮错误页绑定产物已归档到临时目录，未作为最终资源交付。

## 重烘交付时验证 · 2026-11-07

| 检查 | 实测结果 |
|---|---|
| 最终 CUDA 重烘 | **254.50 秒**，11 对象、5 页均非空且数值有限 |
| UV 占用 | 1,829 个面，重叠 texel **0** |
| GLB / atlas SHA-256 与绑定 | 通过；135 mesh 节点、199 primitives、47,596 triangles；18 lightmap、178 realtime、3 emissive |
| GLB 接收者几何 | POSITION、NORMAL、UV0、UV1 与旧导出逐字节一致 |
| 透明分类 | 111 OPAQUE、35 MASK、4 BLEND；新增 2 个 OPAQUE 是独立 B05 材质实例 |
| Node 测试 | **28/28 通过** |
| 本轮修改 ESLint / diff check / 生产构建 | 通过；构建仍有 Three.js 大 chunk 提示 |
| 新方案生产浏览器 | `passed: true`、`errors: []`、Three.js warning 0；Worker、面板、LUT、走廊、移动、resize/dispose 通过 |
| 原版回退浏览器 | `passed: true`、`errors: []`，旧完整外观 AO 差值保持 **0** |
| 新 lightmap AO 开关 | 参考机位采样最大线性 HDR 差 **0.01712036**，确认墙地面实际接收 AO |
| 已烘焙灯光隔离 | 关闭原运行时灯光对 lightmap 采样差 **0**，实时物体差 **0.25219727** |
| GPU 材质夹具 | UV1、EXR V 翻转、`π` 换算、AO 比例 0.25 与场景灯隔离均通过 |
| 半分辨率 AO | 112 个 lightmap 表面像素，全/半分辨率平均绝对差 **0.00051184**，最大差 **0.01049805**（线性 HDR） |
| 6 轮效果切换 | render targets **4 → 4**，textures **111 → 111** |

额外以独立 Blender 场景验证 Color-off 烘焙约定：环境 radiance=1，Albedo 分别为 0.125、0.75，烘焙结果均为 `[1,1,1]`。证明新图不包含接收表面的底色，并验证 `E/π` 的换算依据。

已查看最终 1080p 截图，首轮错误页绑定导致的墙地面深色块消失。本轮 GPU 时间存在明显波动，记录保留于原始报告，不将其作为与旧方案的同口径性能对照。

证据路径（均以 `D:/opencode-temp/opencode/lightmap-bake/` 为根）：

- `corrected/bake-report.json`、`corrected/bake-cuda.log`：最终烘焙与 UV 校验。
- `corrected/lightmap-baked.blend`：独立后台烘焙副本。
- `bake-encoding-report.json`：Blender Color-off 数值校准。
- `browser-lightmap/report.json`、`browser-lightmap/room-fullhd-gtao-smaa.png`：最终新方案生产回归及截图。
- `browser-original/report.json`：原版回退验证。
- `pipeline-browser/report.json`：GPU 材质读回、AO 质量与资源循环检查。

## 后续调整：远处摩尔纹与走廊补光 · 2026-11-07

用户确认完整烘焙外观在远处正常，Lightmap 方案在远处出现摩尔纹。实测 WebGPU 的 EXR sampler 已为 `maxAnisotropy: 16`，mag/min/mipmap 均为 `linear`，五页 GPU 纹理均有 3 层 mip。问题定位重点转为 Lightmap 新增的 UV0 原始底色：原先使用最近邻且完全不生成 mip，16×16 的重复纹理在远处产生缩小混叠。

### 当前处理

- Lightmap 接收者的 14 张独立 Albedo 生成完整 mip 链，当前为 16→8→4→2→1；三线性 + 设备上限内的 16× 各向异性。
- `src/engine/runtime/function/render/material/pixel-art-sampling.js` 根据屏幕纹素覆盖范围重建近处像素边缘，内部保持原色。缩小时渐进恢复常规纹理坐标；使用原始变换后 UV 的 `dFdx/dFdy` 调用 `textureGrad`，保证 LOD 与斜视过滤不受像素对齐影响。UV repeat/offset 与 sRGB 解码均保留。
- EXR 继续使用已验证的 16×、0–2 级 mip，避免盲目加深 atlas mip 引入跨岛串色。本轮没有重烘或改动 GLB/EXR 文件。
- 移除三盏走廊顶棚 `PointLight`、球形 helper、补光配置/开关与材质注入路径。矩形顶灯的调试 helper 也已移除。默认场景：0 个 helper、0 个走廊补光对象、0 个 PointLight。

### 验证

- Node **29/29**，修改文件 ESLint、生产构建通过。
- GPU 棋盘格夹具：近处纹素内部与旧最近邻的最大 HDR 差 **0**；远处相对理论平均值的平均绝对误差 **0.233276 → 0.001794**；斜视缩小误差 **0.000057**。该数值来自确定性测试纹理，不代表整场景的误差比例。
- 实际场景 GPU 上传确认：已显示的 Lightmap 底色具有 **5 层 mip、16× sampler**；EXR 为 **3 层 mip、16× sampler**。
- 已查看参考机位、低角度地板与近距离截图，远处条纹减轻，近处像素轮廓清晰。GPU 材质、AO 隔离及资源循环专项通过，浏览器错误为 0。
- 新/旧两套方案的生产浏览器回归均为 `passed: true`、`errors: []`、Three.js warning 0；走廊 `fills` 与 `pointLights` 均为空。Lightmap AO 最大采样差为 **0.01663208**，原灯光对其影响为 **0**。六轮效果切换 render targets **4→4**、textures **114→114**。

本轮证据根目录：`D:/opencode-temp/opencode/floor-sampling/`。

- `comparison/report.json`：实际 GPU mip/sampler 与默认灯光清单。
- `comparison/reference-{nearest,filtered}.png`、`comparison/grazing-{nearest,filtered}.png`、`comparison/near-{nearest,filtered}.png`：同一场景、同一机位切换底色采样的对照。
- `pipeline-browser/report.json`：GPU 采样夹具及渲染回归。
- `browser-lightmap/report.json`、`browser-appearance/report.json`：两套方案的生产回归与走廊移除检查。

## 模型同步更新 · 2026-11-07

同步 Blender 最新模型的六个变更对象：`Bricks`、`Jungle_Slab`、`Oak_Slab`、`Stone_Brick_Stairs`、`Block_of_Quartz`，以及用户确认一并纳入的恢复会话修改 `Smooth_Stone`。默认 Lightmap 版本重新导出，并按新几何更新五页 Lightmap 和空间探针数据。

新 `Block_of_Quartz` 的 face 113 复制了 face 110 的 BakeUV，在 B02 造成 4,050 个重叠 texel。导出副本仅对 face 113 的 BakeUV 做平移，保持岛的大小与方向，使用空闲区域及 12 texel margin；几何和 UV0 不变。平移量为 `[-0.5683403611183167, 0.09379959478974342]`。准备后 1,830 个面通过 UV 占用检查，重叠为 0。

导出 scope 的可选 `bakeUVTranslations` 记录对象、面号、atlas、原 UV 与平移量；烘焙工具先核对原 UV，再应用平移并重新校验全部页。记录随 `manifest.bake.uvTranslations` 保存。`geometryAndUVUnchanged` 表示准备完成后的**烘焙阶段**未改变网格；准备前后的指纹分别为 `sourceGeometryUVHashes` 和 `geometryUVHashes`。

`LightProbeVolumes` 中的规划 Box 在后台烘焙时排除，防止封闭 Box 参与遮挡。同步将探针默认总强度设为 **1.21**、天空漫反射倍率设为 **0.52**。

烘焙工具改为逐页处理以限制内存峰值，每页仍使用 2048²、512 samples 和完整房间的遮挡／反弹；同一对象属于其他页的材质槽写入临时 1×1 接收图，完成后恢复全部正式绑定。后台副本移除已脱离有效 PBR 分支的旧预览 atlas 节点和图像，已保存的页释放解码缓冲，并禁用全局撤销和渲染持久缓存。`--reuse-pages B01 B02` 可显式复用**相同快照、scope、采样配置**及工作目录中已完成的原始 EXR。

本轮临时快照、scope、UV 平移计划、旧资源备份、后台日志与浏览器记录存放在 `D:/opencode-temp/opencode/room-model-update-20261107/`。确认后的恢复版本使用其中 `recovered-update/source-snapshot.blend` 和 `recovered-update/scope.json`，恢复会话另有独立备份 `recovered-session.blend`。

### 同步结果与验证

- 正式模型已替换为恢复版本：**135 mesh、199 primitive、47,644 triangles**，分类为 18 lightmap／178 realtime／3 fixture-emissive。SHA-256：`bdbf53dcf30bffc8130f8c7c11e8fed2e2632c21ad9ec45db0366a4b974a8bc8`。
- 六个对象的实际 GLB 差异与批准快照一致；其他对象保持原几何／UV。五页均从恢复快照重新烘焙，未复用先前五对象版本的页面。
- 从恢复快照核验三个探针 Box 定义一致；按新模型与 Lightmap 重捕获 **282** 个探针，正式缓存 **23,520 bytes**。生产页面确认从 `precomputed` 加载，Panel 初始值为天空漫反射 **0.52**、探针总强度 **1.21**。
- Node **34/34**、修改文件 ESLint、生产构建、diff 检查、默认 Lightmap 页面与探针专项浏览器回归通过，浏览器错误为 0。捕获／上传失败回滚、重复捕获与释放检查通过；50 个 Lightmap 采样点的探针开关差为 0。
- 前台临时切换的视图已恢复为材质预览。验证记录位于 `recovered-update/model-validation.json`、`verification-summary.json`、`production-room-lightmap/`、`production-probes/`；后两个目录包含页面截图。

### 后续仅模型导出 · 复用光照

用户要求不重烘时，使用 `tools/bake_range_room_lightmaps.py --reuse-lightmaps <现有 manifest.json>`，其余 `--project`、`--scope`、`--work` 参数保持原流程；输出仍使用独立暂存目录。该路径核对保留的接收者几何／BakeUV，应用已有页绑定与 UV 平移，然后在 Cycles 初始化前转入导出。五页 EXR 按原始字节复制，不重烘也不重新编码。

本次同步 `Jungle_Slab`、`Stone_Brick_Stairs`、`White_Carpet` 的修改，以及场景中 `Stone_Slab.001` 的删除。保留的 **10 个预烘焙对象**在实际 GLB 中的几何、法线、UV、索引、变换和图集绑定均与上一版本一致。当前为 **134 mesh、197 primitive、47,318 triangles**，其中 16 lightmap／178 realtime／3 fixture-emissive；模型 SHA-256 为 `d3d7fa8e109dede3d4166ae7f0614f7f9510d7cb917f89388d2610fcf87413a4`。

`manifest.bake` 保留原烘焙记录；`verification.rebake=false`、`reusedLightmapsFrom` 和 `modelOnlyUpdate` 记录本次复用与模型变更。五页 Lightmap 和 **23,520 bytes** 的探针数据逐字节复用；探针缓存只更新模型匹配签名，并用 `capturedSourceKey` 保留实际采样来源，避免页面自动重捕获。

Node **34/34**、修改测试文件 ESLint、资源校验与浏览器加载检查通过。浏览器确认加载新模型，探针来源为 `precomputed`、`lastBakeMs=null`，实际加载的 SH 数据哈希与原缓存一致。记录及截图：`D:/opencode-temp/opencode/room-model-export-only-20261107/`。

## 增量补烘：Stone_Slab.001 与 wall · 2026-11-09

两个对象单独打包到 `B06.exr`，**不重烘整个房间**：

- B06 为 **1024×1024** scene-linear Rec.709、half-float RGBA EXR；面积为原 2048² 页的四分之一。
- 两者重新整理 `BakeUV`，保持原始底色 UV0 不变；共 79 个 UV 岛，约 22.7 texel/m，0 重叠，12 texel 扩展边距检查通过。
- Blender `wall` 具有非均匀缩放：仅在后台副本中应用缩放以正确统一 UV 密度，校验世界空间顶点位置不变。它的共享材质被复制，并显式将底色绑定到原始 UV0，避免随活动 BakeUV 改变。
- `Stone_Slab.001` 的一处材质输出处于纹理直连预览状态；仅对后台副本恢复原 Principled 分支，再按已有 **Diffuse Direct + Indirect、Color off、512 samples、12 texel margin** 烘焙。
- 烘焙时两者为唯一接收者，完整原房间仍参与遮挡和反弹；探针规划 Box 全部排除。B01～B05 按原始字节复用，旧页面未重烘。
- 基于当前网页模型的场景快照，仅从当前 Blender 快照加入这两个对象；其余 134 个可见对象的 GLB 几何、法线、UV、索引、变换、材质和绑定均与前版一致。
- 探针 SH 数据不重捕获，保留实际采样来源 `capturedSourceKey`，仅更新资源匹配签名；如新增墙体使相邻表面遮挡发生变化，旧 Lightmap 和探针不会自动反映这一变化。

B06 文件为 **3,149,369 bytes**，两对象的 356 个三角形中心均有烘焙覆盖；生产构建的浏览器实际上传为 1024²、3 级 mip，底色使用 UV0、光照使用 UV1。生产浏览器房间回归和 23 项相关 Node 测试通过；再次执行 `--reuse-lightmaps` 得到与本次交付逐字节相同的 GLB 与六页 EXR，移动 `wall` 后复用会被拒绝。完整 Node 测试为 67/70，通过以外的 3 项是下述既有碰撞数据断言。

`wall` 在检查机位较暗；对其室内侧中心的三条顶灯射线均命中 `Polished_Basalt`，此处遮挡来自现有场景，未人为抬亮。可参考 `production-targets/wall-interior.png` 并由使用者确认视觉效果。

`tools/bake_range_room_supplement.py` 在后台场景中追加指定对象、紧凑打包 UV、只烘焙新页，并通过导出器复用旧 EXR；必须提供源快照、材质清单、旧 manifest、包含全部对象的 scope、独立输出目录和工作目录。`--validate-only` 只执行准备与 UV 验证。`manifest.bake.supplemental` 保存原始变换、材质槽和逐 loop BakeUV，以便后续 `--reuse-lightmaps` 在后台副本中重放相同 UV 和绑定；源几何、UV 或目标变换改变时会拒绝复用。

本轮快照、旧资源备份、补烘记录、验证报告及截图保存在 `D:/opencode-temp/opencode/range-room-additional-lightmap-20261109/`。当前分支原有的碰撞层测试仍断言 390 个 box，而现有数据为 399 个；与本次 Lightmap 修改无关。

### wall 尺寸调整：仅导出 · 2026-11-09

根据 Blender 当前 `wall` 的调整，仅同步该对象的四个顶部顶点。Three.js 坐标中墙体底部仍为 `Y=8.5`，顶部从 **21.990150** 降至 **18.990150**；拓扑、变换、原始 UV0、B06 的 BakeUV 和材质均未改变。其他 135 个可见对象的 GLB 几何与变换保持不变。

按用户要求未重烘 Lightmap、未重新捕获探针：B01～B06 和 SH 二进制均逐字节复用。墙体当前几何与原 B06 烘焙来源不同，`verification.modelOnlyUpdate.staleLightmapReceivers` 和 `verification.explicitStaleLightmapOverride` 明确记录这一点；探针缓存保留实际 `capturedSourceKey`，仅更新资源匹配签名。后续再次执行 `--reuse-lightmaps` 已验证可复用同一 GLB 和六页资源。碰撞层未改动。

独立资源校验、24 项相关 Node 测试和浏览器无渲染资源加载检查通过；后者确认新包围盒及 UV0/B06 绑定。两次实际 WebGPU 渲染检查均因系统内存不足失败，未关闭用户程序，画面仍需用户确认。快照、前版备份和检查记录位于 `D:/opencode-temp/opencode/wall-model-export-20261109/`。
