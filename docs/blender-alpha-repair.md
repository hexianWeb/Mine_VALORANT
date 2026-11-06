# Blender 导出转动视角时“缺面”的修复

本场景不是背面剔除：全部 148 个导出材质已经是双面，也没有负缩放或退化三角形。问题是大量实体纹理的 Alpha 即使全为 1，仍连接到 Principled BSDF 的 Alpha；Blender 的 glTF 导出器因此将其识别为 `BLEND`。Three.js 对这类材质关闭深度写入，并按物体而非逐三角形排序，导致墙面、地面和物件互相穿透。

## 已完成的源文件修复

修复后的文件：`F:\temp\07_已烘焙贴图_降噪预览_透明修复.blend`。原文件未覆盖。

- 98 个多余的图像 Alpha 连接已断开，Principled Alpha 设为 1，原生导出为 `OPAQUE`。
- 35 个二值镂空材质改为 `图像 Alpha → 数学 Round → Principled Alpha`，原生导出为 `MASK`，阈值 0.5。
- 4 个确实含中间透明度的玻璃/绊线材质保留 `BLEND`，不强制不透明。
- 总计为 109 个 `OPAQUE`、35 个 `MASK`、4 个 `BLEND`。
- 未改变几何、法线、UV、灯光、5 张烘焙图或 Blender 烘焙预览分支。

Blender 5.x 的 glTF 导出器通过节点判断 Alpha 模式，不能仅靠修改 Eevee 的 Dithered/Blended 选项修复。后续应使用修复后的 `.blend`，继续沿用 `tools/export_range_room.py` 的房间导出流程；不需要导出后手改 GLB 的 Alpha 标签。

## 工具与校验

`tools/repair_blender_alpha.py` 可在 Blender 中检查材质；默认只检查，`repair_scene_alpha(apply=True)` 才修改节点。仅处理当前场景实际有面使用的材质，未知节点图不会自动改写，重复执行不会增加节点。使用前先另存备份。

本次已从修复后的文件在后台执行原生 glTF 导出，更新 `public/model/range-room.glb` 和 manifest 的 SHA-256。199 个 primitive 的顶点、法线、UV、索引、变换和绑定逐项校验与旧模型一致；5 张外部 atlas 未变。

修复前的场景副本、GLB、manifest 和详细校验报告保存在 `D:\opencode-temp\opencode\room-alpha-diagnosis`。
