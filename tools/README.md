# tools 秒懂

`tools/` 里的脚本服务练枪房与武器的资产和验收链路。表按重要程度从上到下：先是每次改完都该跑的检查，然后是改模型、光照、碰撞时才跑的导出，最后是被别的脚本调用的库。

## 武器发布

`weapons/publish.mjs` 使用 `weapons/recipes.mjs` 中的显式配方，从当前 Classic Smite / Phantom Tactiplay 制作文件导出。使用全新后台 Blender，不连接用户的 Blender、不保存或重写源 `.blend`。源文件路径相对项目根；原动作元数据来自 `--source-pack`。首次发布输出 `public/weapons/<weaponId>/v1/`；只有全部校验通过才复制资源，最后写入口 manifest。已经存在的版本必须逐文件字节一致，否则拒绝覆盖，变更需更新配方的 assetVersion。

```powershell
node tools/weapons/publish.mjs --blender 'D:/game/steamapps/common/Blender/blender.exe' --source-pack 'D:/Projects/vandal-roundtrip/valorant-first-person-pack'
node tools/weapons/publish.mjs --verify-only
node --test tests/weapon-publication.test.mjs
```

可在末尾指定 `classic` 或 `phantom`；省略则发布两枪。`BLENDER_PATH` 可代替 `--blender`，`--out-root` 可指定独立候选目录。原包默认位置为相邻 `vandal-roundtrip/valorant-first-person-pack`。官方 glTF Validator 使用项目开发依赖，其他安装位置仍可用 `--validator-module` 指定。暂存目录默认在 `D:/opencode-temp/opencode`，可用 `--work-root` 改变。已验证模型导出环境为 Blender 5.3.0；其他版本需重新通过校验，不假定产物字节相同。

### 兼容皮肤发布

Classic 当前使用 v2（smite/sakura），复用 v1 GLB，增加独立皮肤及审计记录，不覆盖旧模型。v1 现有本地 weapon.png 替换保留；仅修正其皮肤 JSON/manifest 中错误的尺寸与哈希，新发布中按内容哈希复制这些像素。

```powershell
& 'F:/Blender5.3/blender.exe' --background --factory-startup --disable-autoexec --python-exit-code 1 --python tools/weapons/audit_skin_blender.py -- --manifest public/weapons/classic/v1/manifest.json --base-blend skin_work_folder/classic_skin_work/Classic_Smite_Animated.blend --skin-blend skin_work_folder/classic_skin_work/Classic_Sakura_Animated.blend --texture skin_work_folder/classic_skin_work/classic_sakura_weapon.png --out D:/opencode-temp/opencode/weapon-stage4/sakura-audit.json
node tools/weapons/publish-skins.mjs tools/weapons/skin-releases/classic-v2.json
node --test tests/weapon-skin-publication.test.mjs
```

`audit_skin_blender.py` 只读打开两份制作源，核对 SourceUV、几何/权重、rest rig、全部动作与 packed PNG，不保存文件。审核后的证据由显式配方引用；更新证据前应复核命令输出。`publish-skins.mjs` 验证原包、证据与源文件哈希后生成新版本，已有目标版本必须字节一致。Sakura 当前审计环境为 Blender 5.2.3 LTS；它没有重新导出 v1 GLB。

导出只选择配方列出的运行时网格与四套动画 Armature，排除 Icosphere 自定义骨形和预览摄像机。保留多对象 Action、STEP 可见性和原有 SourceUV；规范化时间原点、skinned mesh 根节点、材质 UV 及重复节点名。材质角色区分 weapon / armsLeft / armsRight，皮肤只覆盖 weapon。GLB 内含初始贴图；皮肤 JSON 的纹理 URL 相对皮肤 JSON，其他资源 URL 相对 manifest。挂载位置在 `view.mountOffset`，单位为米，写到 Mixer 根节点外的 anchor，GLB 不再缩放。

发布门槛包括源文件前后 SHA256 一致、packed 皮肤与显式 PNG 一致、完整 clip/mesh/material/socket 绑定、时间原点、循环端点、有限骨骼矩阵、刚性权重、每枪九个 Blender/Three.js 变形包围盒比较，以及 glTF Validator 零 error/零 warning。`source-audit.json` 保存源姿态证据，`validation.json` 保存检查结果。Node 贴图检查读取 PNG 尺寸，不代替真实浏览器的像素解码和 WebGPU 画面验收。普通动作零时刻音效不重复导入为 marker；Classic salvo 等独立 cue 保留。已发布两枪接入主游戏，操作与时钟契约见[武器玩法](../docs/weapons/gameplay.md)；本地声音见[运行时音频](../docs/weapons/audio.md)。后续皮肤素材由用户处理，不自动生成或替换纹理。

`weapons/audit_controls.py` 只读审计 Judge/Odin 的显式 scale 白名单、插值、层级及权重，输出 `tests/fixtures/weapon-controls/` 的可复现数值夹具；不导出模型、材质或图像，也不保存 blend。复核时输出到 `D:/opencode-temp/opencode/weapon-controls/reproduced` 再与保存的夹具比较，运行方式及验收边界见[稀疏控制](../docs/weapons/runtime-controls.md)。正常 npm test 不需要启动 Blender。

在项目根目录执行。浏览器脚本默认找 `C:/Program Files/Google/Chrome/Application/chrome.exe`，换路径时设 `CHROME_PATH`。截图和 `report.json` 写到 `D:/opencode-temp/opencode/...`，换目录时设 `ROOM_TEST_OUTPUT`。失败时进程退出码为 1，先看终端里的 `passed` / `failure`。

## 1. 每次改完都跑

| 文件 | 什么时候用 | 怎么跑 |
| --- | --- | --- |
| `validate-room-assets.mjs` | 换过 GLB 或 atlas，核对 manifest 的 SHA-256 和绑定 | `pnpm validate:room` |
| `check-room-browser.mjs` | 整房画面、采样、曝光、参考机位 | `pnpm preview` 后 `node tools/check-room-browser.mjs http://localhost:4173/` |
| `check-player-browser.mjs` | 出生、撞墙、跳跃、掉出地图 | `pnpm dev` 后跑，会自己设 `probes=0` |
| `check-pipeline-browser.mjs` | 法线预通道、lightmap 材质、AO、分辨率 | **必须**开发服务器 `http://localhost:5173/` |
| `check-runtime-browser.mjs` | 有 / 无 Editor 重载、独立渲染 | 同上，必须开发服务器 |
| `check-weapons-browser.mjs` | Classic/Phantom 真实皮肤、动作采样、实例隔离与释放 | `npm run dev` 后 `node tools/check-weapons-browser.mjs http://localhost:5173/weapon-preview.html`；输出目录用 `WEAPON_TEST_OUTPUT` |
| `check-weapon-gameplay-browser.mjs` | 主游戏真实输入、切枪／打断、射击／ADS、统一表现时间与生命周期 | `npm run dev` 后 `node tools/check-weapon-gameplay-browser.mjs http://localhost:5173/`；输出目录用 `WEAPON_GAME_TEST_OUTPUT` |
| `check-weapon-audio-browser.mjs` | 双枪真实 Ogg 解码与输出波形、音频解锁、连射、取消、暂停/变速及卸载 | `npm run dev` 后 `node tools/check-weapon-audio-browser.mjs http://localhost:5173/`；输出目录用 `WEAPON_AUDIO_TEST_OUTPUT` |

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
node tools/check-weapon-gameplay-browser.mjs "http://localhost:5173/"
node tools/check-weapon-audio-browser.mjs "http://localhost:5173/"
```

`check-room` 会加上 `profile=1` 和 `player=0`。`check-pipeline` 和 `check-runtime` 会从开发服务器加载 `tests/*-browser-cases.js`，把 `pnpm preview` 的地址喂给它们会失败。

`check-weapons-browser` 使用独立资产预览页；`check-weapon-gameplay-browser` 使用默认启用 Player 与 Editor 的主游戏页面，并设置 `probes=0`。后者通过可信鼠标点击捕获 Pointer Lock，检查首击不开火、Classic 半自动、Phantom 自动射速与 ADS、换弹／检视打断、切枪、世界相机与 AimState 采样一致、武器公共表现时间、Editor 交接、暂停输入丢弃、Home 重生和销毁。默认输出为 `D:/opencode-temp/opencode/weapon-gameplay-browser/`，包含截图和 `report.json`；通过状态以本次报告为准。

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
