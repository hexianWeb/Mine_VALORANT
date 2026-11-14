# 稀疏控制轨道与弹药显示

AnimationPlayer 已支持**主 Mixer 之后的显式属性覆盖**；WeaponAssets 负责 manifest 预检和实例化，WeaponViewModel 在表现事实到达时选择弹药显示档位。没有把整段 `ammo_display` 作为全权重动作叠加，也没有为控制片段增加第二个时钟。

初次交付完成阶段 5 的运行时与源曲线数值验收；**2026-11-14 Judge/Odin 已分别以 v1 完整发布并接入主游戏**，使用用户授权的公开参考临时玩法，见[判官／奥丁接入](judge-odin-integration.md)。原始九枪 manifest/runtime 仍缺失，不能从动作名或时长猜射速、容量、补弹时刻或热量规则。本次保留既有枪械纹理像素，没有生成新皮肤或保存制作源。

## 接口与顺序

```js
const player = new AnimationPlayer({
  root,
  clips,
  actions,
  controls: manifest.runtimeControls,
})

// 全量替换当前覆盖集合；未包含的控制被清除。
player.setControls({ ammoDisplay: sampleTime })
player.clearControls()
```

- `controls` 为 `role -> { clip, tracks }`。tracks 是实际 Three.js 轨道名的非空白名单，精确选择节点属性或索引属性，不是“所有变化骨骼”。重复/缺失轨道、维度不符、非数值属性、复合 `.bones[...]` 路径会拒绝。
- `setControls` 的值为显式片段局部秒数，范围 `[0, clip.duration]`；不循环、不自动 clamp、不推进时间、不重启动作、不发 marker/finished。STEP、LINEAR 及 GLTF CUBICSPLINE 沿用源插值器。
- 整个请求先解析和采样，再原子提交。非有限时间/结果、未知控制及同时覆盖同一实际属性的冲突均拒绝，旧姿态和样本集合不变。UUID/节点名别名、整属性与分量的冲突也会识别；不同分量可以独立覆盖。
- 每个实例拥有自己的 PropertyBinding、插值器、结果缓冲和底层姿态缓存；源 clips/轨道数组仍共享。
- 每次采样先恢复上一次覆盖前的底层值，**然后才停止/创建主 Action、调用 Mixer.update(0)**，最后重新捕获主姿态并覆盖白名单属性。这既避免覆盖值被 Mixer 保存成 original，也处理 Mixer 跳过“与缓存相同输出”的情况。
- `clearControls` 恢复当前主动作姿态，不是无条件退回绑定姿态。`stop`/`dispose` 清除覆盖和缓存，再按原有主动作生命周期恢复姿态。
- `snapshot().stats` 仍只有主 Mixer 的 `{ actions, bindings }`；独立的 `snapshot().controls` 返回 `{ samples, bindings }`，不把控制伪装成 Mixer Action。

## Manifest 与事实接线

新增可选字段，无控制的 Classic/Phantom 发布包不需要修改：

```json
{
  "runtimeControls": {
    "ammoDisplay": {
      "clip": "ammo_display",
      "tracks": ["group_8.scale", "group_7.scale", "group_6.scale", "group_5.scale", "group_4.scale", "group_3.scale", "group_2.scale", "group_1.scale"]
    }
  },
  "ammoDisplay": {
    "control": "ammoDisplay",
    "levels": [
      { "minimum": 0, "time": 0.800000011920929 },
      { "minimum": 1, "time": 0.699999988079071 },
      { "minimum": 2, "time": 0.6000000238418579 },
      { "minimum": 3, "time": 0.4999999701976776 },
      { "minimum": 4, "time": 0.3999999761581421 },
      { "minimum": 5, "time": 0.29999998211860657 },
      { "minimum": 6, "time": 0.20000000298023224 },
      { "minimum": 7, "time": 0.10000000149011612 },
      { "minimum": 8, "time": 0 }
    ]
  }
}
```

levels 的 minimum 必须从 0 开始、严格递增且为非负安全整数；time 必须处于实际控制 clip 的范围内。选取 `minimum <= 已展示 magazine` 的最高档。预检发生在模板阶段，失败不会创建视觉实例或下载皮肤贴图。

WeaponViewModel 只使用到达 `P` 的事件 payload.weapon，不读取更新的逻辑背包来改显示。射击在 ShotFired 到达时减档；换弹在 AmmoCommitted 到达时补档，ReloadStarted、动画结束或迟到加载都不能补弹。控制样本在后续主动作采样、淡入淡出中持续保留；Editor/suspend 的 stop 清除它们，resume 根据新 epoch 的已提交武器重建。HUD 与模型共用已展示事实。

上面的 Odin v1 示例和两份数值夹具使用明确的**近供弹端可见窗口**策略：可见数为 `min(magazine, 指示数量)`，Judge 为 5、Odin 为 8，多于窗口的弹药仍显示完整窗口。这是本地显示策略，不是从制作源重建出的原始容量或“每发都可见”的承诺；其他表现策略只需改 levels。当前 Judge 5 发／Odin 100 发来自独立公开参考记录，不冒充原始 runtime 映射。

## 制作源审计

两份源场景均为 60 FPS，frame 1 对应局部 0 秒。隐藏缩放约为 `9.999999747378752e-6`。

| 源与控制 | 显式属性 | 原始行为 |
| --- | --- | --- |
| Judge / ammo_display，4 s，150 条 F-curves | bullet4…bullet0.scale，5 个属性 | LINEAR；依次在 frames 11、26、41、56、71 完全隐藏；每次淡出占 5 帧，不能当成 STEP |
| Judge / static_bolt_caught，0.05 s，150 条 F-curves | bullets.scale | 有意义的**恒定**隐藏姿态；父骨缩放影响 5 个弹药指示，并非自动识别出的枪机移动 |
| Odin / ammo_display，1 s，250 条 F-curves | group_8…group_1.scale，8 个属性 | CONSTANT/STEP；依次在 frames 7、13、19、25、31、37、43、49 隐藏 |
| Odin / barrel，2 s，250 条 F-curves | red_1.scale、red_2.scale | 实际不是枪管旋转；red_2 在 frames 55→58、red_1 在 88→91 线性隐藏，中间有 2/3、1/3 缩放 |

Judge 五个 bullet 各有 32 个 Weapon_Magazine 顶点；Odin group 本身没有直接权重，但其 bullet_N/chain_N 子骨有实际弹药/弹链权重。red_1/red_2 各影响当前 Weapon_Body.008 的 432 个顶点。审计没有把“父骨没有直接权重”误判成无效控制。

Judge 源为 `skin_work_folder/judge_skin_work/Judge_Smite_Animated.blend` / `80_ThreeJS_Export`。历史数值夹具的 Odin 源为 `skin_work_folder/odin_skin_work/Odin_Smite.blend`；当前发布从同目录 `three_odin_skins/Odin_Smite.blend` 重新审计，实际场景仍为 `E09_ODIN_Actions`，主骨架为 root.006，Action slot 显示名仍为 root，动作前缀为 `odin / `。barrelIndicators 与 boltCaught 当前只接受显式采样输入；没有虚构热量／旋转速度或自动空仓规则。

STEP 边界必须使用**实际导出输入键值**。例如 Float32 的 0.1 是 0.10000000149011612，在局部时间 0.1 仍可能处于前一档。夹具阈值按其时间编码量化；不能在通用播放器中用误差吸附破坏 STEP 的精确语义。当前 `publish-authored.mjs` 的 `authoredControlProfile()` 已从最终归一化 GLB 输入键确定对应样本；上例保留最终值，不能从历史夹具机械复制。发布器还验证控制声明、实际轨道绑定、档位范围和有限采样，相关源码参与预览缓存指纹。

## 复现与验收范围

```powershell
& 'F:\Blender5.3\blender.exe' --background --factory-startup --disable-autoexec --python-exit-code 1 --python tools/weapons/audit_controls.py -- --output D:/opencode-temp/opencode/weapon-controls/reproduced
npm test
```

脚本只读取制作源和权重；检查源文件前后 SHA256 一致，输出数值 JSON，不导出模型、材质或图像。保存的夹具在 `tests/fixtures/weapon-controls/`；初次交付用 Blender 5.2.3 LTS 逐字节复现成功，目录名称 Blender5.3 不代表实际版本。该命令复现历史夹具，不替代当前发布来源审计。

夹具保留选定 scale 通道、真实无关 righthand.scale、相关层级/权重证据及源哈希，仅移除等值平台内部的冗余键。均匀 XYZ 缩放不依赖坐标基转换；测试骨架不重建整枪 rest pose，不能代替完整 GLB 的变形包围盒或视觉发布验收。

控制模块初次交付时全量 **352/352** 测试通过，新增 35 项（含子测试）覆盖：源 STEP 边界、线性/恒定控制、无关轨道排除、乱序/重复绝对采样、30/60/144 FPS 和批量追帧、实例隔离、缓存姿态恢复、stop/dispose、原子失败、真实 GLTF CUBICSPLINE、manifest 预检、补弹事实、取消与 suspend/resume。这是历史结果，不是当前七枪版本的全量验收。

该阶段修改文件 ESLint 与生产构建通过，Classic/Phantom 生产版玩法与音频浏览器回归也通过；历史报告分别在 `D:/opencode-temp/opencode/weapon-controls/gameplay-browser/report.json` 与 `audio-browser/report.json`，不是 Judge/Odin 整枪验收。

2026-11-14 的两枪完整发布、实际 GLB 各档位与主游戏检查另行通过：Judge 5→0，Odin 100 发饱和窗口及末端 8→0，换弹均不提前补满；两枪每个手动控制 profile 保留但无自动驱动。`tests/judge-odin-integration.test.mjs` 还覆盖错误控制声明在发布时拒绝。完整报告、相关回归中既有的一项材质断言失败及未跑范围见[本次验收](judge-odin-integration.md#本次验收与耗时)；没有把历史 352 项冒充本次全绿。
