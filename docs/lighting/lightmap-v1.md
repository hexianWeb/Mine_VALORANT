# Lightmap v1 · 预烘焙集合重烘

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
- `src/world/pixel-art-sampling.js` 根据屏幕纹素覆盖范围重建近处像素边缘，内部保持原色。缩小时渐进恢复常规纹理坐标；使用原始变换后 UV 的 `dFdx/dFdy` 调用 `textureGrad`，保证 LOD 与斜视过滤不受像素对齐影响。UV repeat/offset 与 sRGB 解码均保留。
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
