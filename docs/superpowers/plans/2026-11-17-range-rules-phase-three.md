# 阶段三：挑战规则、网格与整发伤害——实施记录

日期：2026-11-17

依据：[靶场挑战设计](../specs/2026-11-16-range-challenges-design.md)，规则版本仍为 `range-challenges-v2-2026-11-17`。

用户同意“先提交阶段二，再开始阶段三”。阶段二已提交为 **`5f5d0ef`**（`feat(range): 完成阶段二七枪商店闭环`）；阶段三首次交付时未提交，后续按用户要求提交，以 Git 记录为准；未推送。**本轮交付逻辑与接线，不进入阶段四，不宣称完整挑战已经可以游玩。**

## 完成的逻辑

| 模块 | 本轮内容 |
| --- | --- |
| `src/game/range-room/challenges/config.js` | 固化模式一 30 次、1 只；模式二 50／100、10 只；1 米网格、90°／18 米、100 HP、0／50 甲与零额外等待；三档窗口向上量化为 tick，拒绝改写既定参数 |
| `challenge-session.js` | 纯数据规则与活跃身份集合；单目标半开截止、多目标批量死亡／缺额、稳定排序、达标不超计、收场与取消；时间由外部固定步传入，随机／位置由外部合法分配结果提供 |
| `spawn-grid.js` | 完整正方形的扇形几何候选；显式场景验证回调给出地面高度；批量均匀选格、八邻格保护引用计数、固定退场保护、旧局释放隔离与有界布局容量证明 |
| `range-challenge.js` | 尚未装配到关卡的 `RangeChallengeComponent`：借用预加载目标池句柄、同步初批／补位、先判完成、固定步超时／释放、取消及按 P 消费的会话历史；不拥有目标 GO |
| `src/game/combat/fixed-damage.js` | 七枪固定表和六个 region 的显式映射；Judge 腿伤仅在表中规范为 14.45；无公网请求、距离衰减或逐次取整 |
| `src/game/targets/target-combat.js` | 每次出靶持有独立 `CombatAttributes`；全组伤害预计算、逐弹丸提交、计划版本校验、一次死亡、满属性重置与旧身份拒绝 |
| `ShotTargets`／`PlayerWeapons` | 整发查询／预校验／提交；仅在结果完整返回后调用注入的 `onShotResolved(result, context)`，不从逐弹丸回调或 frame 补刷 |
| `target-poses.js`／`TrainingBotComponent` | 独立权威／可见骨架及播放器；固定时刻幂等采样、P 事实游标、击杀姿态／位置的不可变副本与独立表现种子；不制作 VFX |
| `panel-control.js` | 开始／练习／四种灵敏度命令的快照与修订校验；一发最多接受一个交互，接受后消费整发；实际热区和场景表面未接入 |

### 伤害及整发边界

- Profile 的 `head → head`、`chest / arm_l / arm_r → body`、`leg_l / leg_r → legs`；现有 pelvis 已在 profile 中归入 chest，没有新建命中盒或默认未知部位。加载前校验现有六个 region 对七枪的覆盖。
- `beginShot()` 在全部射线前准备权威姿态并捕获身份；命中记录包含注册代次以及 `sessionId / spawnId / cellId`。`trace()` 不扣血、不抽格、不推进动画。
- `resolveShot()` 保留原 `epoch / sequence / fixedTick / at` 与逐弹丸索引；单弹归一为 index 0，有 pellets 时不再结算汇总 impact。
- 合法面板命中优先，整发消费；未接受交互才处理原存活集合的伤害。所有目标及后续弹丸配置先通过预校验，才逐目标提交，防止“前面已扣血，最后一颗才报错”。
- 同一目标非致死只发一个合并反馈，致死只发一次 `TargetKilled`，不再走旧 `ShotTargets.react()`；真实多目标死亡仍独立保留，挑战只截定计分，不截掉已产生的真实死亡。
- 注册表的 source 只在 `openSource()` 到 `closeSource()` 间有效，控制器 reset／suspend 会立即同步新 epoch；每个活跃 source 只留高水位游标，不保存整局弹丸日志。目标计划及会话再分别守住生命周期与重复死亡边界。

### 网格、缓冲与失败

几何候选由**传入的复活位置／yaw**建立，四角完整处于扇形才保留，不猜地面 Y。`validateSectorCells()` 必须由下一阶段提供真实地面、姿态体积、墙／玩家占位及射线可见性校验；本轮测试的有限地面值只是夹具。

准备阶段需要证明存在 `N + N` 的合法布局，并准备至少初批加一整批退场缓冲的目标资源；不是空格数大于 N 即通过。批量分配失败不留半批占用。后续随机补位或资源容量异常会明确中止并清理本局，不记有效成绩，不降并发、不放松保护、不加等待。保护圈重叠时各 owner 的贡献分别释放。

`bodyHideDelay` 为装配者必须显式提供的正值，并一次量化为固定 tick；击杀事实记录对应 `bodyHideAt`，占位按同一计划释放。**本轮未选定真实 VFX 的隐藏延迟、退场实例预算或实际房间容量。** 还需按真实姿态与多批退场核验，不能将夹具的 0.05 秒或容量结果当成制作参数／场景验收。

### 姿态、展示与生命周期

- 权威骨架不入可见 Scene；固定采样重复调用不多推进一次，射线不读刚被 P 改写的骨骼。可见播放器先推进到事实时刻，再推进到 P，不按每帧固定加 h。
- `TargetKilled` 固定原出靶身份、部位、致死弹丸、Transform、骨骼姿态与表现种子；不借用下一靶可变数据，不消耗网格随机序列，不启动死亡动画。
- 激活挑战出靶后关闭该 Mesh 的常规逐帧 Transform 同步，挂载／释放仍归 Mesh；可见放置随出靶事实到 P 才切换。尚未装配真实目标池／退场 VFX，不能据此宣称完整击杀展示已完成。
- 玩家新增可注入的 `onLifecycle({ type, at })`，实际重生及停用时先通知，再 reset／suspend 武器；菜单隔离不走停用通知。下一阶段由关卡连接真实挑战取消，当前没有隐藏的全局挑战实例。
- 当前关卡仍只有原有三色自由练习展示机器人，保持原非致死受击语义；`activateSpawn()` 才开启本次出靶的战斗属性与身份。没有将三只展示机器人冒充挑战的 10 只。

### 供弹接口

核心已支持显式 `ammoPolicy: 'finite' | 'infinite-reserve'`，默认仍为 `finite`。无限备用只改变手动换弹的供给来源，不改变弹匣消耗、动作分支、feed／恢复提交时刻；背包的 reserve 仍是有限非负安全整数，不填 Infinity，不逐帧补弹。政策随武器事实进入 P 的窄 HUD 字段。

**本轮没有在 RangeRoomLevel 启用无限备用，也没有把 UI 改成已启用／∞。** 关卡注入、两端一致显示与完整玩法验收仍留给后续阶段。

## 本次验证与证据

| 检查 | 结果 | 耗时 |
| --- | --- | --- |
| 25 个直接相关测试文件：规则／网格、整发伤害、真实 GLB、玩家／输入、装备／弹药／商店、视模、动画、Runtime／架构等 | **303／303 通过**，无跳过 | 1.428 秒，见本次 TAP |
| Chrome／WebGPU 现有练习场专项回归 | **4 组通过**，运行时错误 0；验证 Classic、Judge 整发反馈、暂停双时钟及未替换原三只展示靶／有限供弹 | 8.982 秒 |
| 复用 UI／商店 Editor 精简回归 | **19 组通过**，运行时错误 0；含输入交接、准备失败重试、P、旧 scope 失效、静止零重复 DOM 写入 | 32.278 秒 |
| 本轮 JS／测试／浏览器脚本 ESLint | 通过 | 未单独计时 |
| Vite 默认应用源码构建，不复制 public | 通过；主 chunk 约 1,703.70 kB，仍有超过 500 kB 提示，不在本轮拆包 | 构建 API 总耗时 0.885 秒 |

测试覆盖全 30 次无人射击超时、混合击杀／超时、50／100 的最后同发超额死亡、稳定活跃集合与补齐、旧身份／注册／射击代次、跨目标原子预校验、整发消费、引用保护重叠、批量失败、资源／网格缓冲门槛、运行中容量失败及取消。真实 GLB 还验证拆分／追帧采样一致、同一步相反准备顺序幂等、P 不改变射线、旧姿态事实不借用新位置，以及取消不重放反馈。

本次证据均在项目外：

- 测试：`D:/opencode-temp/opencode/range-phase-three/tests.tap`
- 练习场专项：`D:/opencode-temp/opencode/range-phase-three/browser-1794905972798/report.json`
- UI／Editor：`D:/opencode-temp/opencode/range-phase-three/ui-editor-regression/report.json`
- 源码构建：`D:/opencode-temp/opencode/range-phase-three/source-build-1794905973088/`

专项浏览器脚本前 3 次未作为通过证据：分别在前台／就绪等待、Vite root 路径和二次导入的 HMR 类身份上失败，已定位并修正脚本；最终使用真实已挂载组件，不通过另建目标伪造成功。UI 回归中的 Ghost 请求失败来自其主动故障夹具；错误记录没有被清空。缓存命中数未统计；GLB 骨骼／几何／纹理仍复用现有资源，双骨架只增加运行时实例状态，无资产重导出或发布缓存流程。

复现专项回归（先运行现有 Vite 开发服务器）：

```powershell
node tools/check-range-rules-browser.mjs
$env:ARMORY_QUICK='1'
node tools/check-ui-browser.mjs 'http://127.0.0.1:5173/?editor=1&probes=0&ao=0&aa=none' 'D:/opencode-temp/opencode/range-phase-three/ui-editor-regression'
```

## 明确未完成的后续范围

- 未进入阶段四：没有真实 `screen-bottom / screen-top` 面板、开始方框热区／遮挡验收、目标池装配、挑战 HUD／F3 只读取消、真实商店互斥接线或击杀 VFX。
- 未验证实际房间的合法格、机器人完整姿态包络、10 只并发与退场缓冲，也未调整模型大小或规则来凑容量。
- 未启用关卡无限备用弹药、未做完整挑战的跨 FPS／多局／重生／暂停集成验收；未运行全量 `npm test`、全画质／音频／光照组合回归。
- 未改 Blender、已发布武器／房间资源、配方、锁文件；未导出、发布或推送。阶段三提交信息以 Git 记录为准。
