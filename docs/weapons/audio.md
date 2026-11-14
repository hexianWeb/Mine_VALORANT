# 武器运行时音频

Ghost、Vandal、Sheriff、Judge 与 Odin 后续各新增 shoot、draw、reload、inspect 四个本地 cue，沿用相同的独立事实时钟与取消机制；**当前七枪共预热 28 个本地 Ogg**，见 [Ghost 接入](ghost-integration.md)、[狂徒接入](vandal-integration.md)、[正义接入](sheriff-integration.md)与[判官／奥丁接入](judge-odin-integration.md)。下述双枪历史验收不冒充后续枪型本次验收，结果分别记录。

Classic / Phantom / Ghost / Vandal / Sheriff / Judge / Odin 的本地射击、掏枪、换弹、检视已接入主游戏。没有改写 Ogg 音频采样；Operator／Outlaw、3p 空间声、齐射、Operator 拉栓和 Outlaw 分支的实际游戏接线尚未交付。原设计及算例见[第 13 节](../superpowers/specs/2026-11-11-animation-and-multi-weapon-design.md#13-新增音频盘点与接入)。

## 所有权与资源

- RuntimeContext 唯一拥有 `function/audio/AudioSystem`，每个 runtime 最多一个 AudioContext，按需创建。可信的画布 pointerdown/keydown 调用 unlock；只有 resume 成功并且 context.running 才建锚点。无 API、未解锁或解码失败不阻塞装备和射击。
- resource 的 `binary` 复用下载、SHA256 校验和取消逻辑，不依赖音频功能模块。AudioSystem.decode 复制 bytes 后调用 decodeAudioData，不会分离 ResourceManager 缓存的 ArrayBuffer。
- WeaponAssets 用关卡信号加载 AudioBank。当前七枪各四个唯一文件，共二十八个；战术/空仓换弹显式共享 reload cue。重复预热共享下载与解码，成功的兄弟资源保留，失败可显式重试；关闭作用域后迟到解码不得回填。
- 当前 loadout 的音频异步预热，不参与 VisualPrepared，也不延迟启动 Player。暂未就绪的瞬态声音直接丢弃；仍有效的长动作可在正确 offset 接入，已取消的动作不会复活。
- 配置在 `src/game/weapons/definitions/audio.js`，包含实际 Ogg 的 SHA256 和逐 cue 增益。枪声 gain=0.25、动作 gain=0.22，master=0.6；不修改源音频采样。主观响度仍需实际试听。

## 事实与播放

PlayerWeapons 将同一装备事实批次分给 WeaponViewModel 与 WeaponAudio，后者拥有独立游标。motion 仅提交 `at <= 已完成 fixedElapsed` 的事实和动作 marker，不等待延迟画面到达 P。

| 来源 | 音频副作用 |
| --- | --- |
| ShotFired | 一个本地 shoot cue，每发新的 source，可受控重叠；Judge 每发 12 弹丸仍只播放一次，不同时播放 shoot_3p |
| DrawStarted(initial/switch/resume) | 唯一的 draw 来源；EquipCommitted 不再播放第二次 |
| ReloadStarted | 使用已经选定的 tactical/empty 分支，当前七枪均指向各自同一 reload 文件 |
| InspectStarted | 一个整段 inspect cue |
| SwitchStarted、动作取消 | 撤销同实例的未来动作 cue，映射到取消时刻并淡出；普通切枪不停止已发生的枪声尾音 |
| PresentationReset / dispose | 立即失效该玩家旧 epoch 的 cue/source，包括保留的尾音 |

音频语义 ID 由 owner、epoch、事实 sequence 和 cue/marker 组成。适配者按递增事实序号防重；变速重建 source 仍使用同一个语义 ID。未来 marker 使用动作起点加局部时间/动作速度，不能用发现它的帧时间。同刻取消先于 marker；零时刻同义起音去重，独立零时刻 cue 不误删。Mixer 返回的 marker 仅为数据，不会再直接发声。

draw/inspect 使用现有视模动作的显式时长映射，reload 保留来源秒并裁切恢复尾段；音频时长不决定操作资格、弹药或装备时刻。整段动作轨跟随 `timeScale * actionRate`，接受音高变化，不提供保音高拉伸或任意逐发装填拼接。

## 时钟、取消与暂停

Engine 在所有 presentation 输出完成后、swap/render 之前调用一次 flush，同时提交最终 listener pose。rendererTick 只绘制，不再次调度声音。时钟使用未延迟的 `S = C + alpha*h`：

```text
latency = h / r + 0.010
audioTime(at) = anchorAudio + latency + (at - anchorSim) / r
deadline = audioTime(at) - 0.006
```

普通帧不重锚。错过 deadline 的瞬态记为 missed-deadline，不逐个 start(now)、不整批平移或补播。60 Hz 常态延迟约 26.7 ms，设备延迟另计；五步追帧的早期声音可能被丢弃，玩法事实不丢。

首次解锁、暂停/中断恢复、正变速、时钟重置以及裁剪/丢时才建立新段。Time 新增 unclippedDelta、clippedWallTime、clockRevision，连同 droppedSimulationTime 诊断完整断点；250 ms 裁剪帧先按旧锚点丢弃过期批次，再重锚后续事实。仍有效的长动作淡出旧 source，按新段的正确 offset 接续；不允许接续的 cue 静音。已开始的枪声尾音不随变速改变音高。

Engine pause 与 timeScale=0 暂停 context，撤销尚未开始的枪声；恢复不补发旧输入。已解锁后在暂停期间点击不会偷偷 resume。interrupted 立即撤销未来瞬态，避免在恢复后的首个 JS 帧之前发声。动作取消用 8 ms 淡出；epoch 失效/关卡卸载立即停止。

默认最多 24 个非淡出 voice，超额优先淘汰旧枪声尾音；旧 source 的 8 ms 淡出可能短暂重叠。结束、丢弃和取消记录释放 buffer/source 引用，诊断/近期去重最多保留 512 个终态记录。卸载先停止作用域 voices，再清 AudioBank 和共享 bytes；runtime 最后关闭 context。

## 验证与诊断

```powershell
npm test
npm run dev
node tools/check-weapon-audio-browser.mjs http://localhost:5173/
```

Node 专项为 `audio.test.mjs`、`weapon-audio.test.mjs` 和 resource-loading 的 binary 检查，覆盖 30/60/144 FPS 同一绝对起音、1/2/5 步批次、250 ms 裁剪重锚、动作接续、取消/中断、变速、暂停、解锁拒绝、解码乱序及作用域关闭。PlayerWeapons 还验证只预热持有枪型而非整个 catalog。音频初次交付时全量 317 项通过；控制轨道阶段的历史 352 项及再次音频浏览器回归见[稀疏控制](runtime-controls.md)。这些不是七枪现状的全量测试结果；最新验收范围及既有材质测试失败见[判官／奥丁接入](judge-odin-integration.md#本次验收与耗时)。

音频初次交付的浏览器专项使用真实 Chrome/Web Audio：可信点击解锁、当时八个 Ogg 实际解码、最终输出 Analyser 波形、单发和至少 16 发连续射击、换弹打断、暂停不补播、0/0.5/2 倍速、相同语义 ID 的正确动作 offset、控制权交接、卸载与 context 关闭。历史生产构建报告在 `D:/opencode-temp/opencode/weapon-audio/production-final/report.json`，该次 Phantom 连射 20 条 cue，Classic/Phantom 输出峰值约 0.094/0.132；暂停前后 currentTime 均为 4.28 秒，卸载后 voice/cue 为 0、context.closed。原有全套双枪玩法报告在同级 `gameplay-final/report.json`。当前工具按配置计算七枪预热数量，动作回归仍以双枪为主。

Judge/Odin 本次另用 `check-judge-odin-browser.mjs` 验证两枪各四种 cue、打空时每发一个枪声及最终输出，峰值约 0.105／0.226；成功报告为 `D:/opencode-temp/opencode/judge-odin-integration-20261114-d6a42f/gameplay-browser-retry/report.json`。未重新运行上述完整音频专项。非零波形及低于满幅不是主观音量或 true-peak 验收。

上述历史音频阶段的首轮开发版冷启动出现 Vite 模块请求 net::ERR_ABORTED，另一次在房间 manifest fetch 时中止，均未进入音频断言；报告保留在 browser / browser-verified。browser-final 还保留了过严浮点相等断言失败，现已改为容差和锚点公式验证。未修改运行时加载逻辑来隐藏这些启动请求中断；该阶段开发版通过结果见 browser-second，最终结果以其生产构建回归为准。生产路径也可用 `npm run build`、`npm run preview` 后对 `http://localhost:4173/` 运行同一脚本复核。

`__RANGE_ROOM__.audio.snapshot()` 返回锚点、段原因、voice 数量、cue 状态和失败统计；`player.weapons.audio.bank` 返回缓存 cue 数与实际解码字节数。浏览器默认输出 `D:/opencode-temp/opencode/weapon-audio/browser`，可用 WEAPON_AUDIO_TEST_OUTPUT 指定新目录，判断结果以当次 report.json 为准。
