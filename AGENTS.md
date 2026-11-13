# 项目工作约定

## Blender → Three.js：先区分制作、预览、发布

- 默认只完成用户要求的修改。用户只要求改 Blender 时，不自动发布、改游戏入口或扩展制作工具；需要接入游戏时先走候选预览。
- 按需阅读 `docs/weapons/iteration-workflow.md`（日常迭代）、`docs/weapons/gun-only-uv-workflow.md`（图集/UV）、房间工作则读对应房间导出文档，不一次加载全部历史记录。
- Blender 开始时确认文件、场景、目标对象/图片及共享数据，并备份未保存状态。将相关查询合并为一次、相关编辑合并为一次；输出目标统计/异常摘要，不反复转储全场景、全动作、全像素。
- 只改贴图颜色：检查目标图片、Alpha、材质绑定及局部预览；不反复核验所有骨架/动画。裁图/UV：补有效区域像素、UV 换算和透明效果面检查。几何/权重/骨架/动画真的变化时，才补相应变形/动作检查。
- 日常武器候选用 `tools/weapons/publish-optimized.mjs <recipe> --preview --blender <path>`。它只写 `D:/opencode-temp/opencode/weapon-previews/` 等项目外候选目录；不要把候选复制进 `public` 或直接更新已发布包的哈希。
- 已有包快速检查用 `npm run weapon:check -- <package-directory>`；只有需要实际画面时，才运行一次 `check-weapons-browser.mjs <preview-url> --quick --weapon classic`。不要对小改动默认运行双枪玩法、光照、音频、房间回归。
- 正式发布必须使用固定来源哈希的新版本配方，保留完整资产校验、glTF Validator 和不覆盖旧版本的门槛。预览通过不等于发布通过。发布成功后，不为“再确认”立即重复 `--verify-only` 或重新导出比较字节。
- 改工具/加载器时运行直接相关测试；改渲染/玩法公共代码时再扩大验证范围。全量 `npm test` / build / 浏览器组合是集成交付检查，不是每一次 Blender 编辑的默认动作。
- 失败先定位失败阶段，不盲目重跑整条链路。总结说明已做检查、未做检查、缓存命中及耗时；不将历史报告冒充本次验收。

## 安全与存储

- 保留用户未提交的改动。制作 `.blend`、已发布资源、配方原始字节和来源证据不可因优化流程而改写。
- 后台导出不连接/改写用户正在使用的 Blender；源文件前后内容校验不可取消。
- 临时配方、备份、候选、截图、浏览器 profile、报告、缓存统一放 `D:/opencode-temp/opencode/`；运行使用 `os.tmpdir()` 的旧测试时也将 `TEMP` / `TMP` 指向该处。
- 当前仓库没有 `.codegraph/` 时使用 Read/Grep/Glob，不主动索引。保持现有 package manager 锁文件，不自动互转。
