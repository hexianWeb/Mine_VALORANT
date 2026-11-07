# renderer V1 · 练枪房 · Three.js WebGPU

本轮运行时渲染器暂定为 **renderer V1**；房间资产仍沿用 `range-room-v3` 标识。

单房间渲染入口：五张线性 EXR 烘焙外观、像素风未烘焙物体 PBR、三排矩形顶灯、日间天空环境、走廊补光、GTAO + 空间去噪、Reinhard（曝光强度 1.2）、LUT 与 SMAA。

实施与验证见 [练枪房实施与验证记录](docs/lighting/range-room-v3-implementation.md)。正式资源在 `public/model/range-room.glb` 与 `public/lighting/range-room/`，由带 SHA-256 的 manifest 绑定。不会回退到旧整图。

## 开发

``` bash
npm ci
npm run dev
```

使用支持 WebGPU 的最新版 Chrome / Edge。加载后保持 Blender 参考机位，拖动、平移、滚轮仅用于场景检查，不是玩家移动/碰撞系统。右上角提供用户要求的 AO 和 LUT 调试面板。

当前 `package-lock.json` 与 r187 依赖一致，已验证 `npm ci --dry-run --ignore-scripts`。保留现有 pnpm 锁文件，不删除或自动互相转换；安装时选择一种包管理器。部分 ESLint 开发依赖要求 Node 22.22.2+ 或 24.15+。

## 验证

```bash
npm test
npm run validate:room
npm run build
npm run preview
node tools/check-room-browser.mjs http://localhost:4173/
```

浏览器检查使用原生 CDP，默认 Chrome 路径可通过 `CHROME_PATH` 修改。截图、独立浏览器配置和 `report.json` 保存至 `D:/opencode-temp/opencode/range-room-browser`，可通过 `ROOM_TEST_OUTPUT` 指定其他临时目录。

运行时检查入口：控制台 `__RANGE_ROOM__.snapshot()`。测试变体可使用 `?ao=0&aa=none`。EXR 纹理保持 `flipY=false`，材质按本次已验证的 glTF/EXR 方向显式翻转一次 V 轴。

## 当前显示与调试配置

- **未烘焙像素贴图**：`minFilter` / `magFilter` 均为 `NearestFilter`，关闭 mip 生成和混合，保留 Minecraft 风格的清晰纹素。颜色 PNG 仍按 sRGB 解码，不把最近邻与线性色彩空间混淆。
- **烘焙 atlas**：线性放大、三线性缩小、最高 16× 各向异性（受设备上限限制）；仅生成 0–2 级 mip，透明空白不参与颜色平均。UV 与原始图像不变。WebGPU 各向异性要求线性过滤，所以未烘焙最近邻贴图使用 anisotropy 1。
- **显示**：`ReinhardToneMapping`，`toneMappingExposure = 1.2`，不是 1.2 EV。显示变换/sRGB 输出之后接 LUT，最后 SMAA；中性默认 LUT 为 33³ 半浮点 identity。
- **天空与走廊**：`skybox-day.png` 是 LDR PNG，保留 4096×2048 背景，用 1024×512 代理生成低成本环境光，关闭旧 AmbientLight 避免叠加。三盏顶棚点光的作用距离为 9 m；烘焙走廊只额外接收这三盏新灯的局部漫反射，不接收原顶灯、环境或 AO 的重复照明。
- **AO 面板**：开关、仅 AO 预览、强度、半径、厚度、采样、分辨率、去噪与重置。
- **LUT 面板**：曝光、开关/混合强度、中性/暖/冷/柔和电影预设、对比度/饱和度/色温/色偏、`.cube` 导入与重置。导入支持 2–64³、0–1 显示域，不直接接受 Log LUT；错误文件保留上一个有效 LUT。

## 导出与替换模型

`tools/export_range_room.py` 只允许在后台 Blender 副本中运行，要求显式对象 scope，拒绝覆盖已存在的正式资产。副本中调用 `repair_blender_alpha.py` 按图像实际 alpha 分类，防止后续重新导出时退回全部 BLEND；不改源 `.blend`，不重新展开或烘焙。

模型修复后必须同步校验/更新 `manifest.json` 的 hash 与 primitive 绑定。不能只换 GLB 并跳过版本校验。透明分类由回归测试检查，失败不能当作已验收。

矩形顶灯目前是待视觉校准的初始拟合，不等价于 Blender 的瓦特功率；不支持阴影或 Area Spread。TRAA、探针及烘焙表面接收动态阴影未实现。最近邻贴图的远景闪烁与烘焙 atlas 的滤波需分别验收，不能用全局线性过滤模糊所有物件来解决。
