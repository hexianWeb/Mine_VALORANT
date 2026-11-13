# Blender → Three.js 快速迭代与发布分级

日常制作不再默认执行完整发布验收。以下武器命令服务于现有显式配方管线，并非任意 `.blend` 的通用导出器；房间仍使用专用导出器，按同样的影响范围选择检查。

## 1. 选最小必要路径

| 本次目标 | 默认执行 | 不自动执行 |
| --- | --- | --- |
| 只改 Blender 中的贴图/材质 | 目标备份、图片/Alpha/绑定、局部预览 | GLB 发布、游戏接入、全量测试 |
| 裁图/改 UV | 再检查保留像素、UV 换算、旧效果面的透明像素 | 无关骨架/玩法/房间回归 |
| 看 Three.js 效果 | 导出项目外候选 → 快速资源检查 → 单枪代表动作预览 | 覆盖正式资源、双枪整套玩法与光照 |
| 改几何/权重/骨架/动作 | 候选检查，加有针对性的变形/动作检查 | 将预览结果当正式发布证明 |
| 正式发布/集成交付 | 固定来源、新版本、完整发布检查；按代码影响补回归 | 放宽来源、哈希或 glTF 门槛 |

制作过程中的查询与编辑应批量执行：一次读取目标状态，一次编辑，一次确认结果。避免让模型逐对象、逐动作、逐像素调用工具反复证明同一件事。

## 2. 已有包：不启动 Blender 的快速检查

```powershell
npm run weapon:check -- public/weapons/classic/v4
```

每次都核对当前模型/皮肤/纹理内容哈希、兼容签名、材质和挂点绑定、手臂契约，并实际解码 PNG。模型检查缓存未命中时：检查全部轨道绑定、数值、时长、循环端点和权重，但只采样待机、空仓换弹、检视三种代表动作，以及最多三组已有 Blender 姿态证据；不运行官方 glTF Validator。

输出明确标记 `profile: preview`、`publishable: false`。它既不是完整动作验收，也不是浏览器画面验收。

```powershell
# 忽略模型缓存，重新执行预览检查
npm run weapon:check -- public/weapons/classic/v4 --no-cache

# 独立完整检查：不使用预览缓存；仅接受正式来源的包
npm run weapon:check -- public/weapons/classic/v4 --release

# 耗时报告不得写进资产包
npm run weapon:check -- public/weapons/classic/v4 --report D:/opencode-temp/opencode/weapon-check.json
```

### 缓存边界

- 仅复用**模型检查**，不跳过当前文件哈希、绑定检查或 PNG 解码。
- 同一模型只改外置皮肤时可命中；模型字节改变（包括内嵌图片改变）、rig/UV/action 签名、元数据、权重声明或姿态证据改变均失效。
- 校验器/导出器/手臂契约/材质接口的源码、锁文件、安装的 Three.js 版本及 Node 版本参与缓存指纹。不是只看时间戳或 `.blend` 文件名。
- 默认缓存位于 `D:/opencode-temp/opencode/weapon-validation-cache/`。损坏的 JSON/摘要不采用，检查失败不写成功缓存。
- 正式发布和 `--release` 永远重新完整检查，不消费预览缓存。

## 3. 从 Blender 导出独立候选

先保存希望预览的制作状态；后台进程无法读取前台未保存编辑。配方仍须明确对象、作者骨架源、图集布局和尺寸。不要更改已发布配方原始字节；需要新布局时在 D 盘临时目录写工作配方。

```powershell
node tools/weapons/publish-optimized.mjs tools/weapons/optimized-releases/classic-v4.json `
  --preview --blender F:/Blender5.3/blender.exe `
  --report D:/opencode-temp/opencode/classic-preview-export.json
```

预览模式：

1. 继续固定旧包/元数据来源，但允许制作 `.blend` 和显式 PNG 的当前内容不同于旧发布配方；实际 SHA-256 写入候选来源记录，不修改配方。
2. 仍检查新网格与作者 rest rig、绑定变换、顶点组、完整作者动作曲线、packed PNG、源文件导出前后未变化。保留完整模型和动画，不生成无法替代运行时模型的简化假预览。
3. 旧包和候选使用预览检查，省去完整发布验证和无关浏览器回归。
4. 输出到独立 `candidate-*` 子目录，返回 `directory`、`previewRoot` 和 `previewUrl`。同一版本可反复预览，每次新建候选，不覆盖已有包。
5. manifest 带 `provenance.preview: true`。正式校验拒绝这种候选，也不能把它作为已验证发布基线。不能将它直接复制进 public 或通过改标记“升级”为正式包。

默认候选根为 `D:/opencode-temp/opencode/weapon-previews/`。`--out-root` 可指定其他**项目外**候选根；启动 Vite 前需将 `WEAPON_PREVIEW_ROOT` 设为相同路径。`--preview` 不能与 `--verify-only` 合用。

## 4. 单枪 Three.js 预览

```powershell
npm run dev -- --host 127.0.0.1
```

打开导出结果里的 `previewUrl`，前面加实际开发服务器地址，例如：

```text
http://127.0.0.1:5173/weapon-preview.html?candidate=candidate-xxxxxx&weapon=classic&version=v4&skin=ag
```

沿用现有 WeaponAssets/ResourceManager；不新建另一套模型加载器，不改主游戏配置。候选状态会显示“非发布验收”，且只允许选择当前武器。

需要自动检查和截图时，**只跑这一项**：

```powershell
$env:WEAPON_TEST_OUTPUT = 'D:/opencode-temp/opencode/classic-quick-preview'
node tools/check-weapons-browser.mjs '<上面的完整候选 URL>' --quick --weapon classic
```

只加载指定枪，采样待机、空仓换弹、检视，检查实例隔离和释放，并保存三张截图与耗时。这个预览页不是主房间光照验收；修改反射/灯光公共代码时才加对应专项。

候选资源仅由开发服务器提供给本机 loopback 请求；限制为候选根内的 JSON/GLB/PNG，拒绝路径穿越、跨站请求和指向根外的 junction。没有放开任意磁盘的 Vite `/@fs` 权限；生产构建不提供候选文件服务。

不带 `--quick` 的浏览器命令保留原双枪完整资源回归，用于相关加载器/动画公共代码变化。

## 5. 正式发布保持原门槛

效果确认后，基于实际来源哈希创建**新的发布配方/版本**，运行原发布命令，不带 `--preview`。源文件固定哈希、九组姿态对照、全部动作和 glTF Validator 零 error/零 warning、不覆盖旧版本等规则不变。

发布成功已经完成本次完整资产验证；不立即再跑一次 `--verify-only`。后者用于单独核对磁盘上的已有发布包。也不默认重新导出第二次证明字节一致；只有修改导出器或显式验证可复现性时才做。

- 只改资源：相关武器检查与画面即可，按发布影响补集成验收。
- 改导出器/校验器：运行 `npm run test:weapon-workflow` 及相关 publication/arms/skins 测试。
- 改加载器/玩法/渲染公共代码：扩大到对应单元测试与浏览器专项；集成交付时再跑全量测试与构建。

## 6. 用耗时而不是等待次数定位问题

发布/预览导出新增 `timings` 和 `blenderTimings`：

- Node：旧包验证、来源指纹、皮肤准备、Blender 子进程、来源未变、候选/发布检查、安装。
- Blender：读取输入、打开作者文件、手臂契约、新网格/动作审计、姿态取样、glTF 导出、GLB 规范化、来源检查。
- 快速检查：资源/绑定、PNG 解码、工具指纹、模型缓存读写/检查。
- 浏览器：Chrome 启动、页面加载、武器就绪、动作检查、截图、释放。

`--report` 可将结果保存到 D 盘；失败也记录已经完成和失败的阶段。耗时不写入不可变的正式 `validation.json` / `source-audit.json`，避免引入每次都不同的发布字节。

### 本次工具改造实测（2026-11-13）

Classic 候选导出约 3.71 秒（Blender 子进程 2.96 秒、候选校验 53 毫秒），单枪 Chrome/WebGPU 预览约 2.53 秒。已有包快速检查一次冷缓存约 168 毫秒、随后模型缓存命中约 60 毫秒。这是本机单次采样，不是对历史会话的耗时还原或性能保证。

已执行 36 个相关工作流/发布/手臂/皮肤测试、生产构建和单枪候选浏览器检查，均通过；未为这次工具改造重复执行双枪玩法/光照/音频/房间全套回归。报告与截图在 `D:/opencode-temp/opencode/weapon-workflow-optimization/`，未改写制作源或已发布武器包。
