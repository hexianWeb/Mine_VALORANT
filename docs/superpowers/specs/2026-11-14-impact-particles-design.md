# 命中粒子：Engine ParticleSystem + 武器命中效果

- 日期：2026-11-14
- 来源：用户要求枪械打到材质上产生粒子飞溅，并确认粒子系统应作为 engine 服务。
- 状态：设计待审，未实现。
- 决策：混合风格（Valorant 式火花／烟尘 + MC 式方块碎屑）；第一轮按表面类型区分；弹孔贴花不在本轮。

## 1. 分层

沿用音频的两层结构：

| 音频（现有） | 粒子（新增） |
| --- | --- |
| `engine/runtime/function/audio/audio-system.js`：通用服务，不认识武器 | `engine/runtime/function/particle/particle-system.js`：通用服务，不认识武器和表面 |
| `RuntimeContext` 创建，`Disposer` 释放 | 同左 |
| `Engine.logicalTick` 末尾 `audio.flush(time, listener)` | 紧随其后 `particles.flush(time)` |
| `game/weapons/weapon-audio.js`：`receive(batch)` 把事件翻译成 cue | `game/weapons/impact-effects.js`：`receive(batch)` 把 `ShotFired.impact` 翻译成粒子 |
| `bootstrap → level → weapons.audio → PlayerWeapons` | `bootstrap → level → weapons.particles → PlayerWeapons` |

ParticleSystem 是 RuntimeContext 持有的全局服务，和 audio／physics 同级，不包装成游戏对象。

```text
fixed:     PlayerWeapons.fixed → trace() 得到 { hit, position, normal, surface }
           → ShotFired 事件 → #accept → view / audio / impactEffects.receive(batch)
           → impactEffects 按表面预设生成粒子数组 → particles.emit(list)
logical 尾: Engine → particles.flush(frame.time)：只写时间 uniform
render:    InstancedMesh 在顶点着色器里解析计算位置
```

## 2. 命中信息：`player-weapons.js` 的 `trace()`

在现有 slab 求交里额外记录决定 `enter` 的轴 `axis`，法线为该轴上 `-sign(direction[axis])`，其余轴为 0。射线起点在盒内（`enter === 0`）时法线取 `-direction`。

`surface` 由 `surfaceOf(box)` 判定，第一轮按名字关键词：

| surface | 判定 |
| --- | --- |
| `metal` | 名字含 `Anvil` |
| `wood` | 名字含 `Chest`、`Jungle`、`Bed`、`Fence`、`CounterSlab` |
| `dirt` | `group === 'Ground'` |
| `stone` | 默认 |

返回值变为 `{ hit, distance, position, normal, surface }`；未命中时 `normal` 与 `surface` 为 `null`。HUD 只读 `impact.hit`，不受影响。以后碰撞导出加入 `surface` 字段时，只改 `surfaceOf`。

## 3. Engine：`ParticleSystem`

### 接口

```javascript
const particles = createParticleSystem({ scene, capacity: 1024 })
particles.emit([{ shape, origin, velocity, gravity, born, life, size, color }])
particles.flush(time)   // time.presentationTime → uniform
particles.clear()
particles.snapshot()    // { capacity, written, alive }
particles.dispose()
```

- `shape`：`'streak' | 'cube' | 'puff'`。
- `born`：出生时刻，使用与 `presentationTime` 同一时间轴的秒数。调用方传事件的 `at`；`born` 晚于当前展示时间时粒子保持隐藏，直到时间到达，自然吸收固定步与展示插值之间的延迟。
- 暂停：`presentationTime` 由固定步时钟推出，Engine 暂停或 `timeScale = 0` 时不前进，粒子随之冻结，不需要单独的 `setPaused`。

### 存储

两个内部批次，各自一个环形缓冲区，满了覆盖最旧的槽：

| 批次 | shape | 几何 | 材质 |
| --- | --- | --- | --- |
| solid | `streak`、`cube` | `BoxGeometry(1,1,1)` | 不透明、无光照；`streak` 不参与 tone mapping |
| soft | `puff` | `PlaneGeometry` 面向相机 | 透明、`depthWrite = false`、深度淡出 |

每个实例的 `InstancedBufferAttribute`：

- `aOrigin` vec3、`aVelocity` vec3
- `aParams` vec4：`born, life, size, gravity`
- `aColor` vec4：`rgb, shapeId`

`emit` 只写被占用的槽，用 `addUpdateRange` 加 `needsUpdate` 局部上传。`count` 固定为容量，`frustumCulled = false`。

### 着色器（TSL `positionNode`）

```text
t = uTime - born
alive = t >= 0 && t <= life
k = t / life
p = origin + velocity·t + ½·(0, -gravity, 0)·t²
streak: 沿当前速度 v = velocity + g·t 拉长，长度随 |v|；尺寸随 k 收缩
cube:   以 seed（由槽号推出）绕轴旋转；尺寸随 k 收缩
puff:   相机朝向的面片，尺寸随 k 膨胀，透明度随 k 衰减
!alive: 缩放为 0
```

`streak`、`cube` 与 `puff` 的分支用 `shapeId` 选择。不做粒子碰撞，不做 compute shader。

## 4. Game：`ImpactEffects`

- `receive(batch)`：
  - `PresentationReset` 调用 `particles.clear()`。
  - `ShotFired` 且 `impact.hit` 非空时，按 `impact.surface` 读取预设，生成粒子并 `emit`。
- 随机数：以 `shotSequence` 为种子的小型确定性 PRNG，同一发子弹结果可复现。
- 发射方向：`d = normalize(mix(reflect(dir, n), n, 0.5))`，在 `d` 周围的锥形内随机扩散；起点沿法线外推 0.01，避免和表面重合。
- 预设写死在 `impact-effects.js`，不做调参面板：

| surface | 火花 | 碎屑（cube） | 烟尘（puff） |
| --- | --- | --- | --- |
| metal | 8～12，亮黄，0.15s | 2，深灰 | 无 |
| stone | 2～3 | 6～8，灰色调色板 | 1，浅灰 |
| wood | 无 | 6～8，棕色调色板，拉长 | 1，浅棕，较小 |
| dirt | 无 | 4，土色 | 2，棕色，较大 |

具体数量、速度和尺寸在实现时用浏览器截图定，改代码里的常量，不加 UI。

## 5. 接线改动

| 文件 | 改动 |
| --- | --- |
| `engine/runtime/function/particle/particle-system.js` | 新建 |
| `engine/runtime/index.js` | 与 `AudioSystem` 同样直接导出 `createParticleSystem` |
| `engine/runtime/function/global/runtime-context.js` | `defaults.particles`，在 render 后创建并交给 `Disposer` |
| `engine/runtime/engine.js` | 构造参数 `particles = null`；`audio.flush` 后加 `particles?.flush(this.frame.time)` |
| `app/bootstrap.js` | 向关卡传 `particles: runtime.particles` |
| `game/range-room/level.js` | 保存 `particles`，放入 `weapons` 依赖 |
| `game/weapons/player-weapons.js` | `trace()` 增加 `normal`、`surface`；有 `particles` 时创建 `ImpactEffects`，在 `#accept` 中调用 `receive`，`dispose` 时释放 |
| `game/weapons/impact-effects.js` | 新建 |

`particles` 是可选依赖。武器预览页和不传它的测试行为不变。`player-weapons.js` 目前有未提交改动，实现时在它的基础上修改。

## 6. 验证

单元测试（Node，不依赖 GPU）：

- `trace()`：六个面各命中一次，检查法线；关键词表覆盖四种 surface；未命中返回 `null`。
- `ParticleSystem`：用替身 scene 验证 `emit` 写入的属性值、环形覆盖、`clear`、`snapshot` 计数。
- `ImpactEffects`：同一 `shotSequence` 输出相同；metal 有 `streak`，wood 没有；`hit` 为空时不发射；`PresentationReset` 触发 `clear`。
- `Engine`：`flush` 在 `audio.flush` 之后、`render.update` 之前被调用。

画面检查：在 dev 服务器上分别对墙（stone）、铁砧（metal）、箱子（wood）、地面（dirt）开火，各截一张图；再检查暂停时粒子冻结、恢复后继续。

只运行直接相关的测试文件和一次浏览器截图，不跑全量武器、房间、音频回归。

## 7. 不在本轮

- 弹孔贴花。
- 从方块贴图采样碎屑颜色：需要盒子到贴图的映射，现在的碰撞数据没有。
- 碰撞导出里的 `surface` 字段。
- 粒子与场景的碰撞反弹、光照、阴影。
