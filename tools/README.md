# tools 秒懂

`tools/` 里的脚本只服务练枪房这条资产和验收链路。表按重要程度从上到下：先是每次改完都该跑的检查，然后是改模型、光照、碰撞时才跑的导出，最后是被别的脚本调用的库。

在项目根目录执行。浏览器脚本默认找 `C:/Program Files/Google/Chrome/Application/chrome.exe`，换路径时设 `CHROME_PATH`。截图和 `report.json` 写到 `D:/opencode-temp/opencode/...`，换目录时设 `ROOM_TEST_OUTPUT`。失败时进程退出码为 1，先看终端里的 `passed` / `failure`。

## 1. 每次改完都跑

| 文件 | 什么时候用 | 怎么跑 |
| --- | --- | --- |
| `validate-room-assets.mjs` | 换过 GLB 或 atlas，核对 manifest 的 SHA-256 和绑定 | `pnpm validate:room` |
| `check-room-browser.mjs` | 整房画面、采样、曝光、参考机位 | `pnpm preview` 后 `node tools/check-room-browser.mjs http://localhost:4173/` |
| `check-player-browser.mjs` | 出生、撞墙、跳跃、掉出地图 | `pnpm dev` 后跑，会自己设 `probes=0` |
| `check-pipeline-browser.mjs` | 法线预通道、lightmap 材质、AO、分辨率 | **必须**开发服务器 `http://localhost:5173/` |
| `check-runtime-browser.mjs` | 有 / 无 Editor 重载、独立渲染 | 同上，必须开发服务器 |

```powershell
pnpm test
pnpm validate:room
pnpm build
pnpm preview
node tools/check-room-browser.mjs "http://localhost:4173/"
```

渲染或玩法改动再开开发服务器，按这个顺序补：

```powershell
pnpm dev
node tools/check-player-browser.mjs "http://localhost:5173/"
node tools/check-pipeline-browser.mjs "http://localhost:5173/"
node tools/check-runtime-browser.mjs "http://localhost:5173/"
```

`check-room` 会加上 `profile=1` 和 `player=0`。`check-pipeline` 和 `check-runtime` 会从开发服务器加载 `tests/*-browser-cases.js`，把 `pnpm preview` 的地址喂给它们会失败。

`validate-room-assets.mjs` 默认读 `public/lighting/range-room-lightmap/manifest.json`。查另一套资源时把 manifest 路径放在后面，例如 `node tools/validate-room-assets.mjs public/lighting/range-room/manifest.json`。

## 2. 改房间资源才跑

导出和重烘要求 `blender --background` 打开的是**场景副本**。`--project` 指向一个还不存在 `public/model/range-room*.glb` 和对应 `manifest.json` 的暂存目录；正式仓库当输出目录会被拒绝。`scope.json` 至少包含 `objects`（要导出的网格名列表）和 `sourceBlend`。

| 文件 | 什么时候用 | 怎么跑 |
| --- | --- | --- |
| `export_range_room.py` | 从场景副本导出 GLB + atlas + manifest | 后台 Blender，下面第一条命令 |
| `bake_range_room_lightmaps.py` | 重烘已有 BakeUV | 后台 Blender |
| `repair_blender_alpha.py` | 检查 / 修正 glTF 透明模式 | 导出器会自动调用；手跑见本节末尾 |
| `export_collision.py` | 导出碰撞盒 JSON | 后台 Blender，或在已打开的场景里执行 |
| `bake_range_room_supplement.py` | 给指定物体追加一页新 lightmap | 后台 Blender，补烘才需要 |
| `export_probe_volumes.py` | 导出探针盒子 `volumes.json` | 在 Blender 里 `runpy`，没有命令行参数 |
| `bake-room-probes.mjs` | 在浏览器里重捕探针并写回资源 | `pnpm dev` 之后，见「探针」 |

```powershell
$blender = 'F:\Blender5.3\blender.exe'
$project = 'E:\graphic\MC_VALORANT'
$work = 'D:\opencode-temp\opencode\lightmap-bake'
$candidate = Join-Path $work 'candidate'

& $blender --background "$work\source-snapshot.blend" --python-exit-code 1 `
  --python "$project\tools\export_range_room.py" -- `
  --project $candidate `
  --scope "$work\scope.json"
```

可选：`--reference-dir` 多渲一张参考图；`--lightmap-report` 把已完成的 light-only 烘焙写成 `range-room-lightmap` 资源；`--reuse-atlases <manifest.json>` 原样复制已有图集；再加 `--allow-new-atlases` 才允许旁边出现新页。

重烘已有 BakeUV（512 samples，CUDA）：

```powershell
& $blender --background "$work\source-snapshot.blend" --python-exit-code 1 `
  --python "$project\tools\bake_range_room_lightmaps.py" -- `
  --project $candidate `
  --scope "$work\scope.json" `
  --work $work `
  --samples 512 `
  --device CUDA
```

`--validate-only` 只检查范围和 UV。`--reuse-lightmaps <manifest.json>` 核对几何后直接导出，不启动 Cycles。`--reuse-pages B01 B02` 复用本次工作目录里已经烤完的同名 EXR。

`repair_blender_alpha.py` 直接运行只打印分类，不改节点。确认备份之后才加 `--apply`。全不透明断开 Alpha，硬边镂空插入 Round 变成 MASK，真正的半透明保持 BLEND。

```powershell
& $blender --background "$work\snapshot.blend" --python "$project\tools\repair_blender_alpha.py"
& $blender --background "$work\snapshot.blend" --python "$project\tools\repair_blender_alpha.py" -- --apply
```

碰撞层只读，写出 `public/collision/range-room.json`。集合名是 `COLLISION_PracticeRoom`，出生点对象名是 `Spawn`。场景已经打开时，先设 `COLLISION_ARGS = ['--out', r'绝对路径']`，再执行该文件。

```powershell
& $blender --background "$work\room.blend" --python-exit-code 1 `
  --python "$project\tools\export_collision.py" -- `
  --out "$project\public\collision\range-room.json"
```

补烘指定物体到新页（默认 `B06`，1024²）时，源物体、材质清单、旧 manifest、完整 scope 和暂存项目都要给全：

```powershell
& $blender --background "$work\previous-export.blend" --python-exit-code 1 `
  --python "$project\tools\bake_range_room_supplement.py" -- `
  --source "$work\authoring-snapshot.blend" `
  --source-materials "$work\materials.json" `
  --previous "$project\public\lighting\range-room-lightmap\manifest.json" `
  --scope "$work\scope.json" `
  --project $candidate `
  --work $work `
  --objects Stone_Slab.001 wall
```

体积盒子来自 Blender 集合 `LightProbeVolumes`：

```python
import runpy
export = runpy.run_path(r'E:\graphic\MC_VALORANT\tools\export_probe_volumes.py')
export['export_volumes'](r'E:\graphic\MC_VALORANT\public\lighting\range-room-probes\volumes.json')
```

辐照度重捕会覆盖 `public/lighting/range-room-probes/probe-atlas.bin` 和 `cache.json`。换输出目录时设 `PROBE_OUTPUT`。页面需要已经启用探针：

```powershell
pnpm dev
node tools/bake-room-probes.mjs "http://localhost:5173/"
```

完整范围、页绑定和复现命令见 [Lightmap v1](../docs/lighting/lightmap-v1.md)。导出步骤见 [Blender → Three.js](../docs/blender-to-threejs-export-workflow.md)。碰撞格式见 [碰撞层](../docs/physics/collision-layer.md)。透明分类见 [Alpha 缺面修复](../docs/blender-alpha-repair.md)。

## 3. 对过某块功能再跑

| 文件 | 什么时候用 | 怎么跑 |
| --- | --- | --- |
| `check-probes-browser.mjs` | 282 个预计算探针是否接上 | `node tools/check-probes-browser.mjs http://localhost:5173/`，会自己设 `profile=1` |
| `check-ground-browser.mjs` | 房间外石英砖和草皮 | 同上，会自己设 `player=0` |
| `check-inspection-browser.mjs` | 飞行 / 轨道相机、阴影、观察 HUD | 同上，会自己设 `player=0` |
| `benchmark-room.mjs` | 对比两个地址的 GPU / CPU 耗时 | `node tools/benchmark-room.mjs <urlA> <urlB>`，会自己设 `profile=1` |

`benchmark-room` 按参数顺序逐个开页面，避免两套场景抢 GPU。

## 4. 不用单独打开

| 文件 | 谁在用 |
| --- | --- |
| `browser-session.mjs` | 上面所有 `check-*-browser.mjs`、`benchmark-room.mjs`、`bake-room-probes.mjs` |
| `lightmap_uv.py` | `bake_range_room_lightmaps.py`，检查 BakeUV 是否重叠 |
| `supplemental_lightmap_uv.py` | `bake_range_room_supplement.py`，打包和回放补烘 UV |
| `fix_mcprep_gltf_alpha.py` | 旧的 MCprep 插件。装上之后用侧栏 **MCprep → glTF 导出 → 修复 glTF 透明**。当前房间导出走 `repair_blender_alpha.py` |
