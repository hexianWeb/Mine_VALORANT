# 武器专用贴图裁剪、UV 调整与 Three.js 发布工作流

保存 Classic 的实际处理方法：保留用户精简后的网格，移除图集里的开火区域，整理成 **336×336**，校验后导出并接入游戏。

**不能只换 PNG：图集、UV、兼容签名、皮肤包和运行时版本必须一起更新。**

## 1. 本次结果与入口

| 项目 | 内容 |
| --- | --- |
| 游戏资源 | `public/weapons/classic/v4/` |
| 发布配方 | `tools/weapons/optimized-releases/classic-v4.json` |
| 发布器 | `tools/weapons/publish-optimized.mjs` |
| 裁图与 UV 工具 | `tools/weapons/gun-atlas.mjs` |
| 制作快照 | `skin_work_folder/classic_skin_work/optimized-336-v4/Classic_GunOnly336_Optimized.blend` |
| 快照场景 | `01_CLASSIC` |
| 默认皮肤 | `ag`，另保留 `smite`、`sakura` |
| 材质／UV | `Weapon_Skin`／`SourceUV` |

制作快照、AG 与 Smite 的 336 PNG 位于上述 `optimized-336-v4/`。它与其他制作源一样受 `.gitignore` 忽略，应另行保管；游戏只依赖已发布的 public 资源，不访问本机 Blender 或制作目录。

## 2. 先固定范围、备份当前状态

1. 检查当前文件、场景、对象、材质和实际图片，不能只看文件名。
2. 记录顶点、三角形、UV、权重、骨架和动画，保存当前未保存编辑状态的副本。
3. 网格或材质被其他场景共享时，先做独立副本，再修改 UV 和图片绑定。
4. 不覆盖原工程或旧发布包；临时文件、备份、截图放在 `D:/opencode-temp/opencode/`。

本次只处理 Classic 的枪身、弹匣，不继续减面、不删除骨骼、不修改动作。手臂不跟随枪皮肤裁图，继续遵守[统一手臂规范](arm-uv-contract.md)。

## 3. 确认有效区域与效果面

本次原图为 2048×2048，枪械内容集中在 PNG 左上角 **332×332**。右下角属于开火效果；枪身仍有 **4 个三角形**引用该区域，并关联 `flash_illuminated` 骨骼。

必须按面检查 UV 和权重，确认效果面。不能把所有超出裁剪框的 UV 一律移动。

中间的 512×512 版本是保守的二次幂裁剪，仍有大块透明留白。Blender 与当前 Three.js WebGPU 不强制二次幂，所以最终紧裁为 336×336。

## 4. 无损裁图：332 内容 + 四周各 2 像素保护边

```text
目标尺寸 = 332 + 2 + 2 = 336
原枪械像素位于新图 (2, 2) 到 (334, 334)，右／下边界不包含。
```

- 只裁剪、移动像素，不缩放、不重采样、不烘入光照。
- 保留 RGBA、sRGB 与颜色信息。
- 外圈透明；内侧一像素使用相邻源像素保护采样，上／左侧维持旧 `EXTEND` 边界行为。
- 右下角只留一个透明像素供旧效果面使用，不留大片空白。

```powershell
node tools/weapons/gun-atlas.mjs --input "原图.png" --output "新图-336.png" --rect 0,0,332,332 --padding 2
```

工具支持非交错 8-bit RGB／RGBA PNG，检查 CRC，拒绝不支持的编码、越界及覆盖不同内容。**命令只生成 PNG，不自动修改 Blender UV。**

## 5. 同步换算 UV

旧图宽高为 `W/H`，PNG 左上角裁剪框起点为 `x/y`，保护边 `p=2`，旧 Blender UV 为 `U/V`：

```text
U_new = (U_old × W − x + p) / 336
V_new = 1 − ((1 − V_old) × H − y + p) / 336
```

PNG 原点在左上，Blender UV 的 V 原点在下方。本次 `x=y=0`；原图输入使用 `W=H=2048`，中间 512 版本则使用 `W=H=512`。

`gun-atlas.mjs` 导出的 `remapGunUV()` 实现了该公式，并处理 float32 最近邻边界。非二次幂归一化有极小浮点误差，本次最大约 **0.00003 个纹素**，不是图片缩放。

确认的 4 个旧开火面的所有角点移到透明像素中心：

```text
Blender UV = (335.5 / 336, 0.5 / 336)
```

保留面、顶点、权重和动作，材质继续正确使用 Alpha 裁剪。游戏独立枪口闪光不依赖旧图集的开火区域。

**只对旧布局执行一次变换，已经是 336 的文件不可重复套用。** glTF 导出负责约定的 V 转换，运行时 `flipY=false`，不要再翻一次。

## 6. 裁图后的校验

- 原始 332×332 区域 RGBA 像素完全不变，包括 Blender 实际解码的像素。
- 枪身 9,863、弹匣 1,106，共 **10,969 个表面采样无差异**。
- 位置、拓扑、权重、面数不变，其他场景、原图、原材质保留。
- 旧效果面的目标像素确实是 Alpha 0，不是“看起来黑色”。
- 材质预览检查枪械、弹匣与动作，UV 编辑器显示新图。

然后另存制作快照并打包图片。不同皮肤分开保存，不能因为 UV 一样就混合颜色。

## 7. 用新网格导出完整游戏模型

展示场景的 NLA 是拼接预览，不能当成游戏动作；其中的手臂也可能仍是历史图集。因此后台导出使用明确的双输入：

1. **新几何源**：336 快照中的 `Weapon_Body | 00_Showcase`、`Weapon_Magazine | 00_Showcase`。
2. **已验证作者骨架源**：`Classic_Smite_Animated.blend` 的 `80_ThreeJS_Export`，提供完整动作、标准手臂和挂点。

`optimized_geometry.py` 导出前验证 Rest 骨架、父级、绑定变换、顶点组顺序一致，并逐项核对 `classic / <动作名>` 与标准作者工程的 **31 个动作曲线完全一致**。新几何／UV／权重原样导入，仅选择显式的四个运行时网格和相关骨架。

不是用旧 GLB 代替新网格，也不猜玩法时刻。动作语义、声音 marker、挂点和相机参数来自已验证的 `classic/v3` 元数据；未发布枪型仍须提供其原始源数据。

精简枪身保留了部分 2～3 骨骼混合权重。新包以 `skinning.maxInfluences=4` 显式声明，检查非负、归一化和上限；旧包仍默认要求刚性权重，没有全局放宽约束。

左右手继续使用同一张 32×32 标准贴图，不改用户展示工程中的手臂。

## 8. 发布新版本

```powershell
node tools/weapons/publish-optimized.mjs tools/weapons/optimized-releases/classic-v4.json --blender "F:/Blender5.3/blender.exe"
node tools/weapons/publish-optimized.mjs tools/weapons/optimized-releases/classic-v4.json --verify-only
```

发布器校验配方、作者源、旧元数据、图片的 SHA-256，在独立后台 Blender 中导出并核对源文件未被写入。随后生成新兼容签名，发布 AG／Smite 的 336 图集，并将已验证的 Sakura 旧图集无损裁成对应布局，不直接套用旧 2048 PNG。

保存来源／皮肤裁图证据、九组动作采样及 glTF Validator 结果；全部通过才安装资源，最后写 manifest。已有版本只允许逐字节一致的重复发布；修改模型、图片或配方需创建新版本，不能覆盖 v1～v4 或手改哈希掩盖来源变化。

配方原始字节的哈希已绑定到 manifest，`.gitattributes` 禁止 Git 转换其换行。不要重新格式化已发布的配方；`--verify-only` 也会检查该哈希，无需打开制作源或启动 Blender。

## 9. Three.js 使用与验收

`src/game/weapons/definitions/classic.js`：

```js
assets: {
  modelId: 'classic',
  assetVersion: 'v4',
  defaultSkinId: 'ag',
  skinIds: ['ag', 'smite', 'sakura'],
}
```

继续通过 WeaponAssets／ResourceManager 加载，不另建 GLTFLoader，不改射速、弹药、后坐力、动作时钟或持枪位置。颜色图为 sRGB、最近邻、无 mipmap、`flipY=false`。

本工作流负责几何／图集发布，不把额外发光图作为皮肤制作要求。平直着色、全金属、不依赖自发光和静态局部反射的后续工作以[材质路线图](material-quality-roadmap.md)为准；当前加载器的[旧材质兼容状态](animation-and-assets.md#旧材质兼容状态)仍待迁移。

```powershell
npm test
npm run build
npm run dev
node tools/check-weapons-browser.mjs http://localhost:5173/weapon-preview.html
node tools/check-weapon-gameplay-browser.mjs http://localhost:5173/
node tools/check-weapon-lighting-browser.mjs http://localhost:5173/
```

确认实际请求 `classic/v4/model.glb`，检查 AG 默认、三皮肤循环、共享手臂、射击、检视、换弹、切枪、暂停、Editor 交接和销毁。不能只看模型是否加载。

## 10. 本版数量与限制

| 指标 | v3 | v4 |
| --- | ---: | ---: |
| 枪身三角形 | 1666 | 1413 |
| 弹匣三角形 | 158 | 158 |
| 完整模型三角形（含手臂） | 1848 | 1595 |
| GLB／字节 | 777104 | 694420 |
| 动作／轨道／STEP | 31／1116／1 | 31／1116／1 |

制作源枪身有 1030 个顶点，弹匣 316 个；glTF 按 UV、硬边法线、权重拆点后为 3335／322。**Blender 合并后的点数不等于 GPU 顶点数，不应为降低统计再次焊接不同骨骼或 UV 边界的点。**

336 会产生 glTF Validator 的 NPOT 信息项，不是错误或警告，当前 WebGPU 与最近邻／无 mipmap 采样支持该尺寸。门槛仍是零 error、零 warning，以及动作和像素检查通过。

## 11. 本次执行记录（2026-11-13）

- 执行结束时完整单元测试 **386／386**（含当时的旧材质兼容与共享贴图测试），本任务修改的 JavaScript 通过 ESLint，生产构建通过（仅已有的大 bundle 提示）。
- glTF Validator **0 error／0 warning**；九组动作采样最大误差约 `3.31e-7` 米。
- 从两份制作源重新发布，整个 v4 包与首次发布逐字节一致。
- 真实 Chrome／WebGPU 的资源预览、玩法和光照检查全部通过；网络请求确认 v4，贴图 336×336，换肤不替换骨架、动作或手臂。
- 本机报告与截图：`D:/opencode-temp/opencode/classic-v4/` 下的 `preview/`、`gameplay/`、`lighting/`。

这些是本次执行结果；后续发布新版本仍须重跑检查，不能将历史通过记录当作新资源或尚未实施的新版材质方案的验收。
