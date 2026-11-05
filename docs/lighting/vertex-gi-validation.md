# 顶点 GI 验证

日期：2026-11-05。状态：实验；保留现有几何密度，不做细分。

## 合并顶点的影响

将当前地图与上次烘焙前的场景快照逐面角比较：

- 97 个地块对象，Mesh 顶点由 172,963 个减少到 59,555 个。
- 88,766 个三角形、266,298 个面角保留；面角位置差异在 1e-5 内，颜色 UV 一致。
- 未发现退化三角形和退化的颜色 UV 三角形。
- 7 个对象共 159 个面角的法线发生明显变化（向量差大于 0.01），集中在半砖/台阶。

测试副本保留合并后的顶点，通过硬边标记分离法线计算扇区，并恢复原有面角法线；没有为了恢复硬边重新拆开几何顶点。恢复误差小于 0.00014。

因此：合并重合顶点本身没有降低本地图的空间采样密度，但需要检查自定义法线。普通 POINT 域颜色不能表达同一顶点不同朝向的受光，本实验使用 CORNER 域。

Mesh 顶点数也不等于 GPU 顶点数。glTF 会按照颜色 UV、法线和 GI 属性的不连续重新拆分。当前导出有 173,637 个地块渲染顶点，GI 的 RGB32F 属性约 1.99 MiB。

## 光照契约

```
顶点 GI = World 直接/间接漫反射照明
        + 地块自发光对表面的照明
        + 太阳和 7 盏区域灯的间接漫反射照明

最终照明 = 顶点 GI + 实时太阳/区域灯直射及阴影
```

- Cycles CUDA、256 samples、4 次 diffuse bounce、关闭 Fast GI。
- 保留树叶、栅栏等细碎物件的既定烘焙排除规则。
- 原材质颜色继续参与反弹，烘焙结果不含接收面 albedo。
- 白漫反射立方体校准：8 个共享顶点、CORNER 颜色，受光面的 irradiance 为 1；不同朝向分别保留受光。
- 将去 albedo 的烘焙值乘 π，存为线性 irradiance。
- 对世界位置和着色法线都相同的样本取均值，减少独立随机采样产生的拼接差异；不同法线不混合。

## 导出与接入

glTF 属性：`_GI_IRRADIANCE`，FLOAT / VEC3。

GLTFLoader 中的属性名：`_gi_irradiance`。

使用 TSL 将该属性接入间接 irradiance 通道。不要开启普通 `vertexColors` 将其乘进底色；那会错误地调制实时直射光。

本次导出不依赖 `TEXCOORD_1`，也不把 GI 写入 `COLOR_0`。`verify_vertex_gi.mjs` 检查了实际二进制属性、HDR 值、三角形数量和共享位置的硬边光照分离。

## 验证范围

- 练枪房、近墙、近地面三个同机位参考/顶点 GI 对照。
- 使用单独的 Diffuse Direct/Indirect 渲染 pass，额外对比去 albedo、去实时直射的 GI 图，避免强直接光掩盖插值误差。
- 参考图和顶点预览均在 Cycles 内生成，直射/阴影条件一致。
- 这不代表 WebGPU 的区域灯阴影和运行时性能已经验证；Three.js 普通 RectAreaLight 的无阴影限制仍需按 V2 处理。

## 本轮结果

完整画面保留实时直射和阴影时，三个视角的归一化绝对误差约 2.2–2.7%。单独观察 GI 后，能看到窗洞周围、地面亮斑和台阶凹角被线性插值平滑，整体画面的接近不能代表这些细节已经准确。

独立 GI 参考使用 1024 samples；顶点烘焙为 256 samples：

| 视角 | GI 均值偏差 | GI 归一化绝对误差 |
|---|---:|---:|
| 近墙 / 窗洞 | -2.17% | 7.66% |
| 近地面 / 台阶 | -8.09% | 13.11% |

误差定义为有效表面像素在线性 RGB 下的 `mean(abs(test - reference)) / mean(reference)`。数值仍包含参考路径追踪噪声，属于本样区诊断数据，不是全图画质验收阈值。

结论：现有几何密度下，顶点 GI 是可继续验证的低频间接光路线，资源成本较低；近景墙角和局部亮斑仍需要对比局部细分或局部 lightmap。合并顶点可以保留，法线与 CORNER 数据必须正确处理。

### 已保存的实验资源

- `public/experiments/vertex-gi/map_vertex_gi.glb`
- `public/experiments/vertex-gi/vertex-gi.info.json`
- `public/experiments/vertex-gi/comparison.json`
- `public/experiments/vertex-gi/gi-only-comparison.json`
- `D:/download/blender/瓦_vertexGI_source.blend`：带 GI 属性、恢复面角法线的源材质版本，用于后续处理/导出。
- `D:/download/blender/瓦_vertexGI_preview.blend`：Cycles 中的“顶点 GI + 实时直射”预览材质版本，用于查看效果。

预览版本使用额外着色节点和零漫反射反弹来模拟运行时，glTF 导出使用 source 版本。

截图、线性中间图和原始检查数据位于本次工作目录：

`F:/Temp/opencode/vertex-gi-20261105-162214/`

## 重现

在场景副本上执行，`--work` 应位于 `F:/Temp/opencode`：

```text
blender --factory-startup --background source.blend --python-exit-code 1
  --python tools/bake_vertex_gi.py -- --project PROJECT --work WORK --phase bake

blender --factory-startup --background WORK/vertex-gi.blend --python-exit-code 1
  --python tools/bake_vertex_gi.py -- --project PROJECT --work WORK --phase preview

node tools/verify_vertex_gi.mjs WORK
```

完成 preview 后，可在 `vertex-gi.blend` 上执行 `--phase diagnostic --render-samples 1024`，提高 GI 独立参考图的采样数。

如果使用 `--restore-normals NORMALS.npz`，必须先验证快照与当前场景的面角位置、UV 和拓扑对应关系；法线文件仅适用于生成它的几何快照。
