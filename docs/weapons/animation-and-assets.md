# 武器资源发布与动画播放

> 枪身默认使用平直着色、全金属、跟随皮肤的自发光和静态室内反射。[材质参数与验证](material-quality-roadmap.md#当前默认材质与验证)

[整体设计](../superpowers/specs/2026-11-11-animation-and-multi-weapon-design.md)的发布与播放模块已接入七枪主游戏，由关卡作用域加载，每个视觉实例拥有独立 AnimationPlayer。主页面通过装备事实驱动视模；专用预览页仍用于资产采样验收。Classic 默认 AG、Phantom 默认 Tactiplay，其余枪型采用明确标注的临时参考玩法。Classic 的精简网格与 336 图集见[裁图、UV 与发布工作流](gun-only-uv-workflow.md)。固定瞄准和控件见[武器玩法](gameplay.md)，声音及独立 cue 时钟见[运行时音频](audio.md)。

## 发布结果与来源

| 发布包 | 制作源 | 片段 / 轨道 / STEP 轨道 | 蒙皮网格 |
| --- | --- | --- | --- |
| `public/weapons/classic/v1/` | `Classic_Smite_Animated.blend` | 31 / 1116 / 1 | 4 |
| `public/weapons/classic/v2/` | 复用 v1 模型，增加已核验的 Sakura | 31 / 1116 / 1 | 4 |
| `public/weapons/classic/v3/` | v2 模型统一手臂 UV 与 32×32 贴图 | 31 / 1116 / 1 | 4 |
| `public/weapons/classic/v4/`（当前） | 用户精简后的枪身／弹匣、336 图集；AG / Smite / Sakura | 31 / 1116 / 1 | 4 |
| `public/weapons/phantom/v1/` | `Phantom_Tactiplay_Animated.blend` | 30 / 1620 / 8 | 5 |
| `public/weapons/phantom/v2/` | v1 模型统一手臂 UV 与 32×32 贴图 | 30 / 1620 / 8 | 5 |
| `public/weapons/phantom/v3/`（当前） | 原样复用 v2 模型，使用制作源中的 Tactiplay / Smite / Rush / Prism 四款贴图 | 30 / 1620 / 8 | 5 |
| `public/weapons/ghost/v1/`（当前） | 当前 Ghost 作者源，Freehand / Recon / Ego / Spitfire，共享 32×32 手臂；公开参考临时玩法 | 30 / 1080 / 4 | 4 |
| `public/weapons/vandal/v1/`（当前） | 当前 edge_fixed 六款狂徒；后台无损转换实际手臂，共享 32×32 图；公开参考临时玩法 | 30 / 1710 / 4 | 5 |
| `public/weapons/sheriff/v1/`（当前） | Smite / Sakura / Convex，保留快速装填器、共享 32×32 手臂；公开参考临时玩法 | 30 / 2700 / 22 | 4 |
| `public/weapons/judge/v1/`（当前） | Smite / Rush，实际场景标准手臂、稀疏弹药显示；公开参考临时玩法 | 33 / 1485 / 2 | 4 |
| `public/weapons/odin/v1/`（当前） | Smite / Prime / BlastX，后台无损转换实际 `.008` 手臂、稀疏弹链窗口；公开参考临时玩法 | 33 / 2475 / 15 | 4 |

发布器使用 `tools/weapons/recipes.mjs` 显式指定源文件、场景、网格、动画对象、皮肤 PNG、角色与挂点。后台 Blender 打开当前制作源导出，不保存源 `.blend`；源 SHA256 前后必须一致。原始资源包提供动作元数据和对照依据，不用旧 GLB 替代当前美术源。

Ghost／Vandal／Sheriff／Judge／Odin 在原始 runtime 缺失时，采用用户授权的独立固定作者来源配方与公开参考临时玩法，不冒充恢复了原数据。Vandal 的多枪场景、动作别名和实际手臂适配见[狂徒接入](vandal-integration.md)；Original 保持 256×256，另外五皮肤为 2048×2048。Sheriff 从自身 `80_ThreeJS_Export` 直接导出，三款为 2048×2048，无需手臂转换，见[正义接入](sheriff-integration.md)。Judge／Odin 保留五张 2048×2048 图及每枪 33 动作；固定配方、实际对象和控制阈值归一化见[判官／奥丁接入](judge-odin-integration.md)。

每包包含 model.glb、manifest.json、skins 下的皮肤定义，以及 source-audit.json、validation.json。Classic v2 使用内容哈希 PNG，包含 smite / sakura；它的 GLB 与 v1 字节相同。Classic v3 和 Phantom v2 是手臂专用迁移，保留原枪械几何及动作。当前 Classic v4 则从新的作者快照导入精简网格与 336 UV，校验 Rest 骨架及 31 个动作曲线后使用标准导出骨架和手臂；Sakura 的旧图集也按同一布局裁剪。既有旧版本的本地外观予以保留。manifest 描述模型哈希、骨架/几何 UV/动作集兼容签名、语义动作、材质角色、挂点与坐标约定；运行时完全不访问 skin_work_folder。

导出保留 camera、views 等辅助动画，以及 STEP 缩放/可见性轨道。GLB 统一使用 Y-up、-Z forward、米制；`manifest.view.mountOffset` 写到 visualRoot 外的 anchor，不再额外缩放。武器、左臂、右臂材质角色分开，皮肤只替换 weapon 角色。

发布和复核命令见 [tools 说明](../../tools/README.md)。`node tools/weapons/publish.mjs --verify-only` 可独立校验已有包；重新导出需要本地 Blender 和 glTF Validator。既有版本要求所有文件字节一致，否则拒绝覆盖；更改内容应升级配方中的 assetVersion，同时更新 WeaponDefinition。

兼容皮肤发布使用 `tools/weapons/publish-skins.mjs`：它校验原包和只读 Blender 审计，复用原 GLB，保留当前默认外观，向新版本发布额外皮肤；重复发布必须字节一致。历史 `classic-v2.json` 的审计绑定旧制作源，手臂统一后不能直接用当前 `.blend` 重跑；应以新版本及新审计为基础发布。需要重新审计时运行 tools 中的 `audit_skin_blender.py`，不保存 `.blend`。官方 glTF Validator 已作为开发依赖安装，不再要求另一台机器上的模块路径。

九枪制作源、左右手对应 UV、32×32 标准贴图和新包的发布依据见[手臂 UV 与贴图规范](arm-uv-contract.md)。导出前和发布验证都会检查契约；游戏内兼容武器共用同一个手臂纹理对象。

### Phantom 四款皮肤 · 2026-11-14

`phantom/v3` 使用预览图同款的四张 2048×2048 RGBA PNG，像素及文件字节与制作工程内嵌图片、便携交付包一致，未裁图或重采样。默认仍为 Tactiplay，K 按 Tactiplay → Smite → Rush → Prism 循环。

旧 v2 包名为 Tactiplay 的贴图实际是 256×256 原皮。新配方以 `replaceExisting: true` 明确授权在新版本中换成紫绿 Tactiplay，旧包保持不变。配方为 `tools/weapons/skin-releases/phantom-v3.json`，四份来源审计与发布包一同保留。复现命令为 `node tools/weapons/publish-skins.mjs tools/weapons/skin-releases/phantom-v3.json`。

模型与 v2 逐字节相同，UV、骨架、手臂、30 个动作及玩法参数不变。完整发布检查为 glTF Validator 零 error / 零 warning；执行了幻影单枪四款画面检查和相关皮肤发布测试，没有运行双枪玩法、音频、房间或全量回归。Tactiplay 纠正后仅补查该款画面，未重复检查其余三款。报告和 PNG 导出位于 `D:/opencode-temp/opencode/phantom-four-skins-20261114-9f6c2e/`。

## 加载与实例所有权

`WeaponAssets` 位于 `src/game/weapons/assets/weapon-assets.js`，通过 game/weapons/index.js 导出。它接收现有 ResourceManager，不创建另一套 GLTFLoader。

```js
const assets = new WeaponAssets({ resources, scopeId: 'range-weapons', signal: levelAbortSignal })
const handle = await assets.load({ weaponId: 'classic', assetVersion: 'v4', skinId: 'ag' })
// 到 motion 阶段确认票据有效且 staged 槽可用后，再同步实例化。
const visual = assets.instantiate(handle)
visual.player.play('idle')
// 外部适配者按共享表现时间的增量推进：
const events = visual.player.advance(presentationDelta)
// 离手并完成历史表现交接后释放独有实例；关卡结束释放整个作用域。
visual.dispose()
assets.dispose()
```

`assets.applySkin(visual, compatibleHandle)` 同步、原子地替换该实例武器和镜体的皮肤材质绑定，保留材质对象、骨架与播放器。句柄和实例必须属于同一存活作用域及同一模型版本。皮肤仅能绑定枪身和镜体材质。PlayerWeapons 的准备票据与 SkinChanged 事实决定实际调用时刻。

`load()` 只预热模板和皮肤，返回冻结的 AssetReady 句柄，未创建模型或 Mixer。`instantiate()` 同步创建 detached root 和播放器，并验证实际加载节点的轨道绑定。缺少必需动作、材质、节点或皮肤签名不匹配都会拒绝准备。

每个实例独有节点、Skeleton、材质副本和 Mixer；geometry、只读轨道及纹理由作用域共享。实例 dispose 先清播放器，再移除根节点并释放 Skeleton/材质；作用域 dispose 先释放全部实例，再卸载共享资源。重复释放安全，某个释放步骤抛错也会继续清理其他资源。

`load(request, { signal })` 的请求取消只结束该等待者，不中止共享下载。底层加载只绑定关卡信号；失效请求的成功结果可成为模板缓存，但不会自行挂模型。加载失败允许重试，已成功子资源保留。外来、伪造或已关闭作用域的句柄不能实例化。

epoch/requestId 的裁定由 EquipmentController 完成；WeaponViewModel 管理 active/staged 两个槽位及已接受事务的保留状态。Promise 只预热，motion 才实例化并投递 prepared，下一固定步裁定装备。逻辑提交后旧模型仍可显示到公共表现时间 P 到达交接点；释放旧实例后才腾出下一目标的 staged 槽。当前 loader 在运行时校验 GLB 哈希；JSON 和 PNG 的完整性在发布验证阶段检查，运行时尚未逐文件校验其哈希。

### 皮肤自发光

- 枪身优先使用皮肤的 `emissiveMap`，只提供 `map` 时共用这张底色图。发光颜色为白色，强度默认 `0.4`。只有提供了独立发光图，皮肤才能用 `emissiveIntensity` 覆盖默认值。
- 镜体沿用源材质的发光通道，皮肤可用独立发光图覆盖。移除镜体覆盖时恢复源材质的底色、发光图、发光颜色和强度。
- 底色图和独立发光图都按 sRGB、最近邻、无 mipmap 加载。两张图准备完成后一起切换，下载失败时当前皮肤继续显示。

## function/animation 的接口

`AnimationPlayer` 与 `ClipLibrary` 从 `src/engine/runtime/function/animation/index.js` 导出。它们只认识传入的动作角色，不认识枪名、弹药、输入或资源下载。

| 调用 | 行为 |
| --- | --- |
| `new AnimationPlayer({ root, clips, actions, controls? })` | 构造时验证 clip、节点、属性绑定及稀疏白名单；不静默跳过失效轨道 |
| `play(role, { restart, fade, rate })` | 返回 playbackId；同一当前角色默认不重播，restart 显式创建新代次 |
| `advance(delta)` | 接受非负表现秒，采样并返回只读 marker / finished 事件；不推进玩法 |
| `setControls(samples)` / `clearControls()` | 原子替换 `role -> 局部秒` 的稀疏覆盖集合；在主 Mixer 后覆盖，不创建动作或发事件 |
| `snapshot()` | 当前动作、局部时间、混合层及权重、Mixer action/binding 数量 |
| `stop()` | 停止全部层、清事件游标、恢复绑定前姿态；累计时间不倒退 |
| `dispose()` | 停止并 uncache Mixer；不销毁模型、共享几何或贴图；之后不能继续播放 |

actions 是 `role -> { clip, loop?, rate?, fade?, markers? }`。rate 默认 1，fade 默认 0.1 秒，loop 默认 false。marker 包含唯一 id 和片段局部 time，可附 type/payload；事件携带 role、playbackId、播放器累计 at 和 marker.cycle。循环起点及终点的 marker 各发一次，同刻 marker 先于 finished。一次性动作完成后保持末姿态，由游戏适配者决定接待机或其他动作。

内部 AnimationStateMachine 管理播放代次、局部时间和混合权重；Mixer 仅采样。被打断动作可继续淡出，但不再发 marker/finished；再次打断从当前所有权重继续过渡。同一片段重播拥有独立 Action 身份，保留旧层姿态，轨道数组仍共享。权重低于 1e-5 的旧层会退出并归一剩余权重，防止持续连射无限累积采样成本。

时间采用补偿累计，并统一处理循环、marker、结束及淡入淡出边界；不同帧拆分不会在精确边界重复或漏发。STEP 沿用原插值器，不重采样成线性。当前支持标准 GLTF 的直接节点属性和索引属性；复合 `.bones[...]` 绑定会明确拒绝。[稀疏控制轨道](runtime-controls.md)已通过源曲线测试，并随 Judge/Odin 完整发布接入主游戏；Blend Tree、IK 仍未交付。

AnimationPlayer 返回的声音 marker 仍只是数据事件，不能自行发声。普通 draw/fire/reload 的零时刻重复 cue 在发布时移除，独立 cue 保留；主游戏由 WeaponAudio 的独立已提交动作游标调度，不等待延迟 Mixer 回调，也不重复播放。WeaponViewModel 已按 `P = max(0, C - h + alpha * h)` 分段推进：先推进旧动作到事件 at，执行该事件，再推进剩余区间。装备、换弹、检视与射击事实选择语义动作；同片段射击使用显式 restart。片段时长不决定装备、补弹或可开火时间，适配者按玩法动作期限配置速度或结束恢复段。

开火片段自然结束时也按精确终点拆段，接待机后推进本帧剩余时间，避免低帧率丢失 idle 相位。ADS 变更使用固定步生成的私有表现时间点，按 P 消费后切换 idle/aim，不以首次观察到状态的渲染帧计时；它不占用装备事件的序号。30/60/144 FPS 与大步追帧的回归比较同一 P 的动作、混合权重和实际轨道采样。

AimChanged 会打断 fire / fireAds 的表现尾段并淡入 idle / aim，避免约 1 秒的开火片段阻塞 Phantom 的 0.15 秒 ADS；该转接不改变已接受的射击事实、冷却或后坐力。

## 主游戏的独立视模渲染

RenderSystem 拥有稳定的 `viewmodel` layer，包括独立 Scene、PerspectiveCamera 和 ViewModelPass；WeaponViewModel 只拥有挂到 layer.scene 的实例与 anchor。视模不挂世界相机，也不依赖世界相机是否属于 Scene 或 Camera/Mesh 的装配顺序。根结构为 `anchor → visualRoot`：anchor 使用 manifest.view.mountOffset，Mixer 只改 visualRoot 子树。

视模使用独立深度、透明背景和 HDR 颜色目标，相机 near/far 为 0.005/10 米，基础垂直 FOV 为 70°。窗口 resize 更新宽高比，ADS 的 FOV 来自同一 P 的 AimState 采样。世界碰撞和深度不会把贴墙枪模切掉；命中射线仍在固定玩法中独立裁定。

视模实例的 `SkinnedMesh` 禁用 CPU 视锥剔除：Three.js 会缓存首次绘制时的蒙皮包围球，而掏枪或切枪初始姿态可能在镜头外，后续动画不会自动重算该球，导致回到待机后手臂或枪体被错误剔除。限制只作用于第一人称实例，不修改共享模板或世界物体；GPU 仍按相机裁剪，动画、UV 和贴图无需改动。

管线顺序为：世界 HDR（含世界 AO）+ 视模 HDR → 预乘 alpha 合成 → 共同 tone mapping → SMAA → sRGB → 显示 LUT。视模共享可见的世界灯光、LightProbeGrid 和天空环境，不套用世界 AO，也不参与世界阴影或探针捕获。pass 在更新后恢复 renderer 的清屏、目标、MRT 等状态；管线重建释放旧 pass，视觉对象继续归游戏持有。

进入 Editor 同步隐藏视模并撤销旧事件；保留对象按逻辑 activeId 选择，返回玩家后用新票据重新掏枪。暂停冻结表现游标，重生清除旧队列和实例。HUD 的枪名、弹药和命中反馈也读取已展示事实，不能领先模型交接。

### 武器与场景的材质统一

原视模只有强度 3 的白色 AmbientLight，导入材质的 roughness/metalness 全部为 1/0；枪面缺少方向性明暗和反射，移动或转身也不会改变受光。现在 ViewModelPass 将视模 Scene 与独立相机同步到世界相机的完整世界变换，游戏挂点仍保留原有局部坐标。因而顶灯方向、环境反射及三个探针体积的世界坐标采样都与房间一致，不改变持枪位置、ADS FOV 或独立深度。

世界灯光通过独立 Lighting/LightsNode 借用，不重设 parent，不复制或释放世界灯光、探针 atlas 和天空纹理；灯光可见性、layers 和移除会在下一次绘制同步。保留 `viewmodelLightIntensity` 作为弱暗部补光，默认从 3 降到 **0.18**，可在右侧「武器 · 场景光照」中调节和重置。

`assets/weapon-materials.js` 按 weapon / scope / armsLeft / armsRight 配置材质。枪身的金属度和粗糙度为 `1`，启用平直着色并清除法线贴图。Physical 材质保留源资产的清漆强度，清漆粗糙度为 `0.18`。枪身材质借用关卡共享的室内 PMREM，倍率为 `0.3`，资源缺失时由视模场景提供天空环境。[手臂采样与纹理所有权](arm-uv-contract.md)

## 浏览器预览与验证

```powershell
npm run dev
node tools/check-weapons-browser.mjs http://localhost:5173/weapon-preview.html
node tools/check-weapon-gameplay-browser.mjs http://localhost:5173/
node tools/check-weapon-lighting-browser.mjs http://localhost:5173/
```

浏览器手动打开 `/weapon-preview.html` 可选择七枪和待机、掏枪、开火、两种换弹、检视。该页面是独立资源验收工具，没有修改练枪房启动流程。完整检查默认遍历七枪所有已映射角色的多个采样点、双实例骨架/材质隔离、实例释放后另一实例仍能渲染及作用域关闭后的缓存清理，保留 Classic/Phantom 四张截图和 report.json。日常只用 `--quick --weapon <id>` 检查目标枪与三张截图，不默认跑全套。输出位置默认 `D:/opencode-temp/opencode/weapons-browser`，可用 WEAPON_TEST_OUTPUT 修改。

Node 专项测试为 animation.test.mjs、weapon-assets.test.mjs、weapon-publication.test.mjs。初批 Classic／Phantom 发布对照每枪九组 Blender/Three.js 变形包围盒，最大误差分别约 3.31e-7、4.86e-7 米；两包 glTF Validator 均为零 error / 零 warning。连续 500 次射击重播与 300 个 60 Hz 动画步覆盖混合层退场和浮点边界回归。后续各枪结果见对应接入文档；Judge/Odin 新包同样完整验证，当前相关回归有一项既有材质断言失败，不能把历史通过结果当作本次全绿。

主游戏检查使用 `check-weapon-gameplay-browser.mjs`，与预览检查分开运行；输出默认在 `D:/opencode-temp/opencode/weapon-gameplay-browser`，可用 `WEAPON_GAME_TEST_OUTPUT` 修改。其结果以当次 report.json 为准；该工具覆盖输入、装备事件、固定瞄准与视模接线，并隔离左右手、读取视模 HDR alpha，检查 Classic → Phantom → Classic 重复切换后的实际手臂像素和共享贴图。声音实际解码、输出波形和生命周期另用 `check-weapon-audio-browser.mjs` 验证。

`check-weapon-lighting-browser.mjs` 在练枪房主页面检查默认材质、全局灯光开关和 HDR 采样，验证底色图与独立发光图切换。脚本保存 AG、Smite、Sakura 和 Tactiplay 的截图。默认输出 `D:/opencode-temp/opencode/weapon-lighting-browser`，可用 `WEAPON_LIGHTING_TEST_OUTPUT` 修改。脚本需要开发服务器提供 GPU 测试模块。

## 后续阶段的本地输入缺口

Ghost／Vandal／Sheriff／Judge／Odin 后续已经用户授权改用「当前 Blender 作者数据 + 公开参考临时玩法」独立来源契约发布，并不表示找回了原始 runtime；具体来源与取舍见各接入文档。剩余 Operator／Outlaw 不自动继承这项授权。

2026-11-12 已确认九枪制作源存在于 skin_work_folder，Judge 的独立动作场景与 Odin/Vandal 的 E08/E09/E04 动作场景也能只读打开；不需要重新生成美术。仓库与便携交付目录中没有原始九枪 manifest/runtime JSON；设计记录中的 `D:/Projects/vandal-roundtrip/valorant-first-person-pack` 和发布器默认的相邻源包目录均不存在。制作源仅保留 `asset_manifest=//manifest.json` 引用和动作时长等元数据，不能替代原始 runtime_control、control_bones、recoil、动作声音映射及玩法时刻。

要按原阶段 5 契约恢复原始 runtime，仍需要完整 valorant-first-person-pack 的实际目录（各枪 manifest.json 及引用的玩法数据）。不能从动画时长猜射速／补弹时刻，也不能拿旧便携 GLB 替代当前制作源。已发布五枪使用独立固定来源、公开参考与显式项目策略绕开缺口，没有声称恢复原始数据；Judge/Odin 的显示窗口与手动控制边界见[稀疏控制](runtime-controls.md)。
