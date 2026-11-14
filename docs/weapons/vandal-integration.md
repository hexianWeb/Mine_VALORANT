# 狂徒 Vandal 接入 · 公开参考临时参数

2026-11-14，沿用用户授权的 Ghost 接入方式，发布当前狂徒制作源及六款现有皮肤。**模型资产已完成正式发布校验；玩法仍为公开参考临时配置，不是找回了缺失的原始 runtime，也不是 VALORANT 手感复刻。** 没有制作新皮肤、改枪身几何或继续 AO 烘焙试验。

## 使用

- **4：狂徒**，保留 1 Phantom / 2 Classic / 3 Ghost；初始仍为 Classic。
- 默认 Sakura；**K** 按 Sakura → Wood & Metal → Smite → Royal Gold → EGO → Original 循环。
- 左键按住全自动，右键按住 ADS，R 换弹，T 检视；滚轮和 Q 继续切枪。
- HUD 标注「临时参数」。保留 30 个完整动作、枪身／弹匣／备用弹匣、枪口／抛壳挂点。
- Original 保留原生 **256×256**，其余五款为 **2048×2048**；不放大、不裁图、不改 Alpha。

## 来源与后台适配

来源为 `skin_work_folder/vandal_skin_work/three_vandals/edge_fixed/` 下六个 `Vandal_*_Edge_Fixed.blend` 与同目录 PNG，不使用便携包或旧 GLB 替代当前制作源。源文件本次全部保持原字节；不连接或改写前台 Blender。

这批文件含九枪及 Gallery，狂徒的实际动作场景是 **`E04_VANDAL_Actions`**：

- 只导出狂徒的五个蒙皮网格、`FP_root`、`camera.003`、`views.003`、`positioning.003`，排除 Icosphere、预览相机和其他枪型。
- 用固定配方中的显式别名，把 `.003` 网格、`vandal / <action>` 动作和皮肤材质转成运行时名称；只在后台进程内进行，不保存制作文件。
- 实际狂徒手臂是 `Arms_Left.003` / `Arms_Right.003`，仍使用旧 64×64 `Character_Skin`，不能用文件里另一把枪的同名规范对象代替核验。
- 每个皮肤、每只手在转换前逐一比较 **248 个三角形内纹素采样点**，颜色和 Alpha 均与标准图相同；随后仅转换手臂 UV／图像，左右手共用标准 32×32 PNG。
- 适配前后指纹验证枪身几何／UV、顶点权重、对象变换、Rest 骨架及所有动作曲线不变；发布再检查完整绑定／权重和九组源姿态。
- 六款源的几何／权重／骨架／动作签名一致。Original 外部 PNG 与内嵌 PNG 编码字节不同，但实际 RGBA 像素逐个相同；使用固定哈希的现有外部 PNG，不改写它们。
- `put_away` 的作者属性为 `hold_on_last_frame`，按一次性动作处理，不误判为循环。

标准手臂 PNG SHA-256：`2c041879daf6509fe3da88a8e1b857e4b9a7c9b67279d012382f5f03529750e9`。游戏中与 Classic、Phantom、Ghost 继续共用同一个作用域纹理对象。

## 临时参数与未实现项

本会话 Wiki 访问受限，使用已成功读取的 [Valorant-API 社区数据](https://valorant-api.com/v1/weapons/9c82e19d-4575-0200-1a81-3eacf00cf872)，不是 Riot 官方 API，也不声称本次独立核验了 Wiki 页面。查询日期与选定字段快照保存在固定 runtime JSON 中。

| 参数 | 当前配置 | 来源／取舍 |
| --- | --- | --- |
| 弹匣／射速 | 25 发／9.75 发每秒 | API 参考值；全自动为项目枪型映射，API `fireMode` 本身为 null |
| 掏枪 | 1 秒 | API 参考值；作者动画 1.0833 秒，原曲线不改，由现有适配层匹配期限 |
| 换弹 | 战术／空仓均 2.5 秒 | API 参考值；补弹提交暂定在期限末尾，作者片段保留 2.3333 秒 |
| 备用弹药 | 75 | 项目三个备用弹匣策略 |
| 收枪锁定 | 0 秒 | 项目切枪策略 |
| 检视期限 | 4.5833 秒 | 作者片段用作项目期限 |
| 后坐力／散布 | 暂借 Phantom 项目曲线 | 不是狂徒的原始曲线；未把 API 首发精度直接当作同一种噪声分布 |
| ADS | 支持作者瞄准／开火动作；0.2083 秒过渡 | 过渡期限借作者 aim_start；FOV 58.512°，按作者 70° 基准和 1.25 倍切线缩放计算，属于项目视角近似 |
| ADS 射速 | **暂时仍为 9.75 发/秒** | 参考值为 8.775；当前定义仅有一个 fire.interval，没有扩展全局射速逻辑 |
| 伤害／穿透／移动速度 | 仅记录参考字段 | 本次没有额外接入伤害、穿透或武器专属移动惩罚 |

因此不能把“可 ADS”解释成所有 ADS 参考参数均已还原。原三枪的玩法定义及已发布资源不变。

## 发布与复现

- 正式包：`public/weapons/vandal/v1/`。
- 固定配方：`tools/weapons/authored-releases/vandal-v1.json`。
- 固定作者证据／临时玩法：同目录 `vandal-authoring.json`、`vandal-temporary-runtime.json`。
- 游戏定义：`src/game/weapons/definitions/vandal.js`，导出定义及 `vandalGameplayProvenance`。
- 后台别名与手臂适配：`tools/weapons/authored_adapter.py`；其源码参与预览缓存的工具链指纹。

```powershell
node tools/weapons/publish-authored.mjs tools/weapons/authored-releases/vandal-v1.json F:/Blender5.3/blender.exe
```

发布器固定全部源文件、贴图、作者证据、玩法和本地音频哈希，从制作源新导出，保留源文件前后 SHA-256、完整动作／权重、九组姿态和 glTF Validator 零 error／零 warning 门槛；拒绝覆盖内容不同的旧版本。新包先在项目外完整校验并进行单枪预览，然后安装。没有从非发布预览删除标记来“升级”资产，也没有修改 Ghost 配方原始字节。

本地声音使用已有 Vandal shoot／draw／reload／inspect 四个 Ogg，战术与空仓共用 reload，不叠加 shoot_3p。狂徒接入当时四枪默认背包预热 **16 个**本地 cue，加入正义后为 20 个，当前七枪为 28 个，见[判官／奥丁接入](judge-odin-integration.md)；浏览器检查按实际配置计算数量。下述仍为狂徒当次验收，不冒充七枪回归。

## 本次实际验收

- 正式资产：30 动作、1710 轨道、4 条 STEP、5 个蒙皮网格；九组姿态最大包围盒误差约 `5.34e-7` 米，glTF **0 error／0 warning**（3 条空节点信息）。
- 单枪预览：待机／空仓换弹／检视、实例独立性及释放通过；实际查看截图。
- 真实游戏：4 号切枪、六款皮肤及枪身／弹匣／备用弹匣同步换图，保留网格、材质、骨架身份和共享 32×32 双手；Original 实际加载 256×256。
- 按住约 0.45 秒打出 5 发；战术换弹至 25/70。ADS 达到 1、视模 FOV 58.512°，使用 fireAds；打空后空仓换弹至 25/45。检视及 Classic → Phantom → Ghost → Vandal 返回正常，仅一套可见视模。
- 四个 Vandal 本地音频实际解码并出现对应 cue；枪声经过最终输出，采样峰值约 0.310，无页面／绑定错误。这不是主观响度或 true-peak 验收。
- **82 项不同的相关 Node 测试**通过：输入／玩法／皮肤／音频、来源与发布、手臂及导出工作流；工具链更新后另复跑 15 项工作流测试。修改的 JS 通过 ESLint，生产构建通过（已有大 chunk 提示保留）。
- 未运行全量 npm test、完整双枪光照／音频回归或房间回归；未立即重跑 Vandal 的 verify-only，也未重复导出来证明字节一致。
- 本次正式发布不使用预览模型缓存：导出与完整校验 **2.95 秒**（Blender 2.50 秒），成功单枪预览 **1.77 秒**，安装 57 毫秒，目标游戏检查 **23.73 秒**。

本次报告、检查脚本、截图与浏览器 profile 在 `D:/opencode-temp/opencode/vandal-integration-20261114-b3d90a/`。预览最初在图片 fetch 阶段出现 Chromium `ERR_ABORTED`，HTTP 资源和 PNG 本身正常；将 Windows `TEMP`／`TMP` 从正斜杠值改为 `D:\opencode-temp\opencode` 后通过。没有放宽校验、改加载器重试或重跑 Blender 导出；早期失败报告仍保留。
