# renderer V2 · 练枪房 · Three.js WebGPU

运行时渲染器为 **renderer V2**；默认房间资产为 `range-room-lightmap-v1`，保留 `range-room-v3` 完整烘焙外观方案。

单房间渲染入口：五张线性 EXR lightmap 与原始像素贴图、未烘焙物体 PBR、三排矩形顶灯、日间天空环境、半分辨率 GTAO/去噪与边缘重建、Reinhard（曝光强度 1.2）、线性 SMAA 与显示域 LUT。

本轮改造见 [renderer V2 优化与验证](docs/lighting/renderer-v2-optimization.md)，首版接入见 [练枪房实施与验证记录](docs/lighting/range-room-v3-implementation.md)。正式资源在 `public/model/range-room.glb` 与 `public/lighting/range-room/`，由带 SHA-256 的 manifest 绑定。

最新 [Lightmap 重烘与接入](docs/lighting/lightmap-v1.md) 仅覆盖“预烘焙”集合的 11 个对象、18 个分区。新资源在 `public/model/range-room-lightmap.glb` 与 `public/lighting/range-room-lightmap/`。右上角 **切回原版** 或 `?lighting=appearance` 可回退；`?lighting=lightmap` 使用新方案。

## 开发

``` bash
npm ci
npm run dev
```

使用支持 WebGPU 的最新版 Chrome / Edge。加载后保持 Blender 参考机位，默认启用飞行观察：点击画面后 WASD 移动、Q/E 升降、右键拖动视角、Shift 加速、滚轮调速。F 定位浮动茶壶，R 复位。左下角可切换轨道模式、暂停漂浮及切换动态阴影，右上角提供 AO 和 LUT 调试面板。模块与操作见 [茶壶与飞行观察](docs/lighting/room-inspection.md)。

当前 `package-lock.json` 与 r187 依赖一致，已验证 `npm ci --dry-run --ignore-scripts`。保留现有 pnpm 锁文件，不删除或自动互相转换；安装时选择一种包管理器。部分 ESLint 开发依赖要求 Node 22.22.2+ 或 24.15+。

## 验证

```bash
npm test
npm run validate:room
npm run build
npm run preview
node tools/check-room-browser.mjs "http://localhost:4173/"
```

新增 GPU 专项测试使用开发服务器（需要加载测试夹具模块）：

```bash
npm run dev
node tools/check-pipeline-browser.mjs "http://localhost:5173/"
```

专项测试覆盖法线预通道的透明裁剪/顶点变形、像素贴图的近处锐度与远处缩小过滤、参数原地更新、分辨率联动、效果循环释放，以及 1080p 分 pass GPU 计时。浏览器脚本自动添加 `?profile=1`。

浏览器检查使用原生 CDP，默认 Chrome 路径可通过 `CHROME_PATH` 修改。截图、独立浏览器配置和 `report.json` 保存至 `D:/opencode-temp/opencode/range-room-browser`，可通过 `ROOM_TEST_OUTPUT` 指定其他临时目录。

运行时检查入口：控制台 `__RANGE_ROOM__.snapshot()`；通过 `?profile=1` 开启计时后，`await __RANGE_ROOM__.render.measureGpu()` 返回最后提交帧的各 pass GPU 毫秒数。CPU 统计排除启动/配置变化后的 30 帧暖机。测试变体可使用 `?ao=0&aa=none`。

EXR 解码和 alpha 加权 mip 生成在独立 Worker 中完成，通过 transferable buffers 传回；取消加载会终止 Worker。纹理保持 half-float、`flipY=false`；lightmap 通过纹理矩阵翻转一次 V，旧完整外观材质通过显式 TSL UV 翻转一次 V。

## 代码分层

- `src/engine/`：通用生命周期、资源管理与渲染管线。`createRenderSystem()` 创建完成即具备 pipeline，负责后处理、调色、性能分析、resize 与逐帧渲染。
- `src/world/`：平铺的练枪房内容。`range-room.js` 编排资产加载、参考相机、天空环境与灯光；房间默认配置也在这里。依赖方向为 `world → engine`。
- `src/main.js`：先创建渲染系统，再创建、注册清理并加载房间；合并渲染和房间快照。`src/debug-panel.js` 是应用层 UI。

检查接口：`__RANGE_ROOM__.render` 管理渲染效果，`__RANGE_ROOM__.world` 提供 `setRuntimeLighting()` 和房间快照，`__RANGE_ROOM__.room` 是加载后的资产实例。整体状态继续通过 `__RANGE_ROOM__.snapshot()` 获取。

## 当前显示与调试配置

- **未烘焙像素贴图**：`minFilter` / `magFilter` 均为 `NearestFilter`，关闭 mip 生成和混合，保留 Minecraft 风格的清晰纹素。颜色 PNG 仍按 sRGB 解码，不把最近邻与线性色彩空间混淆。
- **Lightmap 接收者的底色**：`pixel-art-sampling.js` 保留近处纹素内部的纯色与清晰边界，仅在屏幕像素覆盖纹素边缘时做抗锯齿。远处使用完整 mip 链（当前 16² → 1²）、三线性和最高 16× 各向异性，减轻地板摩尔纹。显式使用原始 UV 导数计算 mip，避免像素对齐后的 UV 破坏缩小采样；底色继续按 sRGB 解码。
- **烘焙 atlas**：线性放大、三线性缩小、最高 16× 各向异性（受设备上限限制）；仅生成 0–2 级 mip，透明空白不参与颜色平均。Lightmap 重烘复用原 BakeUV，并修正两处因底色材质更换而错误指向其他图集的绑定。WebGPU 各向异性要求三种过滤均为 linear；Lightmap 底色通过 shader 重建近处像素感，实时最近邻贴图使用 anisotropy 1。
- **显示**：`ReinhardToneMapping`，`toneMappingExposure = 1.2`，不是 1.2 EV。顺序为线性 tone mapping → SMAA → sRGB → LUT；中性默认 LUT 为 33³ 半浮点 identity，identity 或关闭 LUT 时走真正的 shader 旁路。
- **天空与灯光**：`skybox-day.png` 是 LDR PNG，保留 4096×2048 背景，用 1024×512 代理生成低成本环境光，关闭旧 AmbientLight 避免叠加。三盏走廊顶棚补光灯已移除。原三排矩形顶灯用于实时物体。Lightmap 通过空的显式灯光列表排除重复照明并接收 GTAO；旧完整外观使用 unlit 材质。
- **AO 面板**：开关、仅 AO 预览、强度、半径、厚度、采样、分辨率、去噪与重置。默认 GTAO 为 50%/16 samples，去噪分辨率默认跟随 AO，也可独立选择；R16F 去噪结果经深度/法线引导的四点重建接入材质间接光（包含 lightMap）。修改 samples/分辨率保留现有 render targets。
- **LUT 面板**：曝光、开关/混合强度、中性/暖/冷/柔和电影预设、对比度/饱和度/色温/色偏、`.cube` 导入与重置。导入支持 2–64³、0–1 显示域，不直接接受 Log LUT；错误文件保留上一个有效 LUT。

## 导出与替换模型

`tools/export_range_room.py` 只允许在后台 Blender 副本中运行，要求显式对象 scope，拒绝覆盖已存在的正式资产。副本中调用 `repair_blender_alpha.py` 按图像实际 alpha 分类，防止后续重新导出时退回全部 BLEND；不改源 `.blend`，不重新展开或烘焙。

Lightmap 重烘使用 `tools/bake_range_room_lightmaps.py`，完成后调用上述导出器的 `--lightmap-report` 路径写入独立版本；范围、UV 校验和复现命令见 [Lightmap 文档](docs/lighting/lightmap-v1.md)。

模型修复后必须同步校验/更新 `manifest.json` 的 hash 与 primitive 绑定。不能只换 GLB 并跳过版本校验。透明分类由回归测试检查，失败不能当作已验收。

矩形顶灯目前是待视觉校准的初始拟合，不等价于 Blender 的瓦特功率；不支持阴影或 Area Spread。独立观察模块使用室内聚光灯提供实时阴影，烘焙表面通过可释放的材质扩展接收动态阴影。TRAA、探针尚未实现。最近邻贴图的远景闪烁与烘焙 atlas 的滤波需分别验收，不能用全局线性过滤模糊所有物件来解决。
