# 阶段二：七枪商店闭环——实施记录

日期：2026-11-17
依据：[靶场挑战设计](../specs/2026-11-16-range-challenges-design.md)，规则版本不变：`range-challenges-v2-2026-11-17`。

用户要求 commit 后进入下一轮，已先将阶段一及相关设计／参考图提交为 **`d300c8a`**（`feat(range): 完成阶段一 UI 基础与输入交接`），随后实施阶段二。**阶段二首次交付时未提交，后续按用户要求提交，以 Git 记录为准；未推送。阶段三由后续独立请求授权。**

## 本轮完成

- B 打开大面积商店，保留 R3 的绿色窄分类头、深灰卡片、浅色枪械图标、金色候选、右侧详情和右上关闭。
- 分类为随身武器 Classic／Ghost／Sheriff、步枪 Phantom／Vandal、霰弹枪 Judge、机关枪 Odin；只列当前持有槽位，不放假武器、余额、护甲购买或技能栏。
- 悬停／焦点只改候选，点击或键盘 Enter 免费选择已有槽位；选枪后商店保持打开，Esc／× 仅关闭窗口，继续复用阶段一的输入隔离、暂停及实际 Pointer Lock 交接。
- 选择经历 `排队 → 固定步重验 → 资源准备 → 装备提交 → P 展示确认`，区分准备、切换、等待展示、已装备、失败与替代。当前装备标记来自已展示武器，不拿最新背包提前更新。
- 失败保留原枪／弹药并支持同卡重试；新请求取代旧请求，关窗后已接受请求继续，重生／Editor／卸载使旧 scope 失效。更新只在商店打开时订阅 frame，静止字段不重复写 DOM。
- 数值来自实际 runtime definition，包含弹匣、开火方式、射速、开镜及换弹；五把临时参数武器明确提示参考值／复用曲线，不展示未接入的伤害或假官方数据。

## 接口与所有权

| 位置 | 边界 |
| --- | --- |
| `src/game/weapons/armory-catalog.js` | 根据实际持有槽位及运行定义构建静态不可变目录；无 UI 图像、DOM 或第三方在线数值 |
| `src/game/weapons/practice-armory.js` | scope／request 校验、固定步前选择、固定结果与 P 确认；不直接写库存或持有模型 Promise |
| `PlayerWeapons.readArmory()`／`requestArmorySelection()` | 向 UI 提供窄读模型和请求入口，复用现有 `selectSlot`／准备票据／装备事务 |
| `PlayerWeapons.setArmoryAccess(check)` | 游戏侧访问条件注入：返回拒绝原因或 null，在打开、请求和有效固定步检查；并非 UI 自己维护挑战状态 |
| `PlayerWeapons.canStartChallenge()` | 未来开局门槛，准备／切换／排队未完成时拒绝；只依赖权威状态，不能由 HUD／P 决定 |
| `src/app/weapon-shop.js` | 候选、卡片、详情与模态生命周期，关闭后停止连续读取；不暂停引擎、不拥有背包 |

真实 ChallengeSession 尚未接入。运行中拒绝商店及“先排队、再改变允许状态”的边界通过**注入条件**验证，不声称已有可玩挑战。权威完成而只剩 P 确认的选择不会被后续访问限制倒查成失败。

## 图标来源

现有仓库没有独立武器 UI 图标，因此本轮新增本地 UI 图像，而非改写已发布武器或房间包：

- 永久文件位于 `src/app/assets/armory/`；7 张 PNG 总计约 189 kB，Vite 本地打包，运行时不依赖第三方接口。
- 来源：第三方公开 [Valorant-API](https://valorant-api.com/v1/weapons?language=en-US) 的 displayIcon，2026-11-17 获取。来源 URL／SHA-256 逐项记录于 [provenance.json](../../../src/app/assets/armory/provenance.json)；不声称官方对本项目背书或数据实时同步。
- 临时下载位于 `D:/opencode-temp/opencode/ui-phase-two/icon-downloads/`。未更改用户参考图或任何发布配方。

## 本次实际验证

| 检查 | 最终结果 | 耗时 |
| --- | --- | --- |
| UI／输入／灵敏度、商店协议、PlayerWeapons、装备、视模、相机、Runtime／架构等 14 个测试文件 | **182／182 通过**，无跳过 | 1.132 秒 |
| 普通模式 Chrome／WebGPU，包含七枪实际 UI 选择 | **20 组通过**，无捕获到的运行时错误 | 34.570 秒 |
| Editor 精简轮，保留失败重试／暂停／旧 scope 失效，不重复七枪全量选择 | **19 组通过**，无捕获到的运行时错误 | 27.408 秒 |
| 本轮修改的 JS、测试、浏览器脚本及图标来源 JSON ESLint | 通过 | 未单独计时 |
| Vite 源码生产构建，不复制 public 资产 | 通过；主 chunk 约 1,690.69 kB，仍有大于 500 kB 的提示，未扩展拆包 | 0.543 秒 |

单元／集成覆盖重复与旧请求、最新选择胜出、迟到资源、失败保留／重试、暂停排队、重生／Editor 失效、固定提交与 P 的分离、开局门槛不依赖 P、权威完成后不倒查失败，以及七个图标的来源哈希。

浏览器复用阶段一真实输入验收，并通过 CDP **实际中断 Ghost manifest 请求**验证失败与重试；每轮报告中的该条 `net::ERR_FAILED` 是故障夹具，不是未处理异常，也没有清空错误记录掩盖其他错误。普通轮还验证七枪全部经 UI 装备、快速 Vandal→Judge 改选、关窗后 Odin 完成、所有槽位弹药／射击序列不变，以及键盘网格／Enter。

普通与 Editor 轮均验证：静止商店连续 20 帧 **0 条重复 DOM 变更**；关闭后连续 12 帧 **0 次商店连续读取**；640×720 紧凑布局无横向溢出。1280×800 桌面排版和紧凑布局均有截图，未据此宣称 FPS 提升或完成触屏玩法验收。

最终本次证据位于项目外：

- 普通轮：`D:/opencode-temp/opencode/ui-phase-two/1794903031156/report.json`
- Editor 精简轮：`D:/opencode-temp/opencode/ui-phase-two/1794903136846/report.json`
- 两目录中的 `shop-desktop.png`、`shop-failure.png`、`shop-compact.png` 是本轮截图。
- 源码构建：`D:/opencode-temp/opencode/ui-phase-two/source-build-1794903348773/`

复现（先启动现有 Vite 开发服务器；测试输出／profile 默认在 D 盘临时目录）：

```powershell
node tools/check-ui-browser.mjs 'http://127.0.0.1:5173/?editor=0&probes=0&ao=0&aa=none'
$env:ARMORY_QUICK='1'
node tools/check-ui-browser.mjs 'http://127.0.0.1:5173/?editor=1&probes=0&ao=0&aa=none'
```

测试期间关闭 probes／AO／AA，验证焦点、输入、选择与资源事务，不替代默认画质回归。缓存命中数未统计；关窗后、页面重载和关卡重挂载允许复用资源缓存，故障重试和冷选择在独立 profile 中实际执行。未运行武器导出／发布缓存流程。

## 未实施／未验收

- 未进入阶段三：真实挑战会话、射击开始、固定伤害／护甲、无限备用弹药、网格／10 只机器人补刷、世界计分板与击杀 VFX 均未接入。
- 不是购买／替换背包接口，不包含经济、退货、赠送、队伍、护甲或技能。
- 未修改 Blender、已发布武器／房间资产、配方或 package-manager 锁文件；未导出／发布。
- 未运行全量 `npm test`、完整武器音频／房间光照组合回归、操作系统级 Alt+Tab 人工验收或触屏玩法验收。
