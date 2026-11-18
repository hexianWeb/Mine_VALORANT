# 獠犬 Bulldog 接入

靶场按 `B`，在步枪列选「獠犬」，它只替换主武器槽；之后按 `1` 切回。初始持有、手枪与爪刀槽不变。

## 美术与音效

- 当前 `public/weapons/bulldog/v4/` 来自 [`Bulldog_Showcase_v4.blend`](../../skin_work_folder/bulldog_skin_work/Bulldog_Showcase_v4.blend) 的 `10_BullDog`。发行的是 30 个独立 Action，而不是总览用的 NLA 拼接。
- 枪身与弹匣保留原 256×256 RGBA 图集、UV、刚性权重和两种换弹的 STEP 显隐。后台导出以狂徒方块手为模板，掌端和袖口分别绑定獠犬的原腕骨和袖骨，恢复相对位移和拉伸，不沿用 v1 的整臂单骨绑定。左右手保留 24 顶点／12 三角形、镜像 UV 和共有 32×32 图。换枪皮不会替换手臂，制作 `.blend` 不回写。
- 开火、掏枪、换弹、检视**临时复用狂徒的本地四个 Ogg**。没有 `bulldog` 音频副本；两种换弹共用同一文件，待专用音效做好再替换映射。

## 暂定玩法

公开 [VALORANT 社区数据](https://valorant-api.com/v1/weapons/ae3de142-4d85-2547-dd26-4e90bed35cf7)用作练习参数参考，不是原版运行时配置。开镜已接相机和开镜开火动画；当前沿用已有的持续开火逻辑，**未实现原版开镜三连发**。后坐力和散布暂借幻影项目曲线。

v4 在 v3 的基础上再向镜头平移 20% 的挂载深度（1.248 → 0.9984），横向、高度及 FOV 不变。新版直接取制作相机，导出时不再叠加距离偏移。切枪时只播放 `bulldog / draw`：抬枪与左手动作重叠，袖口略晚于手腕，拉柄回弹后接回持枪姿势。拉柄和手的曲线直接保存在该 Action 里，无需拼接或触发换弹。全段 45 帧／0.75 秒，可在总览时间线第 1–46 帧查看。

换弹 2.30 秒、检视 3.00 秒、开镜过渡 0.20 秒；单发动画约 0.23 秒，射速不变。战术与空仓两个逻辑分支都完整播放 `reload_empty`，原 `reload_tactical` 保存在资源里但不在游戏中触发。

右键开镜时，步枪通用的金色四角瞄具从 `sight_line` 挂点淡入；退出开镜后淡出。资源预览页选「开镜」并点「播放」也能查看。

## 使用固定来源复现

```powershell
node tools/weapons/publish-bulldog.mjs tools/weapons/authored-releases/bulldog-v4.json F:/Blender5.3/blender.exe --preview
node tools/weapons/publish-bulldog.mjs tools/weapons/authored-releases/bulldog-v4.json F:/Blender5.3/blender.exe --install
```

`--preview` 只写 D 盘候选并返回预览 URL；`--install` 重新以固定来源构建并完成发布校验。发布检查包含 30 个动作、九组 Blender／Three.js 姿态对照、袖口到掌端的长度变化、方块手契约及 glTF Validator 零 error／零 warning。修改来源需新配方和新版本，不能覆盖旧包或将候选直接复制为发布包。
