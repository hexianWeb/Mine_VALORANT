# 阶段一：UI 基础与输入交接——实施记录

日期：2026-11-17  
依据：[靶场挑战设计](../specs/2026-11-16-range-challenges-design.md)，规则版本 `range-challenges-v2-2026-11-17`。  
授权：用户明确要求「开始阶段一」。本次只交付该阶段，不自动进入阶段二。

## 已实现

- 关卡拥有统一 UI 宿主：HUD、调试层、原生模态窗口，支持顶层关闭、嵌套焦点返回、Tab／Shift+Tab 循环及卸载清理。
- 左侧绿色「靶场」状态卡和 F3 设置。模式、难度／50 或 100 个、护甲 0／50 明确标为**下一局预选**；当前仍为自由练习，不假装挑战、伤害或供弹已经接入。
- 玩家真实灵敏度：默认 0.40，细调 0.01、粗调 0.10，范围 `[0.01, 5]`。Player 在有效 `postPhysics` 提交，界面区分待提交／有效值；只保存已提交的有效值，非法保存数据或存储失败安全回退。
- 独立的 `gameplay / menu / unlocked / editor` 输入归属。菜单不调用 Player 的停用／武器挂起路径；已有换弹和资源准备继续推进，未提交的物理输入被清除，合法 UI 命令保留。
- Esc 先关顶层窗口，再次 Esc 暂停。真实失焦／后台调用既有 Engine 暂停，回焦不自动恢复；「继续」实际捕获成功后恢复，失败仍暂停，点击不射击。过期的捕获回复不能重新锁定已停用／已销毁的输入拥有者。
- 原有准星预览／代码导入接入同一模态机制，保留主准星／ADS／狙击预览、草稿校验和应用行为；导入框中的 `b` 等普通字符不被 B 快捷键吞掉。
- 武器 HUD 改读窄展示模型，不再逐帧复制完整 Player／武器／动画诊断；武器、弹药、命中提示仍以已到达展示时间的事实为准。文本按变化写入，准星保持脏绘制策略。Editor 小读数也不再轮询完整武器诊断。

## 主要边界

| 位置 | 职责 |
| --- | --- |
| `src/app/ui-host.js`、`ui-input.js` | DOM／焦点与输入归属；不拥有挑战规则、库存或新时钟 |
| `src/app/range-settings.js` | 本阶段的预选草稿和设置视图；`readSelection()` 不表示玩法已经采用该配置 |
| `src/game/player/look-settings.js` | `request / read / subscribe / commit`；有效值和待提交值由玩家拥有 |
| `src/app/sensitivity-storage.js` | 可失败的本地保存适配，键为 `mc-valorant.mouse-sensitivity.v1` |
| `PlayerComponent.setInputBlocked()` | 清理游戏输入，不停用 Motor／Camera／装备；恢复交接不丢弃暂停期间明确排队的工具重生命令 |
| `EquipmentController.clearInput()` | 仅清除标记为 `source: input` 的未提交命令，保留准备回复、UI 命令和已接受动作 |
| `WeaponViewModel.readHud()` | 缓存的小型不可变展示模型；完整 `snapshot()` 仍作为按需诊断接口 |
| `RuntimeContext.autoPauseOnHidden` | 通用默认仍为 true；本应用传 false，由 UI 协调显式恢复，不改通用 Engine 的原语义 |

## 本次实际验证

| 检查 | 最终结果 | 本次耗时 |
| --- | --- | --- |
| 输入、UI 协调、灵敏度、玩家、装备、视模、准星、相机、Aim、Runtime、架构相关测试，共 13 个测试文件 | **170／170 通过**，无跳过 | 1.373 秒 |
| Chrome／WebGPU，Editor 关闭 | **10 组通过**，无捕获到的运行时错误 | 18.484 秒 |
| Chrome／WebGPU，Editor 开启 | **11 组通过**，额外验证 Editor 与菜单交接 | 20.358 秒 |
| 修改的 JS／测试／浏览器脚本 ESLint | 通过 | 未单独计时 |
| Vite 源码生产构建，不复制 `public` 资产 | 通过；主 chunk 约 1,676.60 kB，仍有大于 500 kB 的提示，本次未扩展拆包 | 0.747 秒 |

浏览器为 1280×800、独立临时 profile；关闭 probes／AO／AA 以限制本次输入验收范围，不冒充默认画质或房间光照回归。实际验证了捕获点击不射击、F3 中模拟继续但无游戏输入、嵌套焦点／准星导入、Esc 分层、捕获失败、暂停时钟冻结、真实浏览器切页后台／回焦不自启、灵敏度重载恢复、卸载／重新挂载无重复热键。静止武器／左侧状态 HUD 连续 20 帧观察到 **0 条重复 DOM 变更记录**；没有据此宣称帧率提升。

开发期定位并修复了快速解锁后的请求缓存、Tab 焦点进入浏览器栏、迟到捕获和暂停 UI 命令保留问题。一次浏览器执行被热更新打断，一次重挂载检查使用了错误的 Vite 根路径，均不计作通过记录；表中仅列最终成功执行。

最终报告、截图、profile 和构建产物均位于项目外：

- 普通模式：`D:/opencode-temp/opencode/ui-phase-one/1794901333018/report.json`
- Editor 模式：`D:/opencode-temp/opencode/ui-phase-one/1794901366507/report.json`
- 两目录中的 `settings.png`、`hud.png` 是本次截图。
- 源码构建：`D:/opencode-temp/opencode/ui-phase-one/source-build-1794901333351/`

浏览器复现命令（先启动现有 Vite 开发服务器）：

```powershell
node tools/check-ui-browser.mjs 'http://127.0.0.1:5173/?editor=0&probes=0&ao=0&aa=none'
node tools/check-ui-browser.mjs 'http://127.0.0.1:5173/?editor=1&probes=0&ao=0&aa=none'
```

未统计浏览器／资源缓存命中数；页面重载和关卡重挂载可复用缓存，不作为冷资源验收。未运行资产导出或武器候选缓存流程。

## 未实施／未验收

- B 仅给出「下一阶段接入」提示和可复用的商店适配入口，没有假商店、选购事务或经济数据。
- 挑战会话、真实开局、运行中 F3 只读／取消、固定伤害／护甲、无限备用弹药、1 米网格／10 只机器人补刷、世界计分板及击杀 VFX 均留待后续阶段。没有 DOM 开始按钮绕过射击面板。
- 没有修改 Blender、导出／发布房间或武器包，也没有改写已发布资源／配方或 package-manager 锁文件。
- 未执行全量 `npm test`、全部武器／音频／房间光照回归、移动端验收或操作系统级 Alt+Tab 人工验收。当前证据仅覆盖上述相关测试与真实浏览器后台事件。
- 保留用户原有暂存的设计文档和三张参考图；阶段一首次交付时未提交、未推送，后续按用户要求提交，以 Git 记录为准。

下一步为**阶段二：最小商店闭环**，需要用户明确要求后再继续。
