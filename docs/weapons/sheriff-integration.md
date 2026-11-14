# 正义 Sheriff 接入 · 公开参考临时参数

2026-11-14，按用户确认接入正义，沿用 Ghost／Vandal 的固定作者来源发布流程。**资产通过正式发布校验；玩法仍是明确标注的公开参考临时配置，不是恢复了缺失的原始 runtime，也不宣称复刻 VALORANT 手感。**

## 使用

- **5：Sheriff**，保留 1 Phantom / 2 Classic / 3 Ghost / 4 Vandal；初始仍为 Classic。
- 默认 **Smite**；**K** 按 Smite → Sakura → Convex 循环。
- 左键半自动，按住只打一发；R 换弹，T 检视；无 ADS。
- 三款 2048×2048 RGBA 贴图、30 个动作、枪口／抛壳挂点、换弹快速装填器及共享 32×32 双手均保留。
- HUD 在当前枪名及键位说明中标注临时参数。

## 制作来源与保留内容

来源为 `skin_work_folder/sheriff_skin_work/` 中 `Sheriff_Smite_Animated.blend`、`Sheriff_Sakura_Animated.blend`、`Sheriff_Convex_Animated.blend`，以及同目录 `sheriff_<skin>_weapon.png`。没有使用旧 GLB 替代当前制作源，也没有改写 `.blend`、PNG 或 Ogg。

只读批量核验：

- 实际导出场景为 `80_ThreeJS_Export`，四个网格为 `Arms_Left`、`Arms_Right`、`Weapon_Body`、`Weapon_Magazine`，动画对象为 `root`、`views`、`camera`、`positioning`。
- 两只手确实属于该场景，拓扑、SourceUV、材质与内嵌图片符合标准契约；不需要狂徒的多枪对象别名／旧手臂转换，不盲目重跑历史手臂迁移。
- 每只手为 24 顶点／12 三角形，左右手共用标准 PNG。游戏中继续与已加载 Classic 等武器共用同一个作用域纹理对象。
- 三款皮肤的几何／UV／权重、Rest 骨架及全部动作曲线签名一致；各外部 PNG 与实际材质内嵌 PNG 逐字节相同，保留原 Alpha。
- 枪身、转轮内弹药和快速装填器保持作者的权重及 STEP 缩放曲线；不简化网格或添加新的逐膛弹药模拟。
- Camera_FP 的作者机位转换成独立 anchor 偏移；70° 视模 FOV 为项目预览基准，不冒充恢复了缺失的原 runtime view 配置。

标准手臂 PNG SHA-256：`2c041879daf6509fe3da88a8e1b857e4b9a7c9b67279d012382f5f03529750e9`。后台 Blender 不连接前台进程，源文件导出前后哈希不变；源网格／骨架／曲线无修改。

## 临时玩法参数

此前 Wiki 页面访问受限，本次重新成功读取 [Valorant-API 社区数据](https://valorant-api.com/v1/weapons/e336c6b8-418d-9340-d77f-7a9e4cfe0702)。这是社区游戏数据，不是 Riot 官方 API，也不声称本次核验了 Sheriff Wiki 页面。选定字段、查询日期与快照摘要写入固定 runtime JSON。

| 参数 | 当前配置 | 来源／取舍 |
| --- | --- | --- |
| 弹匣 | 6 发 | API magazineSize |
| 射击 | 半自动，4 发/秒，0.25 秒间隔 | API fireMode / fireRate |
| 掏枪 | 1 秒 | API equipTimeSeconds，也与作者片段一致 |
| 换弹 | 战术／空仓均 2.25 秒 | API reloadTimeSeconds，也与作者片段一致 |
| 补弹提交 | 换弹期限末尾 | 项目暂定；动画与音频不裁定弹药 |
| 备用弹药 | 18 | 项目三个备用转轮容量策略 |
| ADS | 不支持 | API 无 ADS／alt-fire；作者 aim 片段保留但不启用玩法 ADS |
| 后坐力／散布 | 暂借 Classic 项目曲线 | 不是 Sheriff 原始曲线，也没有把 API 首发精度直接当成相同噪声分布 |
| 收枪锁定 | 0 秒 | 项目切枪策略 |
| 检视期限 | 3 秒 | 作者片段用作项目期限 |
| 伤害／穿透／移动速度 | 记录参考字段，未实现专属玩法 | 本次没有扩大到伤害、穿透或武器移动惩罚 |

## 发布与音频

- 正式包：`public/weapons/sheriff/v1/`。
- 游戏定义：`src/game/weapons/definitions/sheriff.js`，另导出 `sheriffGameplayProvenance`。
- 固定配方：`tools/weapons/authored-releases/sheriff-v1.json`。
- 固定作者证据与临时玩法：同目录 `sheriff-authoring.json`、`sheriff-temporary-runtime.json`。

```powershell
node tools/weapons/publish-authored.mjs tools/weapons/authored-releases/sheriff-v1.json F:/Blender5.3/blender.exe
```

复用现有发布器，没有修改导出器、加载器或全局射击规则。新配方固定三份制作源、三张 PNG、作者证据、临时定义和音频哈希；保持完整动作／权重校验、九组 Blender／Three.js 变形对照、glTF Validator 零 error／零 warning、不覆盖不同内容旧版本等门槛。

新包在项目外重新导出并完成正式校验与单枪预览后安装；没有把非发布候选删除标记后提升，也没有改动 Ghost／Vandal 旧配方或已发布资源。

本地声音沿用已有 `sheriff_shoot`、`sheriff_draw`、`sheriff_reload`、`sheriff_inspect` 四个 Ogg，战术与空仓共用 reload，不叠加 shoot_3p。当前五枪默认背包共预热 **20 个本地 cue**；已有浏览器工具按配置计算数量，无需硬改预热数。

## 本次验收

- 完整资产：30 动作、2700 轨道、22 条 STEP、4 个蒙皮网格；九组姿态最大包围盒误差约 `5.28e-7` 米，glTF **0 error／0 warning**。
- 单枪预览：待机／空仓换弹／检视、独立实例及释放通过，查看了实际截图。
- 真实游戏：5 号切枪、三款皮肤循环及装填器同步换图，网格／材质／骨架身份不变，共用 32×32 手臂；实际加载 `sheriff/v1`。
- 按住约 0.45 秒仍只打一发（6→5），战术换弹后 6/17；六次独立点击打空后，空仓换弹到 6/11；右键不进入 ADS。Node 测试另核对过早点击不会在冷却结束后自动补打一发、两种换弹都不提前补弹。
- 战术换弹作者局部时间约 1.604 秒时，装填器顶点变形有限、最长尺寸约 0.180 米，没有整体塌缩；保存真实画面。检视和原四枪切换／返回通过，最多两实例、仅一套可见。
- Sheriff 四个声音实际加载并产生对应 cue，枪声到达最终输出，采样峰值约 0.254；没有页面／轨道绑定错误。这不是主观响度或 true-peak 验收。
- **53 项相关 Node 测试、修改 JS 的 ESLint、生产构建通过**（已有大 chunk 提示保留）。没有跑全量 npm test、完整光照／音频回归或房间回归，也没有为本次无修改的导出工具重复全套工作流测试。
- 正式发布不消费预览模型缓存：来源批查 4.03 秒，导出与完整校验 **2.68 秒**（Blender 2.24 秒），单枪预览 **2.14 秒**，安装 49 毫秒，目标游戏检查 **22.08 秒**。发布成功后没有立即重复 verify-only 或重导出。

本次报告、公开数据摘录、截图与浏览器 profile 位于 `D:/opencode-temp/opencode/sheriff-integration-20261114-c7e219/`。Windows 浏览器检查的 TEMP／TMP 使用原生路径 `D:\opencode-temp\opencode`。
