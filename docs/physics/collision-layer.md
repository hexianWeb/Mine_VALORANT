# 练枪房碰撞层 v1

运行时文件：`public/collision/range-room.json`（约 71 KB）。导出脚本：`tools/export_collision.py`。设计规格见 [第二阶段 PRD](../superpowers/specs/2026-11-09-phase2-physics-collision-design.md) 第 5 节。

## 来源

- Blender 文件：`07_已烘焙贴图_降噪预览_透明修复.blend`
- 根集合：`COLLISION_PracticeRoom`，对象必须放在 `COLLISION_*` 子集合中，子集合名去掉前缀后写入每个盒子的 `group`。

| group | 数量 | 内容 |
|---|---|---|
| Floor | 40 | 练枪区地面 |
| Wall | 184 | 墙体 |
| Column | 30 | 柱子、楼梯石柱与连接 |
| Props | 106 | 箱子、方块等道具 |
| Corridor | 29 | 入口与走廊（地面、台阶、墙、路沿） |
| Forgetbox | 1 | 西北侧大体积封堵盒（见「待确认」） |
| 合计 | 390 | |

导出时逐个校验：必须是无修改器的 8 顶点盒子，旋转只允许 90° 的倍数，不能退化，不能同时属于多个子集合。任一不符合直接报错，不产出文件。

## 坐标

运行时坐标 Y 向上、单位米，按 manifest 相同规则转换：Blender `(x, y, z)` → 运行时 `(x, z, -y)`。

- 碰撞层包围盒：min `[-25.08, 7.0, -20.32]`，max `[26.0, 19.0, 21.0]`，水平方向位于运行时模型包围盒（min `[-25.0, 7.875, -22.0]`，max `[26.0, 30.1, 23.0]`）之内；仅 `COL_Forgetbox` 在 X 方向超出 0.08 m。
- 可行走地面顶面高度：7.5 / 8.0 / 8.5 / 9.0 m，练枪区主地面为 9.0 m。

## 文件格式

```json
{
  "schemaVersion": 1,
  "id": "range-room-collision-v1",
  "units": "metres",
  "up": "Y",
  "source": { "blend": "…", "collection": "COLLISION_PracticeRoom", "conversion": "x,z,-y" },
  "spawn": { "position": [0.567, 9.0011, -4.1754], "yawDeg": -180, "source": "empty \"Spawn \"" },
  "bounds": { "min": [], "max": [] },
  "counts": { "boxes": 390, "groups": {} },
  "boxes": [{ "name": "COL_…", "group": "Wall", "min": [x, y, z], "max": [x, y, z] }]
}
```

- `boxes` 按 `group`、`name` 排序，数值保留 4 位小数，便于 diff。
- `spawn.position` 是玩家碰撞盒底面中心；`yawDeg` 绕 +Y 旋转，0° 朝向 -Z（three.js 相机默认朝向）。
- `bounds`、`counts`、`source` 仅用于检查，运行时不依赖。

## 室外地面与 killY（运行时派生，不在文件中）

练枪房外是无限超平坦地形，碰撞与画面同源，都取自 `world.ground.snapshot()`：

- 地面碰撞盒：水平范围 = `outer`（房间中心 ±8192 m，含房间正下方），顶面 = `height`，厚 1 m。`height` = 模型最低点（7.875 m）− 0.01 m = **7.865 m**，与模型底部及石英砖外圈齐平（浏览器实测）。
- `killY` = `height` − 10 m（当前 −2.135 m），兜底穿过地面碰撞盒的情况。
- 踩穿地板重置：名称含 `_Floor_` 的盒子是地板盒（50 个，Floor 组 40 + Corridor 组 10，顶面 7.5–9.0 m，楼上没有地板盒）。玩家脚底低于某地板盒底面、且水平投影与其重叠时，判定为在地板下方，回到出生点。

模型或地面配置变化时地面与 `killY` 自动跟随，不需要重新导出碰撞层。新增地板盒请保持 `_Floor_` 命名，否则不参与踩穿检测。

注意：`COL_Corridor_Floor_NorthDoor_Lower` 与 `COL_Corridor_Floor_Stair_Recess` 顶面为 7.5 m，低于地面 7.865 m；模型在此处最低只到 7.875 m，实际站立高度由地面碰撞盒决定，与画面一致。Blender 中的 7 个空网格（如 `Coarse_Dirt`、`Podzol`）包围盒落在原点，统计模型高度时需排除。

## 出生点

来自 `COLLISION_PracticeRoom` 根集合下的 Empty `Spawn`（Blender 位置 `[0.567, 4.175, 9.001]`，旋转 0）。按名称去除首尾空格后匹配，场景中只能有一个。

- Empty 位置即玩家脚底中心；脚下为 `COL_Practice_Floor_North_019` 顶面（9.0 m）。
- 朝向取 Empty 的局部 -Y 轴（Blender「正面」约定），只用水平分量。旋转为 0 时面向 Blender -Y，即运行时 +Z（`yawDeg` = ±180），与参考相机同向、面对靶道；绕 Z 轴旋转 Empty 即可改朝向。
- 导出时校验 0.6 × 1.8 m 站立盒不与任何盒子重叠。
- 删除 `Spawn` 后导出会回退为：场景相机水平位置落到下方最高碰撞盒顶面，朝向沿用相机。

## 重新导出

当前 Blender 中（只读，不修改场景，可通过 Blender MCP 执行）：

```python
path = r'e:\graphic\MC_VALORANT\tools\export_collision.py'
g = {'__name__': '__main__', 'COLLISION_ARGS': ['--out', r'e:\graphic\MC_VALORANT\public\collision\range-room.json']}
exec(compile(open(path, encoding='utf-8').read(), path, 'exec'), g)
```

后台命令行：

```bash
blender --background room.blend --python tools/export_collision.py -- --out public/collision/range-room.json
```

## 已知事项

- `COL_Forgetbox`：15.4 × 6.9 × 6.2 m 的实心封堵盒（运行时 min `[-25.08, 7.0, -20.32]`，max `[-9.69, 13.88, -14.11]`），有意保留，不与其他碰撞盒重叠。
- 碰撞层最高到 19.0 m，没有屋顶盒；跳跃高度 1.1 m 时不影响，后续若加入高处平台需补顶。
