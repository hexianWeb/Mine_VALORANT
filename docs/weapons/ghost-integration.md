# Ghost 接入 · 公开参考临时参数

2026-11-14，用户授权在缺少原始 Ghost manifest/runtime 的情况下，参考公开数据建立临时试玩配置。**资产已经正式校验并发布；玩法仍是明确标注的临时配置，不是原模组或 VALORANT 手感复刻。**

## 使用

- 1：Phantom；2：Classic；**3：Ghost**。原两枪及初始 Classic 不变，滚轮和 Q 也可切换。
- Ghost 默认 Freehand；K 按 Freehand → Recon → Ego → Spitfire 循环。
- 左键半自动射击，R 换弹，T 检视；没有 ADS。
- HUD 和资源预览选项标注「临时参数」。
- 模型、四款 2048×2048 RGBA 贴图、30 个动作、枪口与抛壳挂点均来自当前制作源。左右手共用标准 32×32 图，未改枪身、权重、骨架或动作。

## 参数来源与暂定项

请求参考的 [Valorant Wiki](https://valorant.fandom.com/wiki/Ghost) 和 Liquipedia 页面本次返回 403。采用可读取的 [Valorant-API 社区游戏数据](https://valorant-api.com/v1/weapons/1baa85b4-4c70-1284-64bb-6481dfc3bb4e)，不是 Riot 官方 API。记录查询日期及选定数据字段，不把访问失败说成 Wiki 已核验。

| 参数 | 当前配置 | 来源 |
| --- | --- | --- |
| 弹匣 | 13 | 2026-11-14 API 返回值；不是旧资料中的 15 |
| 射击 | 半自动，6.75 发/秒（405 RPM） | API `fireMode`、`fireRate` |
| 掏枪 | 0.75 秒 | API `equipTimeSeconds` |
| 换弹总时长 | 1.5 秒 | API `reloadTimeSeconds` |
| ADS | 不支持 | API 无 ADS / alt-fire |
| 初始备用弹药 | 39 | 项目三个备用弹匣策略 |
| 补弹提交点 | 战术/空仓均为 1.5 秒末尾 | 项目暂定，非公开精确提交点 |
| 收枪锁定 | 0 秒 | 沿用项目切枪策略，非动画长度 |
| 后坐力、散布 | 暂借 Classic 的项目曲线 | 明确占位，不是 Ghost 曲线；没有把 API 首发精度机械当作同一分布 |
| 检视期限 | 3 秒 | 作者片段时长用作项目期限 |
| 视模位置/FOV | 作者 Camera_FP / 70° | 作者预览机位，不冒充恢复了缺失的运行时 view 数据 |

伤害、穿透、移动速度等参考字段仅作为来源记录；本次没有额外实现伤害或专用移动惩罚。

## 发布与可追溯性

- 正式资源：`public/weapons/ghost/v1/`。
- 游戏定义：`src/game/weapons/definitions/ghost.js`，另导出 `ghostGameplayProvenance`。
- 固定配方：`tools/weapons/authored-releases/ghost-v1.json`。
- 固定来源：同目录 `ghost-authoring.json`、`ghost-temporary-runtime.json`；后者包含公开数据快照、项目取舍、实际玩法定义及四个本地音频的哈希。
- 发布入口：`node tools/weapons/publish-authored.mjs tools/weapons/authored-releases/ghost-v1.json F:/Blender5.3/blender.exe`。

发布器按新的显式来源契约打开后台 Blender，固定四份制作源和贴图哈希，保留源文件前后校验、全部动作/权重/绑定、九组姿态对照及 glTF Validator 零 error/零 warning，拒绝覆盖内容不同的旧版本。它不从美术候选复制 GLB，也不删除旧 `preview` 标记来升级资产；原美术交接包仍保留原状态。

新资源先在项目外完成完整发布校验和单枪候选预览，再由原安装函数安装，最后更新入口 manifest。正式包仍明确登记 `originalRuntimeManifestAvailable: false` 和 `gameplayParameters: temporary-public-reference`。临时玩法不意味着省略资产校验，也不意味着已恢复原始源包。

## 本地音频

沿用现有 WeaponAudio 和 AudioSystem，新增 Ghost 的 shoot、draw、reload、inspect 四个 cue；战术/空仓换弹共用 reload。源 Ogg 原样保留，`shoot_3p` 不在本地叠加播放。Ghost 接入当时三个持有枪型共预热 12 个本地声音，不加载未持有枪型；当前七枪为 28 个，见[判官／奥丁接入](judge-odin-integration.md)。下述仍为 Ghost 当次验收，不冒充七枪回归。

## 本次验收

- 完整发布：30 个动作、1080 条轨道、4 条 STEP，九组姿态最大包围盒误差约 `3.86e-7` 米，glTF Validator **0 error / 0 warning**。
- 单枪候选：待机、空仓换弹、检视及实例隔离通过，约 1.82 秒。
- 真实游戏：3 号键准备/掏枪，四皮肤循环，网格/材质/骨架身份保持，且与 Classic 共用 32×32 手臂纹理；实际加载 `ghost/v1`。
- 真实游戏：按住仍只打一发，弹量 13→12；换弹后 13/38；右键不进入 ADS，检视可被切枪打断，Classic → Phantom → Ghost 返回后只有一套可见视模。
- Ghost 四个本地 Ogg 实际解码；检查到对应 cue，枪声到达最终输出图，样本峰值约 0.0923。它不是主观音量或 true-peak 验收。
- 53 项相关 Node 测试通过，修改的 JS 通过 ESLint，生产构建通过（保留已有大 chunk 提示）。没有运行全量测试、全套双枪/音频回归或房间回归。
- 本次正式发布未使用预览校验缓存；导出/完整校验约 1.89 秒，单枪候选约 1.82 秒，目标游戏检查约 14.07 秒。

本次报告、公开数据摘录、计时、截图和浏览器 profile 位于 `D:/opencode-temp/opencode/ghost-integration-20261114-71a5d0/`。正式发布成功后未重复 `--verify-only` 或重导出证明字节一致。
