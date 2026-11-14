# Ghost 美术导出与统一手臂 · 2026-11-14

> 后续已按用户授权使用公开参考临时玩法接入 `ghost/v1`，见 [Ghost 接入](ghost-integration.md)。下述原美术交接包仍保留非发布标记，没有被直接提升为正式包。

状态：**美术交接包已导出，未正式发布或接入主游戏**。没有修改源 `.blend`、枪械几何、权重、骨架、动画、玩法入口，亦未修改用户正在调整的 `weapon-materials.js`。

## 交付目录

`deliverables/Ghost_Art_Export_20261114_4c8e72/`

该目录受现有 `.gitignore` 忽略，应另行保管。详细使用说明在其 `README.md`，逐文件 SHA-256 在 `文件校验_SHA256.txt`。

- `ghost/art-v1/model.glb`：从 `skin_work_folder/ghost_skin_work/Ghost_Freehand_Animated.blend` 的 `80_ThreeJS_Export` 重新导出，4 个蒙皮网格、30 个动作、1080 条轨道，包含 4 条 STEP。
- `textures/` 和 `skins/`：Freehand、Recon、Ego、Spitfire 四款 2048×2048 RGBA 贴图及皮肤描述，原始像素和 Alpha 不变。默认内嵌 Freehand。
- `textures/arms.png`：统一 32×32 手臂图。
- `audio/`：5 个原样 Ogg，含 draw、inspect、reload、shoot、shoot_3p；本次未做播放接线或音频波形检查。
- `authoring/`、`skin-audits/`、`source-audit.json`：来源、图像和兼容性证据。
- 包根 `previews/`：四款皮肤及待机、空仓换弹的本次 WebGPU 截图。

## 手臂处理

旧便携包 `ghost-first-person.glb` 仍包含左右手各一张 128×128 贴图；当前四份 Ghost 制作源已完成此前的统一迁移。本次没有复用旧 GLB，也没有重复迁移当前源文件。

导出前检查了标准手臂契约，实际 GLB 与浏览器中左右手均引用同一张 32×32 图，哈希为 `2c041879daf6509fe3da88a8e1b857e4b9a7c9b67279d012382f5f03529750e9`。每只手保持 24 顶点、12 三角形，各自使用正确的镜像 UV；换枪皮肤不覆盖手臂。

## 本次检查与边界

官方 glTF Validator 为 **0 error / 0 warning**。快速资源检查通过，首次模型缓存未命中，采样待机、空仓换弹、检视及三组作者姿态，最大变形包围盒误差约 `3.18e-7` 米；并非全动作发布验收。Chrome/WebGPU 实际换四款皮肤，骨架、材质和共享手臂身份保持不变，错误为 0。

仍缺少原始 `valorant-first-person-pack` 的 Ghost manifest/runtime 及引用数据。本包片段时长、循环来自 Blender Action，机位来自作者 `Camera_FP`，不推算射速、弹药、补弹时刻、后坐力、ADS 能力或声音 marker。manifest 保留 `provenance.preview: true`，不可直接复制进 `public` 或删标记冒充正式发布。

未运行游戏玩法、音频播放、房间回归、全量测试或生产构建。详细报告、脚本、缓存和浏览器 profile 位于 `D:/opencode-temp/opencode/ghost-export-20261114-4c8e72/`。本次制作源读取/提图约 1.27 秒、Blender 导出约 0.77 秒、快速检查约 0.70 秒、单枪浏览器检查约 2.25 秒。
