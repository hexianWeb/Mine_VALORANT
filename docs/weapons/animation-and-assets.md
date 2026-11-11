# 武器资源发布与动画播放

[整体设计](../superpowers/specs/2026-11-11-animation-and-multi-weapon-design.md)的发布与播放模块已接入主游戏：Classic Smite、Phantom Tactiplay 由关卡作用域加载，每个视觉实例拥有独立 AnimationPlayer。主页面通过装备事实驱动双枪视模；专用预览页仍用于资产采样验收。固定瞄准和控件见[武器玩法](gameplay.md)，运行时音频尚未接入。

## 发布结果与来源

| 发布包 | 制作源 | 片段 / 轨道 / STEP 轨道 | 蒙皮网格 |
| --- | --- | --- | --- |
| `public/weapons/classic/v1/` | `Classic_Smite_Animated.blend` | 31 / 1116 / 1 | 4 |
| `public/weapons/phantom/v1/` | `Phantom_Tactiplay_Animated.blend` | 30 / 1620 / 8 | 5 |

发布器使用 `tools/weapons/recipes.mjs` 显式指定源文件、场景、网格、动画对象、皮肤 PNG、角色与挂点。后台 Blender 打开当前制作源导出，不保存源 `.blend`；源 SHA256 前后必须一致。原始资源包提供动作元数据和对照依据，不用旧 GLB 替代当前美术源。

每包包含 model.glb、manifest.json、skins 下的皮肤定义、按内容哈希命名的 PNG，以及 source-audit.json、validation.json。当前两个包共约 2.60 MiB。manifest 描述模型哈希、骨架/几何 UV/动作集兼容签名、语义动作、材质角色、挂点与坐标约定；运行时完全不访问 skin_work_folder。

导出保留 camera、views 等辅助动画，以及 STEP 缩放/可见性轨道。GLB 统一使用 Y-up、-Z forward、米制；`manifest.view.mountOffset` 写到 visualRoot 外的 anchor，不再额外缩放。武器、左臂、右臂材质角色分开，皮肤只替换 weapon 角色。

发布和复核命令见 [tools 说明](../../tools/README.md)。`node tools/weapons/publish.mjs --verify-only` 可独立校验已有包；重新导出需要本地 Blender 和 glTF Validator。既有版本要求所有文件字节一致，否则拒绝覆盖；更改内容应升级配方中的 assetVersion，同时更新 WeaponDefinition。

## 加载与实例所有权

`WeaponAssets` 位于 `src/game/weapons/assets/weapon-assets.js`，通过 game/weapons/index.js 导出。它接收现有 ResourceManager，不创建另一套 GLTFLoader。

```js
const assets = new WeaponAssets({ resources, scopeId: 'range-weapons', signal: levelAbortSignal })
const handle = await assets.load({ weaponId: 'classic', assetVersion: 'v1', skinId: 'smite' })
// 到 motion 阶段确认票据有效且 staged 槽可用后，再同步实例化。
const visual = assets.instantiate(handle)
visual.player.play('idle')
// 外部适配者按共享表现时间的增量推进：
const events = visual.player.advance(presentationDelta)
// 离手并完成历史表现交接后释放独有实例；关卡结束释放整个作用域。
visual.dispose()
assets.dispose()
```

`load()` 只预热模板和皮肤，返回冻结的 AssetReady 句柄，未创建模型或 Mixer。`instantiate()` 同步创建 detached root 和播放器，并验证实际加载节点的轨道绑定。缺少必需动作、材质、节点或皮肤签名不匹配都会拒绝准备。

每个实例独有节点、Skeleton、材质副本和 Mixer；geometry、只读轨道及纹理由作用域共享。实例 dispose 先清播放器，再移除根节点并释放 Skeleton/材质；作用域 dispose 先释放全部实例，再卸载共享资源。重复释放安全，某个释放步骤抛错也会继续清理其他资源。

`load(request, { signal })` 的请求取消只结束该等待者，不中止共享下载。底层加载只绑定关卡信号；失效请求的成功结果可成为模板缓存，但不会自行挂模型。加载失败允许重试，已成功子资源保留。外来、伪造或已关闭作用域的句柄不能实例化。

epoch/requestId 的裁定由 EquipmentController 完成；WeaponViewModel 管理 active/staged 两个槽位及已接受事务的保留状态。Promise 只预热，motion 才实例化并投递 prepared，下一固定步裁定装备。逻辑提交后旧模型仍可显示到公共表现时间 P 到达交接点；释放旧实例后才腾出下一目标的 staged 槽。当前 loader 在运行时校验 GLB 哈希；JSON 和 PNG 的完整性在发布验证阶段检查，运行时尚未逐文件校验其哈希。

## function/animation 的接口

`AnimationPlayer` 与 `ClipLibrary` 从 `src/engine/runtime/function/animation/index.js` 导出。它们只认识传入的动作角色，不认识枪名、弹药、输入或资源下载。

| 调用 | 行为 |
| --- | --- |
| `new AnimationPlayer({ root, clips, actions })` | 构造时验证 clip、节点和属性绑定；不静默跳过失效轨道 |
| `play(role, { restart, fade, rate })` | 返回 playbackId；同一当前角色默认不重播，restart 显式创建新代次 |
| `advance(delta)` | 接受非负表现秒，采样并返回只读 marker / finished 事件；不推进玩法 |
| `snapshot()` | 当前动作、局部时间、混合层及权重、Mixer action/binding 数量 |
| `stop()` | 停止全部层、清事件游标、恢复绑定前姿态；累计时间不倒退 |
| `dispose()` | 停止并 uncache Mixer；不销毁模型、共享几何或贴图；之后不能继续播放 |

actions 是 `role -> { clip, loop?, rate?, fade?, markers? }`。rate 默认 1，fade 默认 0.1 秒，loop 默认 false。marker 包含唯一 id 和片段局部 time，可附 type/payload；事件携带 role、playbackId、播放器累计 at 和 marker.cycle。循环起点及终点的 marker 各发一次，同刻 marker 先于 finished。一次性动作完成后保持末姿态，由游戏适配者决定接待机或其他动作。

内部 AnimationStateMachine 管理播放代次、局部时间和混合权重；Mixer 仅采样。被打断动作可继续淡出，但不再发 marker/finished；再次打断从当前所有权重继续过渡。同一片段重播拥有独立 Action 身份，保留旧层姿态，轨道数组仍共享。权重低于 1e-5 的旧层会退出并归一剩余权重，防止持续连射无限累积采样成本。

时间采用补偿累计，并统一处理循环、marker、结束及淡入淡出边界；不同帧拆分不会在精确边界重复或漏发。STEP 沿用原插值器，不重采样成线性。当前支持标准 GLTF 的直接节点属性和索引属性；复合 `.bones[...]` 绑定会明确拒绝。Judge/Odin 的稀疏控制轨道覆盖、Blend Tree、IK 等尚未实现。

声音 marker 现在只是数据事件。普通 draw/fire/reload 的零时刻重复 cue 在发布时移除，独立 cue 保留；当前没有创建 AudioContext 或播放声音。WeaponViewModel 已按 `P = max(0, C - h + alpha * h)` 分段推进：先推进旧动作到事件 at，执行该事件，再推进剩余区间。装备、换弹、检视与射击事实选择语义动作；同片段射击使用显式 restart。片段时长不决定装备、补弹或可开火时间，适配者按玩法动作期限配置速度或结束恢复段。

开火片段自然结束时也按精确终点拆段，接待机后推进本帧剩余时间，避免低帧率丢失 idle 相位。ADS 变更使用固定步生成的私有表现时间点，按 P 消费后切换 idle/aim，不以首次观察到状态的渲染帧计时；它不占用装备事件的序号。30/60/144 FPS 与大步追帧的回归比较同一 P 的动作、混合权重和实际轨道采样。

AimChanged 会打断 fire / fireAds 的表现尾段并淡入 idle / aim，避免约 1 秒的开火片段阻塞 Phantom 的 0.15 秒 ADS；该转接不改变已接受的射击事实、冷却或后坐力。

## 主游戏的独立视模渲染

RenderSystem 拥有稳定的 `viewmodel` layer，包括独立 Scene、PerspectiveCamera 和 ViewModelPass；WeaponViewModel 只拥有挂到 layer.scene 的实例与 anchor。视模不挂世界相机，也不依赖世界相机是否属于 Scene 或 Camera/Mesh 的装配顺序。根结构为 `anchor → visualRoot`：anchor 使用 manifest.view.mountOffset，Mixer 只改 visualRoot 子树。

视模使用独立深度、透明背景和 HDR 颜色目标，相机 near/far 为 0.005/10 米，基础垂直 FOV 为 70°。窗口 resize 更新宽高比，ADS 的 FOV 来自同一 P 的 AimState 采样。世界碰撞和深度不会把贴墙枪模切掉；命中射线仍在固定玩法中独立裁定。

管线顺序为：世界 HDR（含世界 AO）+ 视模 HDR → 预乘 alpha 合成 → 共同 tone mapping → SMAA → sRGB → 显示 LUT。视模使用独立环境光，不套用世界 AO，也不参与世界阴影或探针捕获。pass 在更新后恢复 renderer 的清屏、目标、MRT 等状态；管线重建释放旧 pass，视觉对象继续归游戏持有。

进入 Editor 同步隐藏视模并撤销旧事件；保留对象按逻辑 activeId 选择，返回玩家后用新票据重新掏枪。暂停冻结表现游标，重生清除旧队列和实例。HUD 的枪名、弹药和命中反馈也读取已展示事实，不能领先模型交接。

## 浏览器预览与验证

```powershell
npm run dev
node tools/check-weapons-browser.mjs http://localhost:5173/weapon-preview.html
node tools/check-weapon-gameplay-browser.mjs http://localhost:5173/
```

浏览器手动打开 `/weapon-preview.html` 可选择枪型和待机、掏枪、开火、两种换弹、检视。该页面是独立资源验收工具，没有修改练枪房启动流程。检查脚本使用真实 Chrome、WebGPU、像素解码和 ResourceManager；验证所有已映射角色的多个采样点、双实例骨架/材质隔离、实例释放后另一实例仍能渲染、作用域关闭后的缓存清理，并输出四张截图和 report.json。输出位置默认 `D:/opencode-temp/opencode/weapons-browser`，可用 WEAPON_TEST_OUTPUT 修改。

Node 专项测试为 animation.test.mjs、weapon-assets.test.mjs、weapon-publication.test.mjs。发布还对照每枪九组 Blender/Three.js 变形包围盒，最大误差分别约 3.31e-7、4.86e-7 米；两包 glTF Validator 均为零 error / 零 warning。连续 500 次射击重播与 300 个 60 Hz 动画步覆盖混合层退场和浮点边界回归。

主游戏检查使用 `check-weapon-gameplay-browser.mjs`，与预览检查分开运行；输出默认在 `D:/opencode-temp/opencode/weapon-gameplay-browser`，可用 `WEAPON_GAME_TEST_OUTPUT` 修改。其结果以当次 report.json 为准；该工具覆盖输入、装备事件、固定瞄准与视模接线，不验证尚未实现的音频。
