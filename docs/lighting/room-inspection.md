# 茶壶、动态阴影与飞行观察

默认在练枪房大厅中心 `(0.5, 11.8, 5.5)` 放置陶瓷茶壶。前 4 秒从中心平滑进入椭圆轨道，32 秒环绕一圈，同时自转与上下漂浮。

## 操作

- 点击画面激活飞行，**右键拖动**观察，**WASD**移动，**Q/E**下降/上升。
- **Shift** 为 4 倍速度，滚轮调整基础速度（0.5–40 m/s），**Esc** 释放操作。
- **F** 定位茶壶，**R** 恢复参考相机。
- 左下角切换飞行/轨道模式、暂停漂浮、开关阴影。暂停只影响茶壶，相机仍可移动。
- 调整右侧面板或窗口失焦时会清除移动输入。

## 独立模块

- `src/world/floating-teapot.js`：几何、PBR 材质、自转/环绕/漂浮；调用 `update(deltaSeconds)` 驱动。
- `src/world/room-shadows.js`：室内 SpotLight + 2048² PCF 阴影；开启传入物体的投射/接收阴影。
- `src/engine/function/fly-controller/index.js`：功能层的飞行控制模块，提供通用 `FlyController(camera, element, options)`，无房间或 UI 依赖。整体边界见 [运行时代码分层](../architecture.md)。
- `src/room-inspection.js` / `.css`：组装上述模块、观察面板、调度和释放；`main.js` 只创建并接入快照。

矩形顶灯不支持阴影，因此增加独立室内聚光灯。实时 PBR 物体使用标准光照阴影；烘焙材质通过同一张阴影图的 visibility 遮罩接收动态阴影，保留 lightmap/原烘焙外观与 GTAO。烘焙接收材质按实例克隆，释放时恢复原材质和 renderer 设置。发光灯面不参与投影。

大厅参数集中在 `inspectionConfig`；没有使用包含屋顶和街道的整个 GLB 包围盒来计算运动范围。

控制台入口：`__RANGE_ROOM__.inspection`，提供 `setMode('fly' | 'orbit')`、`focusTeapot()`、`resetCamera()`、`setPaused(boolean)`、`setShadows(boolean)` 和 `snapshot()`。

## 验证

```bash
npm test
node tools/check-inspection-browser.mjs http://localhost:5173/
node tools/check-inspection-browser.mjs "http://localhost:5173/?lighting=appearance"
```

浏览器检查覆盖实际烘焙地面像素收到茶壶阴影、运动、初始机位、键鼠操作、帧率无关移动、焦点释放、模式切换和清理。结果和截图默认位于 `D:/opencode-temp/opencode/room-inspection-browser`；可用 `ROOM_TEST_OUTPUT` 分别保存两种光照模式。
