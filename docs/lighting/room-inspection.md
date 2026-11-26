# 动态阴影与渲染调试

## 操作

- 右上角「渲染调试」默认折叠。点击标题可展开光照切换、AO、LUT 和探针设置。
- `?player=0` 停用玩家输入，使用清单中的固定 Blender 参考机位。`?editor=0` 关闭调试面板和碰撞辅助线。

## 独立模块

- `src/game/range-room/lighting/room-shadows.js`：室内 SpotLight + 2048² PCF 阴影；开启传入物体的投射/接收阴影。
- `src/engine/editor/panels/render-panel.js` 管理渲染调试界面；`src/app/diagnostics.js` 暴露关卡诊断。整体边界见 [运行时架构](../architecture.md)。

矩形顶灯不支持阴影，因此增加独立室内聚光灯。实时 PBR 物体使用标准光照阴影；烘焙材质通过同一张阴影图的 visibility 遮罩接收动态阴影，保留 lightmap/原烘焙外观与 GTAO。烘焙接收材质按实例克隆，释放时恢复原材质和 renderer 设置。发光灯面不参与投影。

阴影灯的位置与朝向参数集中在 `rangeRoomConfig`。

控制台入口：`__RANGE_ROOM__.inspection`，提供 `setCollisionDebug(boolean)`、`setShadows(boolean)` 和 `snapshot()`。玩家启用时，`resetCamera()` 会排队回出生点，与 Home 使用相同的重生命令。

## 验证

```bash
node --test tests/room-inspection.test.mjs tests/range-room.test.mjs tests/motion.test.mjs
node tools/check-inspection-browser.mjs http://localhost:5173/
node tools/check-inspection-browser.mjs "http://localhost:5173/?lighting=appearance"
```

单元测试覆盖阴影材质绑定／恢复与诊断接口。浏览器检查覆盖固定机位、面板折叠与展开、AO 开关、阴影开关和清理。结果和截图默认位于 `D:/opencode-temp/opencode/room-inspection-browser`；可用 `ROOM_TEST_OUTPUT` 分别保存两种光照模式。
