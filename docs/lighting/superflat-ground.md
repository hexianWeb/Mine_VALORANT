# 练枪房外部地面 · 超平坦世界

地面在房间加载完成后根据 GLB 的实际世界空间包围盒创建。更新模型后，占地和地面高度会自动重新计算。

## 当前范围

坐标系为 Three.js Y-up，单位为米。

| 轴 | 最小值 | 最大值 |
|---|---:|---:|
| X | -25 | 26 |
| Y | 7.874998 | 30.125007 |
| Z | -22.005117 | 23.000006 |

- 石英砖覆盖包围盒 XZ 投影，约 **51 × 45.005123 m**。
- 两种地面的顶面均为 **Y = 7.864998**，即包围盒最低点下方 0.01 m。
- 外围草地以占地中心向每侧延伸 8,192 m，总边长 16,384 m；观察相机远裁剪面扩展至至少 4,096 m。
- 一个石英矩形和四条互不重叠的草地带合并为 **2 个 mesh / 10 个三角形**，共享同一高度和边界。

## 原版纹理

从 Minecraft Java Edition **1.21.1** 原版资源镜像下载，固定版本：

`Faithful-Pack/Default-Java@a07b741ff5c3d79f5aef81d7d05e637c5549bbf4`

- `public/textures/minecraft/quartz_bricks.png`：原版白色石英砖，16×16，194 bytes。
- `public/textures/minecraft/grass_block_top.png`：原版草方块顶面，16×16，298 bytes。
- 草皮使用原版平原染色 **#91BD59**，由草地 colormap 的 `(51, 173)` 像素得到，对应温度 0.8、降水 0.4。
- 下载链接、SHA-256、归属及染色来源见同目录 `sources.json`；运行时从项目本地加载。

两张图均使用 `RepeatWrapping`，世界空间 UV 为 `(x, -z)`，保持 **1 米 / 原版方块**。沿用 `pixelArtAlbedo` 的近处像素锐度重建，远处使用完整 5 级 mip 和设备支持范围内最高 16× 各向异性过滤。

## 接入与光照

`src/world/room-ground.js` 管理地面几何、材质及纹理采样实例，`range-room.js` 负责加载、接入场景和释放。`world.ground` 与 `world.snapshot().ground` 提供地面信息；房间包围盒单独用于房间定位。

地面使用粗糙、非金属 PBR 和现有日间天空，室外天空强度为 1，参与正常深度／法线预通道和 GTAO。材质使用独立灯光列表，室内探针、天空分量和顶灯面板调整不影响草地及石英基底；全局运行时光照开关仍可控制地面受光。

## 验证

- Node **40/40**、修改文件 ESLint、生产构建和 diff 检查通过。
- 地面专项验证实际 GPU 纹理为 16×16、5 级 mip、Repeat 和 16× 各向异性；石英／草地区域覆盖与 1 m UV 尺度正确。
- 室内探针及调光开关前后，地面采样点的线性 HDR 差为 **0**；页面继续预计算加载探针，`lastBakeMs=null`。
- 生产房间完整回归与地面专项均通过，浏览器错误为 0。资源部分失败、加载中取消与重复释放均有回归覆盖。

运行：`node tools/check-ground-browser.mjs http://localhost:5173/`。

本轮记录：`D:/opencode-temp/opencode/superflat-ground-20261107/`。`production-ground/` 包含外景总览、平视、石英／草皮接缝和单独占地截图；`production-room/` 为房间生产回归记录。
