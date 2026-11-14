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

材质继续使用 `Character_Left` / `Character_Right`，网格使用 `Arms_Left` / `Arms_Right`，UV 层使用 `SourceUV`。武器皮肤只能替换 `weapon`/`scope`，不能覆盖手臂。GLB 内嵌一份标准 PNG 以支持独立查看；运行时在同一资源作用域中让当前七把兼容武器和左右手借用同一个纹理对象，使用 nearest、关闭 mipmap。不要以为只替换 PNG、不同时更新 UV 就能兼容旧模型。

## 已处理范围与保留内容

[`arm-source-files.json`](../../tools/weapons/arm-source-files.json) 列出九枪的 42 个单枪制作源，包含用户确认的单枪历史及 `edge_fixed` 版本；Gallery、多枪展示场景和 `.blend1` 没有修改。每个文件修改前对每只手的 248 个三角形内纹素采样点逐个比较，颜色与 alpha 均匹配；候选文件重新打开后对其他网格、UV、权重、骨架、动作曲线和对象变换计算指纹。修改前后 SHA-256 与采样数量见 [`arm-migration-evidence.json`](../../tools/weapons/arm-migration-evidence.json)。原始 `.blend` 备份在 `D:/opencode-temp/opencode/arm-uv-backup/`，按原项目目录结构保存；该位置不是版本库内的永久备份，请自行保管。

手臂迁移包 `classic/v3` 和 `phantom/v2` 是从已校验的旧 GLB **只改手臂 UV 和内嵌 PNG** 派生的，不依赖缺失的原始源包元数据；骨架、动画字节、非手臂 UV 与枪皮肤像素保持不变。游戏当前 Classic 已升级为 `classic/v4`：使用精简后的枪械和 336 图集，仍满足本手臂契约，流程见[枪械专用图集工作流](gun-only-uv-workflow.md)。Phantom 当前为 v3，原样复用 v2 模型和手臂，仅更新四款枪身皮肤。旧包不变，但旧的 Classic v2 Sakura 审计绑定的是修改前的制作文件，不能用当前 `.blend` 重跑旧配方；要复现历史审计需使用备份，或者针对新版本重新审计。

Ghost 已从当前统一制作源重新导出到 `ghost/v1`，与 Classic/Phantom 共用同一手臂契约，并按用户授权使用公开参考临时玩法接入，见 [Ghost 接入](ghost-integration.md)。狂徒也已发布 `vandal/v1`，见[狂徒接入](vandal-integration.md)。正义 `sheriff/v1` 和判官 `judge/v1` 的实际导出场景双手已经符合标准，保留不变；奥丁 `odin/v1` 则在后台转换实际 `.008` 双手，见[正义接入](sheriff-integration.md)与[判官／奥丁接入](judge-odin-integration.md)。Operator／Outlaw 尚未发布到游戏，不能仅根据旧迁移表推断其实际导出对象已兼容。

**多枪文件的后续实测边界：** 旧迁移脚本核验的是文件内规范名称 `Arms_Left` / `Arms_Right`，不能替代每个动作场景的实际对象检查。狂徒 `E04_VANDAL_Actions` 使用 `.003` 双手及旧 64×64 图。狂徒接入时仅在后台导出进程内隔离它们的数据／材质，逐手 248 个纹素样本确认外观和 Alpha 一致，再无损转换到标准 UV／32×32 图；指纹保证其他数据不变，没有改写制作源。后续枪型应同样从目标场景识别实际手臂，不盲目重跑旧迁移。

奥丁后续实测为 `three_odin_skins/` 三个当前源的 `E09_ODIN_Actions`，使用 `Arms_Left.008`／`Arms_Right.008`，不是文件内规范名称对象。三皮肤逐手各 248 个样本通过，后台适配保持网格／权重／骨架／全部动作指纹，不保存源文件；实际游戏和另外六枪共享标准纹理对象。

## 验证与后续导出

```powershell
& 'F:/Blender5.3/blender.exe' --background --factory-startup --disable-autoexec --python-exit-code 1 `
  --python tools/weapons/audit_arm_sources.py -- --files tools/weapons/arm-source-files.json
node --test tests/weapon-arms.test.mjs
node tools/check-weapons-browser.mjs http://localhost:5173/weapon-preview.html
```

发布器 `export_blender.py` 在导出前拒绝不符合契约的制作源；包验证器检查每个手臂的拓扑、UV、PNG 尺寸和 SHA-256，以及左右手是否引用同一张内嵌图片。对需要不同外观的角色手臂应先定义兼容的独立角色皮肤及版本策略，不要把角色皮肤放进武器皮肤或改写现有 v1 标准。

历史 `classic/v3`／`phantom/v2` 派生版本可用 `node tools/weapons/publish-arms.mjs --blender 'F:/Blender5.3/blender.exe'` 复现；该命令校验迁移后的制作源哈希，若文件后来改动会明确拒绝，不能把过期证据当作新审计。原始源包导出仍需要完整源包；后续五枪的独立作者来源配方见各接入文档。更改发布内容必须使用新版本，不可覆盖已发布版本。
