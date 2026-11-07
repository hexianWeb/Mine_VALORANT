# Blender → Three.js 模型导出工作流

更新日期：2026-11-07。适用范围：本项目的 **renderer V1 / range-room-v3 单房间资源管线**。

> 当前房间不能只导出一个 GLB，再覆盖 `range-room.glb`。正确交付单位是 **GLB + 五张 EXR + 匹配的 manifest**。制作源文件、导出副本和候选输出应分开管理。

## 1. 整体流程与资源分工

```text
Blender 制作文件
  → 保存导出副本，确定对象清单
  → 后台检查 Alpha、规范化导出材质、保留 UV 和对象标识
  → 输出候选 GLB + 五张 EXR + manifest
  → 校验文件、UV 和 primitive 绑定
  → 备份并成套替换正式资源
  → Three.js 材质重建、浏览器检查
```

| 内容 | 如何交付与使用 |
|---|---|
| 房间几何、原始纹理/PBR、UV、对象标识 | 放入 GLB，由加载器读取 |
| 已完成的五页烘焙外观 | 外置半浮点场景线性 EXR，由运行时明确绑定 |
| 对象分类、atlas/UV 对应、hash、顶灯和参考相机 | 写入 manifest |
| 原始方块物件的实时照明 | Three.js 重建灯光，为未烘焙材质提供照明 |
| AO、显示变换、LUT、抗锯齿 | Three.js 运行时处理，不期待从 Blender 自动导入 |

正式资源目录：

```text
public/model/range-room.glb
public/lighting/range-room/manifest.json
public/lighting/range-room/atlases/B01.exr
public/lighting/range-room/atlases/B02.exr
public/lighting/range-room/atlases/B03.exr
public/lighting/range-room/atlases/B04.exr
public/lighting/range-room/atlases/B05.exr
```

## 2. 为什么不能直接导出覆盖

### 2.1 GLB 不是完整的 Blender 场景

glTF 能表达标准 PBR，但不能完整搬运任意 Cycles 节点、Light Path / Mix Shader 分支、World、渲染设置和显示变换。

本场景同时存在原始 Principled 材质和用于烘焙预览的自发光分支。导出脚本会在副本中临时连接现有节点结构的原始表面分支；Three.js 再按 manifest 创建以下材质路径：

- `baked-appearance`：显示已经包含底色与烘焙照明的 atlas。
- `realtime`：保留原始 PBR、纹理和透明语义，接受运行时照明。
- `fixture-emissive`：显示灯具发光外观，实际照明另由灯光负责。

不能假设点击“导出 GLB”后，Blender 预览分支会自动变成 Three.js 中同样的效果。

### 2.2 此前“转动视角缺面”的主要原因是 Alpha 分类错误

本场景曾有大量实体材质的图像 Alpha 全为 1，但仍连接到 Principled Alpha，导出结果被判为 `BLEND`。加载后进入透明排序和关闭深度写入的路径，导致物件互相穿透，看起来像缺面。

| 材质内容 | glTF 模式 | 本项目处理 |
|---|---|---|
| 石块、木块等不透明实体 | `OPAQUE` | 断开多余 Alpha 连接，Principled Alpha 设为 1 |
| 树叶、铁栏杆等二值镂空 | `MASK` | 保留 Alpha 裁剪，当前工具使用 Math Round，阈值 0.5 |
| 真正连续透明的玻璃等 | `BLEND` | 保留连续透明度 |

当前基线为 **109 OPAQUE / 35 MASK / 4 BLEND**。这是当前资源的统计，不是所有未来模型必须满足的数量。

不要将全部材质设为透明、全部强制不透明，或只靠开启双面渲染修复。Blender 5.x 下，修改材质界面的 Dithered/Blended 设置也不一定能纠正 glTF 的节点判断结果。

工具 [`repair_blender_alpha.py`](../tools/repair_blender_alpha.py) 默认只检查，显式 `apply=True` 或 `--apply` 才修改节点。房间导出脚本已在后台副本中调用修复，不需要先改动制作源文件。未知节点结构会报告为 `UNKNOWN`，应检查材质而不是绕过错误。

### 2.3 新 GLB 不能继续配旧 manifest

manifest 记录模型/图集 SHA-256，以及每个接收面的对象标识、mesh/primitive 索引、材质分类、atlas 和 UV 通道。

重新导出、重命名、增删物件或调整材质槽，都可能改变标识或索引。即使画面看起来一样，也不能保证新旧绑定兼容。普通手动导出还可能缺少 `rangeRoomId`、`rangeRoomMaterial` 等自定义属性。

**不要只更新 hash 来绕过校验。必须根据实际 GLB 重新生成并验证绑定。**

## 3. Blender 导出前检查

- [ ] 使用已修复透明模式的制作文件，保存当前修改，再另存导出副本。
- [ ] 原始 PNG 和五张降噪 atlas 可读取；修改后的图像已保存或正确打包。
- [ ] 明确本次房间对象范围，不把无关模型或旧地图加入清单。
- [ ] 原始纹理 UV 与 `BakeUV` 均保留，不在导出时重新展开或重排。
- [ ] 检查法线、负缩放和修改器；不要无条件全选后应用所有变换。
- [ ] 保留正确的场景单位、参考相机和三盏参考顶灯。
- [ ] 如果改变了已烘焙几何、UV 或照明布局，先确认已有烘焙是否仍然有效。

### UV 与坐标约定

- 原始 UV 用于方块 PNG；`BakeUV` 用于烘焙图。
- glTF 的 `TEXCOORD_0` 对应 Three.js 的 `uv`，`TEXCOORD_1` 对应 `uv1`。不能仅凭 UV 层名字猜通道，应验证导出结果。
- 当前坐标转换为 Blender `(x, y, z)` → Three.js `(x, z, -y)`。GLB 已完成 Y-up 转换，运行时不要再次旋转整个模型。
- 手动处理参考相机时还需注意四元数顺序：Blender 与 Three.js 的表示不同；现有脚本已完成转换。

## 4. 分步导出操作

### 第一步：准备临时导出副本

建议目录：

```text
D:/opencode-temp/opencode/room-export/
  snapshot.blend
  scope.json
  candidate-日期时间/
```

在 Blender 中将用于本次导出的场景另存为 `snapshot.blend`。不要覆盖唯一的制作源文件，不需要重新展开 UV 或重烘已确认有效的 atlas。

### 第二步：生成显式对象清单

在导出副本中选中所有需要导出的房间 Mesh，然后在 Blender 文本编辑器运行：

```python
import bpy
import json
from pathlib import Path

if not bpy.data.filepath:
    raise RuntimeError('请先保存导出副本')

objects = sorted(
    obj.name for obj in bpy.context.selected_objects
    if obj.type == 'MESH'
)
if not objects:
    raise RuntimeError('请先选中需要导出的 Mesh')

path = Path(r'D:\opencode-temp\opencode\room-export\scope.json')
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(json.dumps({
    'sourceBlend': bpy.data.filepath,
    'objects': objects,
}, ensure_ascii=False, indent=2), encoding='utf-8')
```

核对清单是否完整。清单仅列 Mesh，但副本场景仍需保留参考灯和激活相机，脚本会单独读取它们。

### 第三步：在后台 Blender 中导出候选资源

在 PowerShell 中执行。将 `$blender` 改为本机可执行文件路径；`snapshot.blend` 与 `scope.json` 必须已准备好。

```powershell
$blender = "你的Blender安装目录\blender.exe"
$project = "E:\graphic\TSL\three.js-tsl-template"
$work = "D:\opencode-temp\opencode\room-export"
$candidate = Join-Path $work ("candidate-" + (Get-Date -Format "yyyyMMdd-HHmmss"))

New-Item -ItemType Directory -Force "$candidate\public\model" | Out-Null

& $blender --background "$work\snapshot.blend" `
  --python "$project\tools\export_range_room.py" -- `
  --project "$candidate" `
  --scope "$work\scope.json"

if ($LASTEXITCODE -ne 0) {
    throw "导出失败，请检查 Blender 日志；不要发布本次候选资源。"
}
```

使用候选目录而不是正式项目作为 `--project`。脚本拒绝覆盖已有模型或 manifest；发生拒绝时应选择新的候选目录，不要删除正式资源来让脚本继续。

当前 [`export_range_room.py`](../tools/export_range_room.py) 会：

1. 确认处于后台 Blender，读取显式 Mesh 清单。
2. 在副本中检查、规范化真实 Alpha 分类。
3. 保存五页 RGBA、16-bit half、ZIP 压缩的场景线性 EXR，并检查有限值与非空内容。
4. 规范化当前房间的导出材质，写入对象和材质标识，保留 UV。
5. 导出所选模型及自定义属性，不在 GLB 中导出灯、相机或动画。
6. 读取实际导出的 GLB，检查 UV 和分类，生成 hash、primitive 绑定、顶灯与相机数据。

可选参数 `--reference-dir` 可输出 Blender 参考截图；这会额外渲染参考帧，不是重新烘焙 atlas。

> **工具边界：** 这是当前房间的专用导出器，不是任意 `.blend` 的通用转换器。它依赖五张以 `DENOISED_HDR__B` 开头的降噪图、烘焙对象的 `BakeUV`、当前材质分支结构和三盏名称包含“连续顶灯”的参考灯。Alpha 检查覆盖当前场景实际有面使用的材质，不仅限于 scope；场景内其他未知材质也可能使检查失败。新场景或新节点约定需要先调整并验证工具。

### 第四步：验证候选输出

继续在上述 PowerShell 会话中执行：

```powershell
Set-Location $project
node tools/validate-room-assets.mjs "$candidate\public\lighting\range-room\manifest.json"

if ($LASTEXITCODE -ne 0) {
    throw "候选资源校验失败，不能替换正式资源。"
}
```

检查包括模型/图集 hash、GLB 结构、对象标识、primitive/材质绑定、烘焙 UV 和未分类 primitive。EXR 解码等检查另由后续回归测试覆盖。

导出中途失败可能留下不完整文件。仅有 GLB 或部分 EXR 不代表成功，应查看完成日志并通过上述验证。

### 第五步：成套替换正式资源

1. 备份当前 GLB、manifest 和五张 EXR，记录对应版本；临时备份放在 `D:\opencode-temp` 下。
2. 核对候选内容，仅替换本指南第 1 节列出的正式资源。
3. GLB、manifest 和 EXR 必须来自同一套已验证输出。图集未变化时可以复用，但必须确认 hash 和绑定一致。
4. 完成下一节的测试与浏览器检查后再提交。若不通过，恢复完整的旧资源组合，不混用新旧文件。

不要直接手改 GLB JSON、仅替换模型或仅更新 manifest 的 hash。

## 5. Three.js 侧必须保留的规则

### 烘焙外观不等于普通底色或纯 lightmap

五页 EXR 已包含底色与烘焙照明，因此不能再乘一次原始底色、直接当成纯照明赋给 `material.lightMap`，或重复接受原静态灯与 AO。

[`materials.js`](../src/world/materials.js) 根据分类重建运行时材质。走廊是明确设计的局部补光例外：保留 atlas 辐射，仅额外接受三盏新增点光的局部漫反射，不重复叠加原顶灯、环境或 AO。

### UV 方向只修正一次

当前这批 GLB/EXR 已验证使用：

```js
texture(atlas, uv(binding.uvChannel).flipY()).rgb
```

EXR 纹理本身保持 `flipY = false`。不要再翻转图像，也不要把这个规则机械套到所有 PNG；这是本批资源的方向配合，不是所有模型的通用要求。

### 色彩空间和过滤策略分开管理

| 资源 | 色彩解释 | renderer V1 当前策略 |
|---|---|---|
| 原始颜色 PNG | sRGB | 放大/缩小均为 `NearestFilter`，关闭 mip，保持像素风 |
| 法线、粗糙度等数据图 | 非颜色数据 | 不进行 sRGB 解码 |
| 五页烘焙 EXR | 场景线性 Rec.709 | 线性/三线性、0–2 级 alpha 加权 mip，最高 16× 各向异性 |

WebGPU 的各向异性要求线性过滤，因此最近邻原始贴图使用 anisotropy 1。不要为消除模糊而错误修改 PNG 色彩空间，也不要为减少远景闪烁而将所有像素贴图改成线性过滤。

manifest 保留源资产的基础级采样协议；当前有限 mip 是 [`texture-sampling.js`](../src/world/texture-sampling.js) 创建的运行时包装，不修改源 EXR 或 UV。

### 灯光与显示效果需要运行时重建

- Blender 的 Area Light、World 和显示设置不会完整自动还原。
- 当前三排矩形灯由记录重建；Blender 瓦特数不能直接作为 Three.js `intensity`，且当前 RectAreaLight 不支持阴影。
- 发光材质不自动成为照亮其他物体的实时光源。
- renderer V1 使用 Reinhard、`toneMappingExposure = 1.2`，不是 1.2 EV。与 Blender AgX 预览存在差异，不应全部归咎于导出错误。

## 6. 替换后的验证与验收

在项目目录运行：

```powershell
npm run validate:room
npm test
npm run build
```

分别确认每条命令成功后再继续。当前基线含 135 个非空 Mesh 节点、199 个 primitive；一个对象可能因多材质拆成多个 primitive，UV/法线接缝也可能使导出顶点数增加，不一定是错误。

测试中包含当前对象数量、Alpha 分类等固定预期。若确实增删了物件，应先核对新导出，再有依据地更新预期，不能只为通过测试修改数字。

浏览器自动检查需要先启动预览服务。终端 A：

```powershell
npm run preview -- --host 127.0.0.1 --port 4173 --strictPort
```

保持服务运行，在项目目录的终端 B 执行：

```powershell
node tools/check-room-browser.mjs http://127.0.0.1:4173/
```

截图、浏览器配置和报告默认保存到 `D:/opencode-temp/opencode/range-room-browser`，不放入正式资源目录。

人工检查：

- [ ] 原参考机位下模型范围、位置和方向正确。
- [ ] 转动视角时实体没有穿透或不稳定“缺面”。
- [ ] 树叶、栏杆正确镂空；真实玻璃仍有半透明。
- [ ] 原始像素贴图清晰，各 atlas 的方向、位置、接缝正确。
- [ ] AO 不重复压暗烘焙表面；实时物件有基础照明。
- [ ] 走廊补光、远景纹理和相机运动没有新增明显异常。

## 7. 常见问题与更新边界

| 现象 | 优先排查 |
|---|---|
| 转动视角时穿透、像缺面 | 实体是否误导出为 BLEND，透明排序与深度写入是否异常 |
| 某个面始终只从一侧可见 | 法线、背面剔除、负缩放；不要与透明排序问题混为一谈 |
| 烘焙图上下反、贴错位置 | BakeUV 通道和唯一一次 V 翻转，不要反复翻图片 |
| 像素风物件模糊 | 运行时 minFilter / magFilter，不是先改图片色彩空间 |
| 烘焙表面过暗或重复受光 | 是否又乘底色、误当 lightMap 或重复叠加灯光/AO |
| SHA-256 / stable association / binding 报错 | GLB 与 manifest 是否配套，自定义标识和 primitive 索引是否有效 |
| 导出时报已有资源 | 使用新的候选目录，不删除正式资产绕过保护 |
| 与 Blender 的亮度不一致 | 先核对显示变换、曝光、实时灯与环境，不先修改 atlas 像素 |

| 修改内容 | 通常需要做什么 |
|---|---|
| 修改未烘焙道具的材质或 Alpha | 重新导出并生成匹配 manifest，通常不必重烘墙体 |
| 增删、重命名物件或调整材质槽 | 更新 scope，重新导出并验证绑定 |
| 修改已烘焙几何、UV 或照明布局 | 重新评估烘焙有效性，必要时重烘相关内容 |
| 仅修改 AO、LUT、曝光或纹理过滤 | 修改运行时配置，不需要重新导出模型 |

## 8. 相关文件

- [房间导出脚本](../tools/export_range_room.py)
- [Alpha 检查与修复工具](../tools/repair_blender_alpha.py)
- [资源校验 CLI](../tools/validate-room-assets.mjs)
- [Three.js 房间加载与绑定](../src/world/room-assets.js)
- [透明模式问题与已完成修复](blender-alpha-repair.md)
- [renderer V1 实施与验证记录](lighting/range-room-v3-implementation.md)

**原则：保留制作成果，在副本中规范化导出；模型、图集和 manifest 配套；通过实际校验与画面检查后再发布。**
