# renderer V2 · 管线优化与验证

日期：2026-11-07。运行时 Three.js r187，资产版本 `range-room-v3`。

## 实现

### AO 与预通道

- `normal-prepass.js`：专用无光照 NodeMaterial，输出有符号 view-space normal 和 depth。仅处理写深度的 OPAQUE/MASK；保留 alphaTest、法线贴图、双面、位移、skinning/morph 和自定义顶点节点。材质按源材质缓存，释放源材质或管线时清理。
- r187 的渲染列表按 scene/camera/lighting 缓存。预通道使用独立禁用的 Lighting 实例，并隔离 `getAO` 上下文，避免在主场景着色中嵌套调用时覆盖其列表或读取正在写入的深度。
- GTAO 默认 `aoResolutionScale = 0.5`、16 samples；`denoiseResolutionScale = null` 表示跟随 GTAO，也允许显式 0.25–1。
- 去噪结果为单通道 R16F、无深度附件。`ao-upsample.js` 用四个低分辨率邻居，结合深度平面距离和法线相似度做双边重建；无匹配表面时返回中性 AO。全分辨率直接采样。
- 重建在真实 AO 接收材质中求值。烘焙外观和走廊额外直接光继续保持既有光照隔离。

### 显示与生命周期

```text
normal/depth → GTAO → R16F spatial denoise
                     ↓ joint bilateral reconstruction
HDR scene（仅实时间接光接收 AO）
  → Reinhard（线性输出）
  → depthless RGBA16F → SMAA
  → sRGB 编码 → 显示域 LUT → screen
```

- SMAA 的邻域混色在线性域完成；显示域 LUT 位于 sRGB 编码之后。
- 禁用/零强度/中性 identity LUT 使用统一分支跳过 3D 纹理采样。
- TSL 的 `If`/`Else` 回调使用无返回值的语句块，消除 inline `Fn()` 的返回值编译警告。
- 去噪 RTT 和 SMAA 输入 RTT 均禁用 depthBuffer；显式拥有并释放所有中间目标。
- `aoSamples` 改为更新 `GTAONode.samples.value`，由 r187 仅重编译 GTAO 材质。分辨率、强度、半径和 LUT 参数原地更新。AO、去噪、AA 和预览模式等图结构变化才重建管线。

### 加载与诊断

- EXR 的 SHA-256 校验完成后，将文件 buffer 转移到 Worker，在 Worker 中解码和生成 alpha 加权 HDR mip。结果 buffer 转移回主线程；纹理采样层复用已生成 mip，避免再次计算。
- Worker 在成功、异常或 AbortSignal 取消时终止；无 Worker 的 Node 环境使用同一纯数据算法。
- 五张 atlas 的 0–2 级纹理数据仍为 210 MiB。压缩这些 HDR 资产需要独立的图像误差和接缝验收。
- `profiling.js` 通过 r187 的 Inspector hooks 记录 pass 名称与 timestamp UID；`measureGpu()` 返回一次完整提交帧的各 pass GPU 毫秒数，缺失/过期查询不计为有效样本。
- 正常运行关闭 timestamp；`?profile=1` 开启。CPU 提交耗时使用定长窗口，启动、resize 或效果配置变化后排除 30 帧暖机。

## 复跑

```bash
npm test
npm run validate:room
npm run build
npm run preview
node tools/check-room-browser.mjs http://localhost:4173/
```

GPU 专项夹具在 Vite 开发服务器执行：

```bash
npm run dev
node tools/check-pipeline-browser.mjs http://localhost:5173/
```

对两个独立生产快照做同口径比较（按 URL 顺序串行运行，每页 20 帧暖机 + 40 个样本）：

```bash
node tools/benchmark-room.mjs http://localhost:4181/ http://localhost:4182/
```

测试报告、截图和独立 Chrome 配置默认存放在 `D:/opencode-temp/opencode/`；可通过 `ROOM_TEST_OUTPUT` 指定另一个临时目录。

## 验证记录

### 回归结果

| 项目 | 结果 |
|---|---|
| Node 回归 | **21/21** 通过，含预通道材质隔离、Worker 取消、HDR mip 复用和稳态统计 |
| 资产校验 | GLB/五页 atlas SHA-256、199 个 primitive、UV 与 alpha 分类通过 |
| ESLint / 生产构建 | 通过；Three.js 主 bundle 仍有大 chunk 提示 |
| 生产 / 当前开发页面回归 | 生产 4182、用户当前开发地址 `localhost:5173` 均 `passed: true`，运行错误、WebGPU validation errors、TSL 与 Three.js 弃用警告为 **0** |
| GPU 预通道夹具 | MASK 孔洞读回 `[0,0,1]`，实体读回 `[1,0,0]`；玻璃不覆盖法线；顶点位移后正确露出背面 `[0,0,1]` |
| 参数更新 | 8/32/16 samples 原地更新；GTAO/去噪独立或联动缩放，scene/normal/SMAA 输入 texture ID 保持不变 |
| 效果切换释放 | 6 轮 AO/去噪/预览/SMAA 开关循环，关闭效果后的 render targets **4 → 4**、textures **111 → 111** |
| resize | 959×539 下 GTAO 为 480×270、去噪为 479×269，正常继续渲染 |
| 面板与 LUT | 实际 DOM 操作验证去噪独立/跟随切换；暖色、关闭、重置、导入和无效导入恢复通过；关闭 LUT 与 identity 的显示差为 0 |
| Worker | 浏览器确认五张 atlas 均在 Worker 解码并生成 3 级 mip |

### 同机生产快照对照

Chrome headless / NVIDIA Lovelace / 1920×1080 / DPR 1 / 参考相机。两个快照串行运行，每页排除 20 帧暖机后取 40 个完整管线帧，使用 GPU timestamps。

| 指标 | V1 | V2 |
|---|---:|---:|
| GPU P50 | 3.943 ms | **2.692 ms** |
| GPU P95 | 3.953 ms | **2.699 ms** |
| CPU 提交 P50 | 2.1 ms | 2.3 ms |
| CPU 提交 P95 | 2.7 ms | 2.9 ms |
| renderer 资源统计 | 599.52 MiB | **551.14 MiB** |
| Draw calls | 271 | **264** |

这一轮独立生产对照中 GPU P50 降低 **31.7%**，资源统计减少 **48.38 MiB**；CPU 提交略增，不能把 GPU 收益表述为 CPU 或最终显示 FPS 的等比例改善。最后一轮生产端到端回归中的 12 样本 GPU P50/P95 为 **2.705 / 2.771 ms**。

### 半分辨率 AO 质量检查

同一参考机位比较 V2 全分辨率 AO/去噪与默认半分辨率，读取 scene pass 的线性 HDR，不经过 SMAA、tone mapping 或 LUT。245 个可见表面像素中有 133 个实时材质像素：

- 烘焙表面最大通道差：**0**。
- 实时表面平均绝对通道差：**0.000453**。
- 实时表面最大绝对通道差：**0.02051**。
- 已查看 1080p 前后截图；栅栏孔洞和主要像素纹理保持可见。该数值只覆盖参考机位采样，不代表所有运动场景。

### 分 pass 诊断

GPU 专项在开发页面完成多轮配置切换与 HDR 读回后采样 40 帧。最后一轮默认半分辨率链路的 pass P50：normal/depth **0.126 ms**、GTAO **0.509 ms**、去噪 **0.177 ms**、HDR color（含重建/光照）**1.709 ms**。全部 9 个 pass 的名称、尺寸、GPU 时间均可通过 `measureGpu()` 读取。

该专项默认链路整帧 P50/P95 为 **2.785 / 2.878 ms**；开发页面多轮运行存在波动，上面的优化比例采用独立干净生产页面的同口径对照。每个 pass 的百分位不能相加当作整帧百分位。

### `renderAsync()` 弃用提示复核

- 当前项目源码没有 `renderAsync()` 调用。`src/engine/runtime/function/render/render-system.js` 在创建 renderer 后先 `await renderer.init()`，管线和预通道使用同步 `render()`。
- 对用户当前地址 `http://localhost:5173/` 使用独立 Chrome 会话运行完整回归，结果 `passed: true`、`errors: []`，未复现该提示；这不等同于已确定原有标签页中警告的调用来源。
- `tools/browser-session.mjs` 已将 Three.js 弃用/重命名警告及 TSL 警告纳入失败条件，并保存 console 调用栈。若原标签页强制刷新后仍出现，可用展开的调用栈定位来源。

### 证据文件

- `D:/opencode-temp/opencode/render-v2/comparison/report.json`：V1/V2 40 样本生产对照与原始 GPU 样本。
- `D:/opencode-temp/opencode/render-v2/pipeline-browser/report.json`：预通道 readback、245 像素 AO 对照、参数更新、循环释放及分 pass 数据。
- `D:/opencode-temp/opencode/render-v2/final-browser/report.json`：最终生产端到端回归。
- `D:/opencode-temp/opencode/render-v2/live-dev-browser/report.json`：用户当前 5173 开发页面回归及弃用提示复核。
- `D:/opencode-temp/opencode/render-v2/baseline-browser/room-fullhd-gtao-smaa.png`：更新前参考截图。
- `D:/opencode-temp/opencode/render-v2/final-browser/room-fullhd-gtao-smaa.png`：更新后参考截图；同目录另含 AO 预览、走廊与移动机位检查图。
