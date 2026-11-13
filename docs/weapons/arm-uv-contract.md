# 第一人称手臂 UV 与贴图规范

## 约定

- 唯一标准贴图是 [`public/weapons/arms/v1/arms.png`](../../public/weapons/arms/v1/arms.png)，32×32 RGBA、sRGB。它从 Classic 原贴图的左上角无损裁切得到，没有缩放；实际不透明内容不超过 20×24 像素。
- 左手和右手使用**同一张图**，但必须各自使用对应的镜像方向；不能把右手的 UV 直接复制给左手。面、顶点及坐标以 [`arm-contract.json`](../../tools/weapons/arm-contract.json) 为准。该文件的 V 原点在 Blender 左下角；glTF 的 V 方向与之相反。
- 索引从 0 开始。下表是 PNG 左上角为原点的像素矩形，右／下边界不包含在内；每个面的顶点朝向仍以契约文件为准。

| 四顶点序号 | 左手矩形 `(x0,y0)–(x1,y1)` | 右手矩形 |
| --- | --- | --- |
| 0–3 | (0,12)–(4,24) | (4,0)–(8,12) |
| 4–7 | (4,0)–(8,12) | (0,12)–(4,24) |
| 8–11 | (16,0)–(20,4) | (16,0)–(20,4) |
| 12–15 | (16,4)–(20,8) | (16,4)–(20,8) |
| 16–19 | (8,0)–(12,12) | (8,0)–(12,12) |
| 20–23 | (0,0)–(4,12) | (0,0)–(4,12) |

材质继续使用 `Character_Left` / `Character_Right`，网格使用 `Arms_Left` / `Arms_Right`，UV 层使用 `SourceUV`。武器皮肤只能替换 `weapon`/`scope`，不能覆盖手臂。GLB 内嵌一份标准 PNG 以支持独立查看；运行时在同一资源作用域中让兼容的两枪和左右手借用同一个纹理对象，使用 nearest、关闭 mipmap。不要以为只替换 PNG、不同时更新 UV 就能兼容旧模型。

## 已处理范围与保留内容

[`arm-source-files.json`](../../tools/weapons/arm-source-files.json) 列出九枪的 42 个单枪制作源，包含用户确认的单枪历史及 `edge_fixed` 版本；Gallery、多枪展示场景和 `.blend1` 没有修改。每个文件修改前对每只手的 248 个三角形内纹素采样点逐个比较，颜色与 alpha 均匹配；候选文件重新打开后对其他网格、UV、权重、骨架、动作曲线和对象变换计算指纹。修改前后 SHA-256 与采样数量见 [`arm-migration-evidence.json`](../../tools/weapons/arm-migration-evidence.json)。原始 `.blend` 备份在 `D:/opencode-temp/opencode/arm-uv-backup/`，按原项目目录结构保存；该位置不是版本库内的永久备份，请自行保管。

手臂迁移包 `classic/v3` 和 `phantom/v2` 是从已校验的旧 GLB **只改手臂 UV 和内嵌 PNG** 派生的，不依赖缺失的原始源包元数据；骨架、动画字节、非手臂 UV 与枪皮肤像素保持不变。游戏当前 Classic 已升级为 `classic/v4`：使用精简后的枪械和 336 图集，仍满足本手臂契约，流程见[枪械专用图集工作流](gun-only-uv-workflow.md)。Phantom 仍为 v2。旧包不变，但旧的 Classic v2 Sakura 审计绑定的是修改前的制作文件，不能用当前 `.blend` 重跑旧配方；要复现历史审计需使用备份，或者针对新版本重新审计。

其他七枪目前仅统一了制作源，尚未发布到游戏；继续发布还需要完整的 `valorant-first-person-pack` 源包及各枪运行时元数据。

## 验证与后续导出

```powershell
& 'F:/Blender5.3/blender.exe' --background --factory-startup --disable-autoexec --python-exit-code 1 `
  --python tools/weapons/audit_arm_sources.py -- --files tools/weapons/arm-source-files.json
node --test tests/weapon-arms.test.mjs
node tools/check-weapons-browser.mjs http://localhost:5173/weapon-preview.html
```

发布器 `export_blender.py` 在导出前拒绝不符合契约的制作源；包验证器检查每个手臂的拓扑、UV、PNG 尺寸和 SHA-256，以及左右手是否引用同一张内嵌图片。对需要不同外观的角色手臂应先定义兼容的独立角色皮肤及版本策略，不要把角色皮肤放进武器皮肤或改写现有 v1 标准。

当前两把枪的新版本可用 `node tools/weapons/publish-arms.mjs --blender 'F:/Blender5.3/blender.exe'` 复现；该命令校验迁移后的制作源哈希，若文件后来改动会明确拒绝，不能把过期证据当作新审计。常规完整 Blender 导出仍需要原始源包，并必须使用新 `--asset-version`，不可覆盖已发布版本。
