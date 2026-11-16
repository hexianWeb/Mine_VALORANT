# 动态阴影与飞行观察

漂浮茶壶及其定位、暂停入口已移除；保留房间动态阴影与飞行／轨道观察工具。

## 操作

- 点击画面激活飞行，**右键拖动**观察，**WASD**移动，**Q/E**下降/上升。
- **Shift** 为 4 倍速度，滚轮调整基础速度（0.5–40 m/s），**Esc** 释放操作。
- 飞行／轨道模式下 **R** 恢复参考相机。
- 左下角切换飞行/轨道模式、开关碰撞线框和阴影。
- 调整右侧面板或窗口失焦时会清除移动输入。

## 独立模块

- `src/game/range-room/lighting/room-shadows.js`：室内 SpotLight + 2048² PCF 阴影；开启传入物体的投射/接收阴影。
- `src/engine/editor/camera-controls.js`：统一的自由／轨道观察操作；玩家模式下交出相机控制权。整体边界见 [运行时架构](../architecture.md)。
- `src/game/range-room/level.js` 组装并拥有关卡对象；`src/engine/editor/panels/inspection-panel.js` / `.css` 管理观察 UI；`src/app/bootstrap.js` 连接关卡操作、模式切换与工具生命周期。

矩形顶灯不支持阴影，因此增加独立室内聚光灯。实时 PBR 物体使用标准光照阴影；烘焙材质通过同一张阴影图的 visibility 遮罩接收动态阴影，保留 lightmap/原烘焙外观与 GTAO。烘焙接收材质按实例克隆，释放时恢复原材质和 renderer 设置。发光灯面不参与投影。

阴影灯的位置与朝向参数集中在 `rangeRoomConfig`。

控制台入口：`__RANGE_ROOM__.inspection`，提供 `setMode('player' | 'fly' | 'orbit')`、`resetCamera()`、`setCollisionDebug(boolean)`、`setShadows(boolean)` 和 `snapshot()`。

## 验证

```bash
node --test tests/room-inspection.test.mjs tests/range-room.test.mjs tests/motion.test.mjs
node tools/check-inspection-browser.mjs http://localhost:5173/
node tools/check-inspection-browser.mjs "http://localhost:5173/?lighting=appearance"
```

单元测试覆盖阴影材质绑定／恢复、渲染关卡不再创建茶壶和诊断接口清理。浏览器检查覆盖旧入口移除、阴影开关、初始机位、键鼠操作、帧率无关移动、焦点释放、模式切换和清理。结果和截图默认位于 `D:/opencode-temp/opencode/room-inspection-browser`；可用 `ROOM_TEST_OUTPUT` 分别保存两种光照模式。
