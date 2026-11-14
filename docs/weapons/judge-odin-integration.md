# 判官 Judge／奥丁 Odin 接入 · 公开参考临时参数

2026-11-14，按用户要求接入判官与奥丁，沿用固定作者来源与公开参考临时玩法的流程。**资产完成正式发布校验；玩法不是恢复了缺失的原始 runtime，也不宣称复刻 VALORANT 手感。** 保留原五枪，不继续此前暂缓的 AO 烘焙试验。

## 使用

- **6：Judge**，默认 Smite；**K** 按 Smite → Rush 循环。
- **7：Odin**，默认 Smite；**K** 按 Smite → Prime → BlastX 循环。
- 1 Phantom / 2 Classic / 3 Ghost / 4 Vandal / 5 Sheriff 保留，初始仍为 Classic；滚轮与 Q 继续切枪。
- 两枪左键按住全自动，R 换弹，T 检视；Odin 右键按住 ADS，Judge 不支持 ADS。HUD 标注临时参数。
- 五张原生 2048×2048 RGBA 皮肤、每枪 33 个动作、枪口／抛壳挂点、弹药与手臂动画保留。

## 制作来源与共享手臂

| 武器 | 当前制作源 | 实际动作场景 |
| --- | --- | --- |
| Judge | `skin_work_folder/judge_skin_work/Judge_Smite_Animated.blend`、`Judge_Rush_Animated.blend` 及同目录 `judge_smite_texture.png`、`judge_rush_texture.png` | `80_ThreeJS_Export` |
| Odin | `skin_work_folder/odin_skin_work/three_odin_skins/Odin_Smite.blend`、`Odin_Prime.blend`、`Odin_BlastX.blend` 及同目录三张 PNG | `E09_ODIN_Actions` |

只读批量检查全部五份源文件；同枪各皮肤的几何／UV／权重、Rest 骨架与动作曲线签名一致，外部 PNG 与实际武器材质内嵌 PNG 逐字节相同，保留 Alpha。没有使用旧 GLB 或 Gallery 替代当前制作源，没有改写 `.blend`、PNG、Ogg 或既有发布配方。

- Judge 实际场景的 `Arms_Left`、`Arms_Right` 已符合标准，直接保留；另导出 `Weapon_Body`、`Weapon_Magazine` 以及 `root`、`views`、`camera`、`positioning` 动画对象。
- Odin 实际骨架为 `root.006`，Action slot 显示名仍是 `root`，动作前缀为 `odin / `。配方显式处理 `Arms_Left.008`、`Arms_Right.008`、`Weapon_Body.008`、`Weapon_Magazine.007` 等别名，不导出其他枪型。
- Odin 的 `.008` 双手仍使用旧图；每个皮肤、每只手逐一比较 **248 个三角形内纹素样本**，颜色与 Alpha 一致后，只在后台内存中转换到标准 UV／32×32 图。适配前后指纹保证其他网格、权重、对象变换、骨架和全部动作不变。
- 两枪每只手均为 24 顶点／12 三角形，运行时与原五枪共用同一个作用域手臂纹理对象。标准 PNG SHA-256 为 `2c041879daf6509fe3da88a8e1b857e4b9a7c9b67279d012382f5f03529750e9`。
- 独立 anchor 来自实际作者相机，基础视模 FOV 为项目基准 70°；不是找回了原始 runtime view。

后台 Blender 不连接用户前台进程，不保存源文件；导出前后源 SHA-256 一致。实际 Blender 为 **5.2.3 LTS**，安装目录名称 `Blender5.3` 不代表版本。

## 临时玩法与未实现项

此前 Wiki 访问受限，本次成功读取 [Judge](https://valorant-api.com/v1/weapons/ec845bf4-4f79-ddda-a3da-0db3774b2794) 与 [Odin](https://valorant-api.com/v1/weapons/63e6c2b6-4a8e-869c-3d4c-e38355226584) 的 Valorant-API 社区游戏数据。它不是 Riot 官方 API；查询日期、选定字段和快照摘要保存在固定 runtime JSON 中。

| 参数 | Judge | Odin | 来源／取舍 |
| --- | --- | --- | --- |
| 弹匣／初始备用 | **5／15** | **100／300** | 容量来自 2026-11-14 API；备用为项目三个备用弹匣策略，Judge 不采用旧资料的 7 发 |
| 射击 | 全自动 3.5 发/秒，每发 12 弹丸 | 全自动固定 12 发/秒 | API fireRate／shotgunPelletCount；全自动是项目枪型映射，API fireMode 为 null |
| 掏枪 | 1 秒 | 1.25 秒 | API equipTimeSeconds；Judge 作者片段仍为 1.25 秒 |
| 战术／空仓换弹 | 均 2.2 秒 | 均 5 秒 | API reloadTimeSeconds；补弹提交暂定在期限末尾，Judge 作者片段仍为 2.5 秒 |
| 检视期限 | 4 秒 | 6.5417 秒 | 作者片段用作项目期限 |
| 收枪锁定 | 0 秒 | 0 秒 | 项目切枪策略 |
| 后坐力 | 暂借 Classic 项目曲线 | 暂借 Phantom 项目曲线 | 不是对应武器的原始曲线 |
| 散布 | stand/move/crouch/ads 为 0.045/0.08/0.04/0.045 | 暂借 Phantom 项目曲线 | 项目噪声尺度，不把 API 首发精度直接当作锥角或同一种分布 |
| ADS | 不支持，作者 aim 片段仍保留 | 支持，过渡 0.2083 秒；世界／视模 FOV 约 62.672° | Odin 按作者 70° 基准与参考 1.15 倍切线缩放计算，属于项目视角近似 |
| ADS 射速／连射加速 | 不适用 | **仍为固定 12 发/秒** | 参考 ADS 为 15.6，参考 feature 为 ROFIncrease；独立 ADS 射速和 spin-up 均未实现 |
| 伤害／穿透／专属移动速度 | 仅记录参考字段 | 仅记录参考字段 | 本次未扩大实现范围 |

片段原曲线保持不变，现有表现适配层按玩法期限调整动作播放，不由动画结束或声音时长裁定弹药。

### 判官的多弹丸

`createWeaponDefinition()` 新增显式可选 `fire.pellets`，只接受 1–64 的整数；没有声明时保留旧定义的原有字段形状。Judge 配置为 12。

`AimState.fire()` 在本发冲量前生成确定性方向，额外弹丸使用独立随机流，不改变旧单发射线及后坐力随机序列。`PlayerWeapons` 对每条弹丸射线分别进行最远 200 米的碰撞盒查询，写入同一个 `ShotFired.payload.pellets`；兼容字段 `impact` 取最近命中，没有命中时取第一条结果。一发仍只扣一颗弹药、应用一次后坐力、产生一个射击事实及一个本地枪声；并非把同一条命中结果复制 12 次。

当前弹丸采用项目三轴三角分布噪声，不是原作固定弹丸布局，也没有额外加入伤害、穿透或逐弹丸枪声。

## 稀疏控制与弹药显示

保留并显式声明两枪全部既有控制片段，不将整段控制动画叠加为全权重 Action：

| 武器／角色 | 属性 | 运行时策略 |
| --- | --- | --- |
| Judge ammoDisplay | `bullet4…bullet0.scale`，源 LINEAR 淡出 | 可见数为 `min(magazine, 5)`，采样各淡出的完全隐藏端点 |
| Judge boltCaught | `static_bolt_caught` 的 `bullets.scale` | 保留手动显式采样；不发明自动空仓枪机规则 |
| Odin ammoDisplay | `group_8…group_1.scale`，源 STEP | 近供弹端窗口 `min(magazine, 8)`，100 发不是显示 100 节弹链 |
| Odin barrelIndicators | `barrel` 的 `red_1.scale`、`red_2.scale` | 实际不是旋转；保留手动采样，不添加热量或枪管旋转驱动 |

档位只消费已到公共表现时间 P 的射击／补弹事实。ReloadStarted、换弹动画或资源迟到不能提前补满弹药显示。

本次 `authoredControlProfile()` 从**最终归一化 GLB 的实际 Float32 输入键**确定阈值，不在通用播放器里误差吸附。例如 Odin 的某个边界是 `0.4999999701976776`，不能从旧夹具抄成 `0.5`。发布门槛也增加控制声明、实际绑定、档位范围和采样有限性验证；预览缓存指纹包含相关控制库／profile 源码。接口与历史源曲线证据见[稀疏控制](runtime-controls.md)。

## 发布与本地音频

- 正式包：`public/weapons/judge/v1/`、`public/weapons/odin/v1/`。
- 游戏定义：`src/game/weapons/definitions/judge.js`、`odin.js`，各导出定义与 GameplayProvenance。
- 固定配方：`tools/weapons/authored-releases/judge-v1.json`、`odin-v1.json`。
- 同目录 `<weapon>-authoring.json`、`<weapon>-temporary-runtime.json` 固定制作源、贴图、控制证据、公开参考取舍、玩法和音频哈希。

```powershell
node tools/weapons/publish-authored.mjs tools/weapons/authored-releases/judge-v1.json F:/Blender5.3/blender.exe
node tools/weapons/publish-authored.mjs tools/weapons/authored-releases/odin-v1.json F:/Blender5.3/blender.exe
```

两包在项目外从当前制作源新导出，完成正式校验与各自单枪预览后，才用原安装函数安装；不是删除非发布候选标记后提升。保留全部动作／权重检查、九组 Blender／Three.js 姿态对照、glTF Validator 零 error／零 warning 以及不覆盖内容不同旧版本的门槛。修改内容必须使用新版本。

两枪各复用已有 shoot／draw／reload／inspect 四个本地 Ogg，战术与空仓共用 reload，不叠加 shoot_3p。**当前七枪默认背包预热 28 个 cue**；检查工具从实际配置计算数量。

## 本次验收与耗时

| 完整资产检查 | Judge | Odin |
| --- | --- | --- |
| 动作／轨道／STEP／蒙皮网格 | 33／1485／2／4 | 33／2475／15／4 |
| Blender／Three.js 姿态对照 | 9 组，最大误差 `4.89e-7` 米 | 9 组，最大误差 `1.52e-6` 米 |
| glTF Validator | 0 error／0 warning；11 条空节点 info | 0 error／0 warning；12 条空节点 info |
| 稀疏控制 | 2 个 profile／12 次采样 | 2 个 profile／15 次采样 |
| 导出与完整校验 | **1.94 秒**（Blender 1.66 秒） | **4.09 秒**（Blender 3.60 秒） |
| 单枪预览 | **2.21 秒** | **2.23 秒** |
| 安装 | **35 毫秒** | **36 毫秒** |

- 单枪预览覆盖待机／空仓换弹／检视、实例隔离及释放，实际查看截图。
- 真实游戏检查 **46.34 秒**：6／7 输入、五款皮肤及弹药网格同步换图，网格／材质／骨架身份不变，和原五枪共用同一 32×32 手臂图。
- Judge 按住打空 5 发，每发 12 条独立方向，显示 5→0；Odin 打空 100 发，首末发相差 8.25 秒，固定 12 发/秒，弹链窗口先饱和后 8→0。
- 两枪空仓／战术换弹通过，显示不提前补满；补弹后战术结果分别为 Judge **5/9**、Odin **100/199**。随后另验 Odin ADS 射击，视模 FOV 为 `62.67247387571614`；Judge 右键不进入 ADS。
- 两枪四种本地 cue 均出现，打空期间每发只播放一个枪声；最终输出峰值约 Judge **0.105**、Odin **0.226**。这不是主观响度或 true-peak 验收。
- 七枪依次切换、检视及返回通过，原五枪弹药／备用／皮肤不变；最多两实例、仅一套可见，无页面／轨道绑定错误。
- 累计 **225 项不同的相关 Node 子测试：224 通过，1 项既有材质测试失败**。`tests/weapon-assets.test.mjs:244` 的 `gun skin grade nodes are bound` 单独复现仍失败；该测试及 `weapon-assets.js`／`weapon-materials.js` 均未修改，不为通过它而改材质。最终 Judge/Odin 8 项专项及 15 项工作流测试另行通过。
- 修改 JS 的 ESLint 与生产构建通过，保留既有大 chunk 提示。未运行全量 `npm test`、房间回归、完整双枪光照或音频浏览器回归，不声称全套回归通过。
- 正式发布**未消费预览模型缓存**；成功后未立即重复 verify-only，也未重复导出来比较字节。

实际游戏复核入口：

```powershell
$env:TEMP = 'D:\opencode-temp\opencode'
$env:TMP = $env:TEMP
node tools/check-judge-odin-browser.mjs http://localhost:5173/
```

输出由 `JUDGE_ODIN_TEST_OUTPUT` 指定，默认 `D:/opencode-temp/opencode/judge-odin-gameplay-browser/`。本次来源／控制审计、公开数据摘录、报告、截图与 browser profile 位于 `D:/opencode-temp/opencode/judge-odin-integration-20261114-d6a42f/`；正式报告为 `judge-release-report.json`、`odin-release-report.json`，成功实机报告为 **`gameplay-browser-retry/report.json`**。

首次实机检查在武器加载前遇到房间 manifest `net::ERR_ABORTED`；直接 HTTP 返回 200，独立浏览器诊断正常 ready，之后目标检查通过。没有修改房间代码、添加运行时重试或重跑 Blender，早期失败报告保留。
