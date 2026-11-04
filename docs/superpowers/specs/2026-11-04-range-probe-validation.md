# 练枪房离线探针接入与验证

[Render 层升级设计](./2026-11-04-render-upgrade-design.md) 已确定采用离线 lightmap、局部 SH 探针与少量实时光。本文记录的是此前用练枪房、门口和长廊的三份离线探针完成的路线小样。Three.js r187 的 WebGPU 小样里，同一朝向的人偶经过门口时逐渐变暗，进入长廊后回亮。门口前后紧邻的 GPU 读数一致。

小样验证了指定路线的 SH 混合，正式静态 lightmap、三维区域选点、光源贡献拆分与完整渲染管线仍待实现和验收。

## 场景与文件

- Blender 源文件为 `D:/workplace/blender/瓦.blend`。已从磁盘确认 `窗洞｜台阶补光` 集合中的四盏面光，以及 `lightprobe` 集合中的三个白模和两条示例线。用于标窗洞的平面已从渲染中排除。
- 最新探针来自四盏窗光开启后的三张线性 OpenEXR。每个点存 9 组线性 RGB 球谐辐亮度系数，顺序与 `SphericalHarmonics3` 一致。正式接入时，可将 JSON 放进 `public/probes/range-probes.json`，把原始 EXR 留在离线资产目录供重烘或重新投影。 [新版探针 JSON](C:/Users/hx238/.codex/visualizations/2026/11/04/01a1a687-9d10-7072-97f7-e01e30dcf006/range-probe-window-lighting/range-probes.json)
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

共读取 84 个 GPU 采样点。GPU 与 CPU 计算的最大绝对差为 0.00013。门口中心前后各 0.03 单位的 GPU 读数均为 0.14871。该结果覆盖既定路线上的过渡。静态 lightmap 效果、自由移动时的探针选择和整套渲染管线的帧预算仍需在正式接入后验收。

[测试包](C:/Users/hx238/.codex/visualizations/2026/11/04/01a1a687-9d10-7072-97f7-e01e30dcf006/range-probe-walk/probe-walk-kit.zip) · [完整数值](C:/Users/hx238/.codex/visualizations/2026/11/04/01a1a687-9d10-7072-97f7-e01e30dcf006/range-probe-walk/report.json) · [练枪房截图](C:/Users/hx238/.codex/visualizations/2026/11/04/01a1a687-9d10-7072-97f7-e01e30dcf006/range-probe-walk/shot-range.png) · [门口截图](C:/Users/hx238/.codex/visualizations/2026/11/04/01a1a687-9d10-7072-97f7-e01e30dcf006/range-probe-walk/shot-door.png) · [长廊截图](C:/Users/hx238/.codex/visualizations/2026/11/04/01a1a687-9d10-7072-97f7-e01e30dcf006/range-probe-walk/shot-corridor.png) · [连续过门视频](C:/Users/hx238/.codex/visualizations/2026/11/04/01a1a687-9d10-7072-97f7-e01e30dcf006/range-probe-walk/probe-walk.mp4)

## 放回渲染升级计划

1. 先对齐 `pnpm-lock.yaml` 和 r187 依赖，验证冻结安装能复现当前环境。建立最小 render system，加载实际地图并记录固定机位与帧耗时基准。
2. 先做门口同机位样板，将 Blender 烘焙的静态照明接入地图，同时放入使用探针的人偶。统一色彩管理，分清离线光照与实时太阳的贡献，验证环境和人物能否匹配。
3. 将局部探针作为正式方案接入练枪房和长廊，按三维区域、空间位置和门洞连通关系混合。现有 JSON 需补充区域与光源分工信息，按路线里程取样仅保留为回归测试。扩展检查自由移动、台阶与区域边界。
4. 按修订后的设计逐项验收 GTAO、抗锯齿、色调映射、调色与材质反射，记录加载、显存及 CPU / GPU 帧预算。
