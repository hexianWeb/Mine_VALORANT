# 武器玩法模块

本模块已将[动画与多枪设计](../superpowers/specs/2026-11-11-animation-and-multi-weapon-design.md)的前四阶段接入练枪房：Classic 与 Phantom 的准备、切换、射击、换弹、检视、固定步瞄准、视模播放及兼容皮肤替换形成同一条更新链。装备裁定仍只处理普通数据；PlayerWeapons 连接输入、AimState、资源和表现。双枪的本地[运行时音频](audio.md)也已接入；后续皮肤素材由用户处理，不再自动生成或替换纹理。

## 游戏入口与控件

运行 `npm run dev` 后打开主页面。默认背包为主武器 Phantom（rifle）与副武器 Classic（pistol），初始选择 Classic。`?editor=0` 关闭工具 UI，仍保留玩家、武器输入和 HUD。`/weapon-preview.html` 是独立资产预览页，不运行装备玩法。

| 操作 | 控件 |
| --- | --- |
| 捕获鼠标 | 点击画面；首次捕获点击不射击 |
| 开火 | 左键；Classic 单发，Phantom 按住连射 |
| ADS | 按住右键；仅 Phantom 支持 |
| 主 / 副武器 | 1 / 2 |
| 循环切枪 / 上一把 | 滚轮 / Q；上一把在完成掏枪后更新 |
| 换弹 / 检视 | R / T |
| 循环当前枪皮肤 | K；Classic 为 smite ↔ sakura，Phantom 目前只有一款 |
| 回出生点 | Home；玩家复位按钮走同一排队入口 |
| 移动 / 静步 / 蹲下 / 跳跃 | WASD / Shift / C / 空格 |
| 释放鼠标 / 飞行观察 | Esc / V（飞行观察需要 Editor） |

鼠标按钮、滚轮与视角增量只在输入启用且 Pointer Lock 生效时接收；键盘还允许画布聚焦时输入。失焦、解锁、隐藏或禁用会清除 held、边沿和鼠标增量。InputSystem 的 `consumePressedEvents()` 保留动作顺序，与 `consumePressed(action)` 共用队列，不重复派发。

## 所有权与入口

统一导出入口是 [index.js](../../src/game/weapons/index.js)。

| 模块 | 职责 |
| --- | --- |
| `createWeaponDefinition()` | 校验并复制配置，返回深冻结定义；不保留或冻结调用方原对象 |
| `WeaponInventory` | 槽位、逻辑实例及实例状态；读操作返回只读快照，更新先完整校验再提交 |
| `EquipmentController` | 私有持有背包，统一裁定装备事务、动作优先级、弹药与冷却 |
| `weapon-logic.js` | 换弹转移、射击扣弹与射速规则，不产生渲染或命中副作用 |
| `PlayerWeapons` | Player 的武器入口，收集命令、推进固定玩法、补全射线事实并分发表现 |
| `AimState`（`game/player`） | 基础视角、后坐力、散布、ADS/FOV、眼位平滑与表现历史 |
| `WeaponViewModel` | 唯一拥有 active/staged 视觉实例、播放器更新和延迟表现队列 |

`definitionId` 标识枪型，`instanceId` 标识实际持有的枪，槽位 `id` 表示选择入口。两把同型号枪可共享定义，但各自保存 magazine、reserve、nextFireAt、blockedUntil 和 shotSequence。控制器不暴露内部可写背包；单独导出的 Inventory 可用于数据验证与未来库存规则。

```js
import {
  classicDefinition,
  EquipmentController,
  phantomDefinition,
} from './src/game/weapons/index.js'

const fixedDelta = 1 / 60
const equipment = new EquipmentController({
  definitions: [classicDefinition, phantomDefinition],
  loadout: [
    { id: 'primary', weapon: { instanceId: 'rifle-1', definitionId: 'phantom' } },
    { id: 'secondary', weapon: { instanceId: 'pistol-1', definitionId: 'classic' } },
    { id: 'spare', weapon: null },
  ],
  initialSlot: 'secondary',
  fixedDelta,
})

// 独立逻辑示例；实际接线时传 Engine 的 postPhysics context。
const first = equipment.step({ fixedTick: 1, fixedElapsed: fixedDelta, fixedDelta })
const ticket = first.effects.find(effect => effect.type === 'PrepareWeapon').ticket

// 仅在视觉适配者已完整准备并校验实例后投递；测试可用票据模拟。
equipment.queue({ type: 'prepared', ticket })
equipment.step({ fixedTick: 2, fixedElapsed: 2 * fixedDelta, fixedDelta })
// activeId 为 pistol-1，phase 为 Drawing。到 tick 47 才结束 0.75 秒掏枪。
```

实际调用方必须逐步推进到 tick 47，不能从 tick 2 直接跳到 47。例子中的资源就绪回填只演示协议，并未加载 GLB。

## 定义格式与首批数据

所有时长均为游戏秒。定义要求显式提供 `id / capacity / initialReserve / fire / equip / reload / inspectDuration / capabilities / assets`，还支持经 `createAimProfile()` 校验的 recoil、spread、aim；未知字段报错。reload 包含 tactical、empty 两个分支，每个分支提供 feed、duration，且 `0 <= feed <= duration`。equip 包含 draw、holster，允许零时长。

本阶段支持 semi 与 auto 两种 fire.mode。控制器每固定步最多接受一次射击，构造时要求 `fire.interval >= fixedDelta`；不支持的频率直接报错。持续自动射击沿原有 deadline 累加间隔，避免每发向上取整后持续拖慢；实际 ShotFired.at 仍是接受该发的固定步时间。停止按火、切枪或换弹结束后不补发期间错过的射击。

| 配置 | Classic | Phantom |
| --- | --- | --- |
| 弹匣 / 初始备用弹药 | 12 / 36 | 30 / 90 |
| 射击模式 / 间隔 | semi / 60÷405 秒 | auto / 60÷660 秒 |
| 掏枪 / 收枪 | 0.75 / 0 秒 | 1 / 0 秒 |
| 战术换弹 feed / duration | 1.75 / 1.75 秒 | 1.2 / 2.5 秒 |
| 空仓换弹 feed / duration | 1.75 / 1.75 秒 | 2.25 / 2.5 秒 |
| 检视时长 | 3 秒 | 4 秒 |
| ADS 能力声明 | false | true |
| 模型 / 默认皮肤 | classic / smite | phantom / tactiplay |

弹量、射速、装备和换弹时刻依据本地 `valorant-first-person-pack` 的 manifest runtime；模式与检视时长依据来源数据及 clip。备用弹药为本项目选择的三个备用弹匣。Classic 当前使用 v2（同一基础模型，smite/sakura 两款），Phantom 使用 v1，均已发布到 `public/weapons/`，见[发布和播放](animation-and-assets.md)。

loadout 可覆盖实例的初始 magazine、reserve、skinId；其他状态从零开始。`reset()` 保留 loadout 的槽位、枪型、实例标识和皮肤，将弹药补至定义的 capacity / initialReserve，并清零冷却与射击序号。跨重生身份以 `(epoch, instanceId)` 区分。

EquipmentController 的 ShotFired 只包含射击序号和弹药事实；PlayerWeapons 在同一 postPhysics 步调用 AimState，补充 eyeOrigin、aimDirection、shotDirection、seed、aiming 与 impact。impact 是最远 200 米的碰撞盒射线查询，提供盒名、距离和交点；当前没有敌人生命值、伤害、穿透或联网同步。枪口闪光与命中准星只提供表现反馈。

## 固定瞄准与统一表现时间

Player 在 input 收集 look、移动和动作指令，不直接更新相机朝向。Motor 在 fixed 使用基础 headingYaw 移动；postPhysics 先处理越界/重生，再调用 PlayerWeapons.fixed，完成装备裁定、AimState 更新、射线和视角历史。同帧多个固定步只消费一次鼠标增量；零固定步帧保留 look 与重生请求。

每发采用“冲量前有效瞄准 + 本发散布 → 射线与扣弹事实 → 本发后坐力冲量”的顺序。身体只使用基础 yaw；pitch 与武器后坐力不倾斜碰撞体。射线起点来自固定步眼位，眼高、踏步平滑和近裁面安全约束在固定求值中处理。CameraComponent 只采样历史并写世界相机，模型骨骼和 Mixer 不决定射击方向。

设 C 为最近完成的 fixedElapsed、h 为 fixedDelta，每帧共同使用 `P = max(0, C - h + alpha * h)`。世界相机、视模动画、ADS/FOV、准星、弹药 HUD 和枪口火光消费同一个 P。已发生但尚未到 P 的事实等待展示，因此 gameplay activeId 可以已为 B，而 renderActiveId 仍为 A。后坐力不在 ShotFired.at 之前提前抬枪；同刻射线使用 preShot 姿态，普通画面使用 postShot 姿态。相对最新模拟，表现有约一个固定步的插值延迟。

HUD 由 `app/weapon-hud.js` 读取已展示事实，不能用最新背包数值提前显示换弹或切枪。`__RANGE_ROOM__.snapshot().player.weapons` 同时提供实时装备快照与 view 表现快照，两者的 active、弹药与 lastShot 属于不同时间。

来源与项目策略集中在 [aim-profile.js](../../src/game/weapons/aim-profile.js)：recoil 角度从度转换为弧度，保留时间与轴向含义；每发按确定性 seed 采样 min/max 时间曲线点并保留恢复段，切枪不抹去已有偏移。这两枪的来源字段是 recoil，没有额外 camera_recoil；GLB 的 camera / views 装饰轨道不会再次叠加到世界相机。当前采用发射后立即生效的首关键帧与线性恢复，不声称复刻 TACZ 的 30 ms 延迟样条或仅保留最新一发的行为。`patternIndex = shotSequence - 1` 记录逐发身份顺序，不表示实现了来源的按发数图案。

来源 inaccuracy 是无量纲参数，本项目按 `source * 0.0172275` 标定相机局部三轴独立三角分布噪声，方向归一化后再转到世界空间；原值不是锥角，也没有另造每发累积 bloom。表现采样不会推进状态或抽取随机数。世界默认 FOV 从运行时相机注入；Phantom ADS 将世界与视模 FOV 平滑到 45°，Classic 的能力字段禁止 ADS。

## 命令、时间和结果

| 命令 | 参数与含义 |
| --- | --- |
| `select` | instanceId，选择持有实例 |
| `selectSlot` | slotId，空槽和未知槽无操作 |
| `cycle` | direction: 1 或 -1，按配置顺序循环非空槽 |
| `selectPrevious` | 选择上一笔完成切换的来源实例 |
| `setSkin` | instanceId、skinId；准备成功后才提交，不改玩法状态；失败保留原皮肤，再次选择可重试 |
| `cycleSkin` | instanceId；按定义的 assets.skinIds 循环，连续命令基于最新意图而非旧外观 |
| `skinPrepared / skinFailed` | 原样回填皮肤 ticket；失败可附 message；不携带 Three 对象 |
| `fire / reload / inspect` | 单次动作边沿；queue 返回 false 表示当前不能接收 |
| `fireHeld` | held: boolean；auto 持续射击，semi 仍需要 fire 边沿 |
| `prepared / prepareFailed` | 原样携带 ticket；失败可附 message |

`queue()` 只收集命令；返回 true 不保证动作最终被接受，仍需下一固定步裁定。单次动作绑定入队时的装备代次，在 Drawing 或 Suspended 时不会缓冲成新枪上的动作。自动枪持有 fireHeld 时可在掏枪结束后开火；半自动枪需要 Ready 后的新 fire 边沿。

`step(context)` 同时接受 `{ time }` 和直接的时间快照，要求 fixedTick 为正整数、fixedElapsed 与 `fixedTick * fixedDelta` 一致、fixedDelta 与构造配置相同。第一次可从全局任意正 tick 开始，此后必须连续。完整 Time 快照还检查 fixedStepIndex 等子步字段；无效时间在消耗命令前报错。模块不读取墙钟、不自建累加器、不接受 timeScale=0 的模拟步。

每次 step 返回深冻结的 `{ events, effects }`。events 为已接受的玩法事实，effects 为资源准备意图，必须分别分发。事实携带 `{ epoch, sequence, fixedTick, at, instanceId, type, payload }`；sequence 单调递增，actionId / switchId 在相关 payload 内。PlayerWeapons 统一接收批次；固定步循环结束后，motion 只展示已经到达 P 的事实。

`snapshot()` 返回装备阶段、activeId、previousId、queuedTarget、pendingTarget、pendingReadiness、transaction、action、操作资格及完整只读背包。pendingReadiness 为 loading、visualPrepared、failed 或 null。UI 使用 canAct / canFire / canReload / canInspect，不自行重算资格。ReadyBlocked 表示 `phase=Ready` 且 `actionBlockReason=nextSwitchDeferred`；当前单一后续目标协议通常无需触发该保护。

## 切枪和换弹边界

同一步先合并选枪命令，再核对准备回调，最后决定是否开始切换。等待资源时当前枪仍可操作；一旦开始 Holstering，事务目标锁定，后续选择只覆盖一个 queuedTarget。每段时长分别向上量化为固定步；commitTick 唯一提交 activeId，readyTick 开放操作。后续目标准备完成时，上一笔 Drawing 到期可直接开始下一笔 Holstering，中间不接受开火。

选择当前枪不重播掏枪。准备失败不卸下旧枪，也不无限自动重试；再次选择失败目标会创建新 requestId。选枪与补弹恰在同一步到期时，能开始的切枪先取消换弹。

换弹在 feedTick 转移一次 `min(capacity - magazine, reserve)`，使用 `(actionId, commitIndex=0)` 标识提交。feed 前或同一步先被切枪打断，弹药不变；已经提交则保留弹药和直到 endTick 的 blockedUntil。切回后仍受这段恢复时间限制。射击的 nextFireAt 保存在枪实例上，切换不会重置。离手期间冷却按绝对模拟时间自然过去，换弹与射击动作不在后台继续。

同一步有效换弹优先于开火，无效换弹不吞合法开火。换弹可打断检视；开火可打断检视；切枪可打断两者。

## 资源与生命周期接口

PrepareWeapon 携带 `{ epoch, requestId, instanceId, modelVersion, skinRevision }`。skinRevision 对应当前 epoch 中该实例已提交的外观版本。适配者通过快照查 definitionId / skinId，完整准备后把原票据作为 prepared 入队；异步回调不能自行装备或改变背包。

PrepareSkin 另带 ticket.skinId，异步阶段只预热兼容纹理；motion 排入 skinPrepared，下一固定步提交 SkinChanged。表现游标到达该事实时同步替换该实例的兼容皮肤材质绑定；节点、Skeleton、材质对象、Mixer、playbackId、动作时间、弹药和冷却不重置，也不触碰角色手臂。当前绑定中的[旧材质兼容状态](animation-and-assets.md#旧材质兼容状态)与待实施的[新版材质路线图](material-quality-roadmap.md)分开说明，材质迁移不改变这套玩法提交时序。skinRequests 快照给出 loading/prepared/deferred/failed 与具体错误；视模的 skinError 仅显示当前实例的失败。

同实例只保留最新换肤意图；旧回调不能覆盖新选择，已经接受的 SkinChanged 所需句柄则保留到展示完成。未锁定装备准备在换肤提交后以新 revision 重建；切换事务参与者的换肤延后到解锁，不替换 reserved staged。Editor 交接失效未提交请求，但保留已提交皮肤；若逻辑皮肤领先画面，返回时将保留视模绑定到已提交外观。重生按初始 loadout 恢复皮肤与弹药。

CancelPreparation 是逻辑取消，不能据此中止仍有其他使用者的共享下载。DiscardPreparation 只允许清理完整票据匹配的未接受 staged 实例，禁止按 instanceId 释放当前或等待历史表现提交的实例。控制器在当前 epoch 内记住已接受票据，重复回调不会要求丢弃它们；epoch 失效时由适配者统一撤销旧资源所有权。

| API | 行为 |
| --- | --- |
| `setPaused(true/false)` | 仅状态改变时清动作边沿和 held；保留装备与定时动作。同值调用无副作用；暂停 step 返回空批次且不推进时间 |
| `suspend()` | 同步取消动作、准备和事务，递增 epoch，保留已提交枪和弹药，进入 Suspended；直接返回失效批次，须在停 tick 前处理 |
| `resume()` | 允许跨越全局停更 tick；下一 step 为保留枪创建新 epoch 的准备票据，准备完成后重新掏枪，不重复发 EquipCommitted |
| `reset()` | 同步递增 epoch，取消旧工作，重建 loadout，回到 Empty（Editor 中仍挂起）；直接返回失效批次；下一有效 step 请求初始枪 |
| `dispose()` | 同步失效并返回批次；重复调用返回空批次，后续 queue 返回 false，step 抛错 |

暂停要求调用方同时冻结模拟时钟；仅让武器暂停而继续推进全局 tick 不符合本接口。Editor 的停更使用 suspend/resume，恢复明确允许 tick 间隔。reset 不重置 Engine 的时间轴；换到新的时间域时应创建新控制器。

恢复时即使有可用视模，也通过新票据确认一次，适配者可复用保留视模并快速应答。恢复准备失败时可重新选择当前 active 枪重试。恢复准备期间不接受其他选枪目标或武器动作。尚未初始装备就进入 Editor，返回后走正常初始装备流程。

## 游戏接线与生命周期

RangeRoomLevel 加载时只等待初始 Classic 的共享资源预热，随后启用 Player 和 Engine。Promise 完成不创建实例；motion 在票据有效且槽位可用时调用 WeaponAssets.instantiate，再将 prepared 排入下一固定步，避免加载和更新互相等待。

WeaponViewModel 同时最多拥有 active 与 staged 两个实例。切换被接受后立即保留 staged，历史表现到 commitAt 才释放旧视模、挂载新视模。进入 Editor 时按逻辑 activeId 保留已提交枪，即使画面仍显示上一把；返回后用新票据确认保留对象并重新掏枪，不再次提交装备所有权。返回后的首个 postPhysics 将 AimState 历史重锚到 `C - h` 并保留新 look，避免跨 Editor 停更间隔插值；Engine 暂停不推进全局时钟，不做这次重锚。

Engine pause 与 timeScale=0 冻结事务及剩余时间。恢复前先提取 Home 重生请求，并按输入顺序合并数字键、滚轮、Q 的选择，只保留一个最新槽位意图；实际恢复后的固定步再校验能否执行。fire、reload、inspect、aim 和 look 均丢弃，不补发暂停期间的动作，也不保留开火或瞄准 held。`input.clear()` 不禁用输入也不释放 Pointer Lock。

Home 与工具重生请求在下一实际 postPhysics 固定步执行，恢复首帧 delta=0 时仍等待。重生失效旧 epoch、恢复初始背包与弹药，并重置视角历史；卸载先释放视觉实例，再释放关卡资源。

## 验证与剩余范围

运行 `npm test`，专项文件为 weapon-data.test.mjs、equipment-controller.test.mjs、weapon-timing.test.mjs。覆盖定义校验、同枪多实例隔离、快切及加载乱序、分段时间量化、换弹提交前/同一步/提交后打断、两种冷却、输入优先级、暂停恢复、重生、只读输出及固定步时钟契约；真实 Time 驱动 30/60/144 FPS 和五步追帧，验证非整数射击间隔没有累计漂移。

第三阶段另由 input、player-input、player、player-weapons、aim-state 相关测试验证真实动作输入、固定视角、异步准备、历史交接、Editor、暂停和重生。主游戏浏览器验收入口为 `tools/check-weapon-gameplay-browser.mjs`；资源预览检查仍使用 `tools/check-weapons-browser.mjs`。

当前主游戏范围是双枪练习与 Classic 双皮肤闭环，K 输入及 HUD 已接入。Classic/Phantom 八个本地声音文件由玩法事实和独立音频游标驱动；未映射的其他素材不会自行播放，详见[运行时音频](audio.md)。[稀疏控制与弹药事实采样](runtime-controls.md)已实现并通过 Judge/Odin 源曲线数值测试，但其余七枪完整发布、Judge/Odin 整枪接入、完整伤害系统及 3p 空间声尚未交付。换肤相关专项还包括 weapon-skin-publication.test.mjs；主游戏浏览器报告包含 skinSwap 身份检查与 repeatCycles/销毁结果。
