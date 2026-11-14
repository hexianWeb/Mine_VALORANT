# 室内 LightProbeGrid · Blender Box 驱动

> SH 探针为手臂等非金属接收者提供漫反射间接光。枪身的镜面环境由离线捕获的 HDR Cubemap 和加载时生成的 PMREM 提供。[武器默认材质与验证](../weapons/material-quality-roadmap.md#当前默认材质与验证)

## 使用

默认 Lightmap 页面加载三个预计算探针体积，右侧新增 **LightProbe · 室内间接光** 面板。`?probes=0` 可完全跳过该模块，使用原有天空环境照明；`?lighting=appearance` 保留原完整烘焙方案。

### 实时调光

- 探针开关、总强度、室内与两个走廊的独立强度。
- 天空漫反射、天空镜面反射：相对于原环境强度 0.35 的倍率；背景天空显示不随这两个滑杆改变。
- 实时顶灯倍率：控制三排 RectAreaLight；观察模块的辅助阴影灯有自己的开关。
- 体积边界与球谐探针球显示；标记不参与拾取，也不会进入捕获场景。
- 初始值：探针强度 **1.21**、天空漫反射 **0.52**、天空镜面反射 1、顶灯倍率 1。探针与天空漫反射共同提供环境照明，可通过面板调节配比。

天空分量在原生 PBR 光照模型的 IBL 输出阶段拆分，保留金属多重散射、clearcoat 与 sheen 的镜面贡献。探针漫反射、直接灯光不受天空漫反射滑杆影响。调光 uniform 使用 `renderGroup`，不必在每次拖动时重新编译材质。

天空分量滑杆作用于通过 `bindRoot()` 接入的材质。枪身的室内反射由关卡提供，倍率为 `0.3`，随全局灯光开关归零或恢复。

### 捕获设置

“捕获天空贡献”“捕获灯带自发光”“捕获顶灯倍率”和每面 8/16/32/64 分辨率影响下一次捕获。修改后显示 **待重新捕获**；按 **重新捕获探针** 后分批处理，进度显示于按钮上方。完成全部体积后统一更新纹理，失败则继续使用上一套结果。

- 默认捕获天空 0.35、灯带自发光 0、顶灯倍率 1，每面 16²，单轮。
- 捕获天空贡献同时控制静态捕获场景的背景亮度和环境强度。
- 自发光强度为 0 时保留黑色灯带表面作为遮挡，不通过隐藏表面形成屋顶孔洞。
- 捕获顶灯只改变实时表面的受光；墙地面已有 Lightmap 的出射光维持已烘焙结果。
- 捕获场景是房间的静态副本，独立于茶壶、辅助阴影灯和主画面的 AO、曝光、LUT。使用线性 HDR，不将后处理烘进 SH。
- 已完成的 Lightmap 包含反弹光，因此初版不额外迭代 bounce。

Panel 参数与重新捕获结果属于当前页面会话；刷新恢复项目中的默认参数和预计算数据。

## Blender 体积

读取 `LightProbeVolumes` 集合内的轴对齐 Mesh Box，使用 **全部世界空间包围盒角点**，不把物体 origin 误当中心。当前 Box 的 origin 不在中心，这一点对本场景尤其重要。

坐标变换与房间 GLB 一致：`(x, y, z) Blender → (x, z, -y) Three.js`。规划 Box 只导出 JSON，不导入渲染、碰撞或捕获几何。

| 体积 | 网格 XYZ（Three.js） | 探针数 | SH atlas 字节数 |
|---|---|---:|---:|
| LPV_Room | 9×4×6 | 216 | 16,128 |
| LPV_Corridor_01 | 3×3×2 | 18 | 2,016 |
| LPV_Corridor_02 | 6×4×2 | 48 | 5,376 |
| 合计 | | **282** | **23,520** |

初始目标间距约为 X/Z 5 m、Y 4 m，每轴至少 2 个采样。可添加 Blender 自定义属性 `probe_resolution`（Three.js XYZ 的三个整数）和 `probe_priority`。走廊默认优先级 10，主房间为 0。

当前两个走廊 Box 间有 **1.800293 m** 的空隙，忠实保留作者布局，没有自动扩张填满。启用边界显示可检查衔接。原生 Grid 的范围判断包含半个格距的法线偏移；体积范围不是可见性遮挡，墙体附近仍可能漏光，重叠区域按优先级选取而非平滑混合。

### 更新流程

在 Blender Python Console 中运行（只读取场景，不保存或修改 `.blend`）：

```python
import runpy
tool = runpy.run_path('E:/graphic/MC_VALORANT/tools/export_probe_volumes.py')
tool['export_volumes']('E:/graphic/MC_VALORANT/public/lighting/range-room-probes/volumes.json')
```

启动项目开发服务器，然后重新生成正式 SH 资源：

```bash
node tools/bake-room-probes.mjs http://localhost:5173/
```

输出：

- `public/lighting/range-room-probes/volumes.json`：作者体积与采样配置。
- `cache.json`：房间模型、Lightmap、灯光、体积和 Three.js 版本对应的数据签名，以及捕获参数和二进制 SHA-256。
- `probe-atlas.bin`：三个 atlas 连续排列的 little-endian RGBA16F 数据。

正常加载只上传预计算数据。签名或默认捕获配置变化时，浏览器会捕获一次作为预览；正式发布前使用脚本更新缓存。天空 PNG 内容在同一路径下替换时，也需要手动重新捕获。

`PROBE_OUTPUT` 可改变脚本资源输出目录；`ROOM_TEST_OUTPUT` 可改变诊断目录，默认均将诊断资料存至 `D:/opencode-temp/opencode/light-probes/`。

## 代码与生命周期

- `probe-lighting.js`：静态捕获副本、体积、调光状态、分批捕获与原子应用。
- `probe-environment.js`：PBR 环境漫反射／镜面分量控制；可通过 `bindRoot()` 为后续动态物体接入控制。
- `probe-data.js`：数据布局、签名、校验与完整 3D 纹理读写。Three.js 的 `copyTextureToTexture` 默认只复制一层，上传时显式传入完整 `Box3` 深度范围。
- `probe-panel.js`：即时调光、捕获参数、进度与错误状态。
- `range-room.js` 保持普通加载与渲染器解耦，显式调用 `loadProbes(renderer)` 初始化探针；`main.js` 将茶壶接入环境控制。

运行时入口为 `__RANGE_ROOM__.world.probes`：`getDebugState()`、`setLighting()`、`setVolumeIntensity()`、`setCapture()`、`rebake()`、`exportData()`。`world.setRuntimeLighting(false)` 同时关闭探针与原室内环境照明。

运行时保持 atlas 纹理身份稳定；重新捕获用另一组网格作为暂存区，完成后复制。取消与异常恢复 renderer 状态；释放时移除订阅、辅助几何、捕获材质和探针纹理。Three.js 原生烘焙器还会池化 face/batch 中间资源，23,520 字节不是点击重烘后的全部显存开销。

## 验证

```bash
npm test
node tools/check-pipeline-browser.mjs http://localhost:5173/
node tools/check-probes-browser.mjs http://localhost:5173/
# 生产预览启动后
node tools/check-room-browser.mjs http://localhost:4173/
node tools/check-room-browser.mjs "http://localhost:4173/?lighting=appearance"
```

- Node **34/34**、修改文件 ESLint、生产构建与 diff 检查通过；默认 Lightmap 和原完整烘焙外观的生产浏览器回归均通过，浏览器控制台错误／warning 为 0。
- 资产检查：哈希、尺寸、有限系数、空间变化、七个子体积的边缘 padding。
- GPU 确定性夹具：天空漫反射关闭后非金属环境漫反射为 0，探针贡献仍存在；金属反射保持 0.5，关闭镜面滑杆后为 0；clearcoat 同样可独立关闭。
- 场景 A/B：50 个 Lightmap 采样点的探针开关差为 **0**，50 个实时表面采样点最大线性 HDR 差约为 **0.144**。
- DOM 实际操作验证分区强度、天空分量、顶灯倍率及捕获按钮；修改捕获设置先变 dirty，完成后才更新 lastCapture。
- 同参数重复捕获数据逐值一致，排除自身反馈累加；重复捕获纹理 **189→189**，render target **23→23**。
- 注入捕获失败后上一套数据、tone mapping、输出色彩空间均恢复；第二个体积上传失败时，三个体积的 GPU atlas 与导出数据均回滚，纹理身份保持一致；捕获中销毁得到 AbortError，体积节点移除。
- 首次冷捕获包含材质编译，本机各轮观察约 4.6–7.9 秒；已暖机重复捕获约 1.2–1.3 秒。正常页面加载使用预计算数据，不进行这些捕获。
- 1080p 参考机位、NVIDIA Lovelace 适配器：两轮生产测试各 16 对交替开关样本，总管线的**成对增量中位数**分别为 **+0.379 / +0.223 ms**，`Scene HDR color` 为 **+0.354 / +0.211 ms**。负载波动明显，采用逐对差值统计，不以独立开／关中位数相减推断探针成本。

报告、截图与逐 pass GPU 采样见 `D:/opencode-temp/opencode/light-probes/`；最新探针专项为 `production-final-browser/report.json`，完整生产回归为 `production-room-lightmap/` 与 `production-room-appearance/`。性能数字仅代表本机和对应机位。

### 最新模型同步 · 2026-11-07

包含恢复后的 `Smooth_Stone` 在内的六对象更新已发布，五页 Lightmap 与正式探针缓存同步重建。三个作者 Box 的范围和分辨率保持一致，共 **282** 个探针；初始调光值为天空漫反射 **0.52**、探针总强度 **1.21**。

生产页面确认使用预计算数据，Node **34/34**、页面与探针浏览器回归通过，控制台错误为 0。探针开关对 50 个 Lightmap 采样点的影响为 0，50 个实时表面的最大线性 HDR 差约 **0.17435**；重复捕获数据逐值一致，纹理 **189→189**、render target **23→23**，异常回滚与销毁检查通过。

本次报告和截图位于 `D:/opencode-temp/opencode/room-model-update-20261107/recovered-update/`，包括 `probe-bake/report.json`、`verification-summary.json`、`production-room-lightmap/` 和 `production-probes/`。前一节记录的性能测量属于更新前模型。

后续仅模型导出按用户要求复用这份 SH 数据，未重新捕获。`cache.json.sourceKey` 匹配当前模型以直接加载；`capturedSourceKey` 记录原始采样输入，`reuse` 说明本次显式复用。五页 Lightmap、灯光与三个探针体积已核对一致，二进制哈希保持 `b56885451f3fc0de467cf3baad3248e8f95273adca1099cad4e7d18ca636ba42`。浏览器确认 `precomputed`、`lastBakeMs=null`，检查记录见 `D:/opencode-temp/opencode/room-model-export-only-20261107/browser/report.json`。
