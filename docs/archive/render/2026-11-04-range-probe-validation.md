# 练枪房离线探针接入与验证

> 归档。历史小样。这条离线探针路线没有进入当前练枪房渲染。实施记录见 [练枪房实施与验证记录](../lighting/range-room-v3-implementation.md)。文档索引见 [docs/README.md](../../README.md)。

本文记录此前用练枪房、门口和长廊的三份离线探针完成的路线小样。Three.js r187 的 WebGPU 小样里，同一朝向的人偶经过门口时逐渐变暗，进入长廊后回亮。门口前后紧邻的 GPU 读数一致。

小样只验证了指定路线的 SH 混合。这条探针方案随后被练枪房烘焙外观渲染替代，没有继续做成正式光照。

## 场景与文件

- Blender 源文件为 `D:/workplace/blender/瓦.blend`。已从磁盘确认 `窗洞｜台阶补光` 集合中的四盏面光，以及 `lightprobe` 集合中的三个白模和两条示例线。用于标窗洞的平面已从渲染中排除。
- 最新探针来自四盏窗光开启后的三张线性 OpenEXR。每个点存 9 组线性 RGB 球谐辐亮度系数，顺序与 `SphericalHarmonics3` 一致。当时准备把 JSON 放到 `public/probes/range-probes.json`，原始 EXR 留在离线资产目录。该接入没有落地。 [新版探针 JSON](C:/Users/hx238/.codex/visualizations/2026/11/04/01a1a687-9d10-7072-97f7-e01e30dcf006/range-probe-window-lighting/range-probes.json)
- JSON 的 `positionByMap` 以 Three.js 的 Y 轴为高。使用 `map_lightmap.glb` 时选择对应坐标，该文件的地图整体比 `map.glb` 高约 2.1763 单位。若加载后再移动地图根节点，探针应随地图应用同样的世界变换。

## 复跑过门验证

从仓库根目录在 PowerShell 中运行以下命令。验证包包含导出的人偶、贴地路线、探针数据和独立测试页面。测试使用工作区已安装的 Three.js r187、`public/model/map.glb` 和 Chrome。Chrome 安装在其他位置时可设置 `PROBE_CHROME`。

```powershell
$probeKit = 'C:/Users/hx238/.codex/visualizations/2026/11/04/01a1a687-9d10-7072-97f7-e01e30dcf006/range-probe-walk/probe-walk-kit.zip'
$probeRun = Join-Path ([IO.Path]::GetTempPath()) ('probe-walk-' + [Guid]::NewGuid())
Expand-Archive -LiteralPath $probeKit -DestinationPath $probeRun
$env:PROBE_WORKSPACE = (Get-Location).Path
node (Join-Path $probeRun 'driver.mjs') check
```

脚本会在解压目录生成 `report.json` 及三张截图。小样按人偶胸口所在的路线区间，对相邻探针的球谐系数做 smoothstep 混合。人偶材质单独接收探针，背景地图用固定的测试灯光。录像里的相机跟随人偶，曝光和人偶朝向固定。数值对照在 WebGPU 上读取一块朝向固定的中性漫反射面，单独检查探针的亮度变化。

| 位置 | GPU 线性亮度 |
|---|---:|
| 练枪房 | 0.23053 |
| 门口 | 0.14871 |
| 长廊 | 0.22207 |

共读取 84 个 GPU 采样点。GPU 与 CPU 计算的最大绝对差为 0.00013。门口中心前后各 0.03 单位的 GPU 读数均为 0.14871。该结果覆盖既定路线上的过渡。

[测试包](C:/Users/hx238/.codex/visualizations/2026/11/04/01a1a687-9d10-7072-97f7-e01e30dcf006/range-probe-walk/probe-walk-kit.zip) · [完整数值](C:/Users/hx238/.codex/visualizations/2026/11/04/01a1a687-9d10-7072-97f7-e01e30dcf006/range-probe-walk/report.json) · [练枪房截图](C:/Users/hx238/.codex/visualizations/2026/11/04/01a1a687-9d10-7072-97f7-e01e30dcf006/range-probe-walk/shot-range.png) · [门口截图](C:/Users/hx238/.codex/visualizations/2026/11/04/01a1a687-9d10-7072-97f7-e01e30dcf006/range-probe-walk/shot-door.png) · [长廊截图](C:/Users/hx238/.codex/visualizations/2026/11/04/01a1a687-9d10-7072-97f7-e01e30dcf006/range-probe-walk/shot-corridor.png) · [连续过门视频](C:/Users/hx238/.codex/visualizations/2026/11/04/01a1a687-9d10-7072-97f7-e01e30dcf006/range-probe-walk/probe-walk.mp4)
