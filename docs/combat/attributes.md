# 最小战斗属性模型

## 当前范围

本模块位于 `game/combat`，是独立的生命、护甲和伤害模型，**尚未装配到玩家、机器人、武器命中或 HUD**。现有射击、受击动画、Home 重生及资产行为不变。

本次不新增 AttributeSystem、通用属性字典、修正器、Buff、全局事件总线或更新循环；不为七把枪推测伤害数值，也不声称实现完整 VALORANT 伤害规则。

入口：[src/game/combat/index.js](../../src/game/combat/index.js)；实现：[attributes.js](../../src/game/combat/attributes.js)。

## 状态与所有权

`CombatAttributes` 私有持有一个对象的数值，构造时从配置复制并初始化为满值：

| 字段 | 含义 | 默认／约束 |
| --- | --- | --- |
| maxHealth | 重置后的生命上限 | 默认 100，有限且大于 0 |
| maxArmor | 重置后的护甲上限 | 默认 0，有限且非负 |
| health | 当前生命 | 初始等于 maxHealth，伤害结算后不小于 0 |
| armor | 当前护甲 | 初始等于 maxArmor，伤害结算后不小于 0 |
| alive | 当前是否存活 | 只读派生值：health > 0，不单独存储 |

默认值仅属于独立模型，不是对当前游戏角色的数值配置。构造器配置只接受普通对象与 maxHealth／maxArmor 两个字段；字段省略时使用默认值，字段显式设为 undefined、null、非数字或提供未知字段会报错，不静默修正拼写。

未来由角色／目标对象持有该模型；不存在全局属性注册表。模型不持有 Three.js、DOM、资源、监听器或时钟，不需要 dispose。弹药、射击冷却、动作事务仍归 WeaponInventory／EquipmentController，不迁入此模型。

## 护甲与伤害规则

输入 damage 必须是有限非负数。存活对象按以下顺序计算：

```text
armorDamage = min(armor, damage × 2/3)
healthDamage = min(health, damage - armorDamage)
nextArmor = armor - armorDamage
nextHealth = health - healthDamage
killed = 原先存活，且 nextHealth == 0
```

护甲不是优先吃完全部伤害的护盾。护甲充足时生命仍承担 1/3；不足时，所有未被护甲吸收的伤害都转给生命。超出剩余生命的伤害不产生负值。

示例：

| 结算前生命／护甲 | 输入伤害 | 生命损失／护甲损失 | 结算后生命／护甲 |
| --- | --- | --- | --- |
| 100 / 50 | 30 | 10 / 20 | 90 / 30 |
| 100 / 5 | 30 | 25 / 5 | 75 / 0 |
| 100 / 0 | 30 | 30 / 0 | 70 / 0 |
| 10 / 50 | 60 | 10 / 40 | 0 / 10 |

- 不取整，不额外引入整数扣血、误差吸附或最小伤害；分数使用 JavaScript 浮点数，数值比较应考虑浮点精度。
- killed 仅表示这次存活 → 死亡的转换，不是持续状态。重复攻击死亡对象不会再次报告 killed，也不会消耗其剩余护甲。
- 死亡对象仍验证输入；负伤害不能当作治疗。零伤害不改变状态。
- 该规则只覆盖本次确认的 2/3 护甲分担，不含部位倍率、距离衰减、穿透、伤害类型或护甲购买规则。

## API

```js
import { CombatAttributes, resolveDamage } from '../../src/game/combat/index.js'

const attributes = new CombatAttributes({ maxHealth: 100, maxArmor: 50 })
const before = attributes.snapshot()
const result = attributes.applyDamage(30)
// result:
// { health: 90, armor: 30, healthDamage: 10, armorDamage: 20, killed: false }
// before 仍是 100 / 50；attributes.snapshot() 为 90 / 30。

const preview = resolveDamage(attributes.snapshot(), 60)
// preview 为 60 / 0；纯计算，不修改 attributes。

attributes.reset()
// 恢复配置的 100 / 50。没有隐式治疗、自动复活或自动定时重生。
```

| 接口 | 行为 |
| --- | --- |
| new CombatAttributes(config?) | 校验并复制上限，初始满生命／满配置护甲，不保留或冻结调用方配置 |
| snapshot() | 返回新的冻结快照：maxHealth、maxArmor、health、armor、alive |
| applyDamage(amount) | 先完整验证／结算，再一起提交生命和护甲；返回冻结的结算结果 |
| reset() | 恢复配置的两个上限，返回新快照；重复调用安全 |
| resolveDamage(state, amount) | 读取普通对象的 health／armor，接受 snapshot；不修改或冻结输入，返回新冻结结算结果 |

结算结果包含下一状态 health／armor、本次实际 healthDamage／armorDamage 和 killed。无效请求抛错且不改变实例状态。纯结算不解释输入对象的其他字段，也不校验其他属性的上限。

## 时间与未来接线边界

当前模型没有实际 tick 调用方。以后接线应遵循[模块时序契约](../runtime-module-contracts.md)：

1. 由固定玩法步骤确认命中和伤害值，再调用目标持有的 applyDamage；展示层不重复结算。
2. 武器伤害表、部位／距离规则属于 game，不能从动画长度、骨骼名字或表现特效反推。
3. 每发／弹丸的身份和去重由调用方负责。现有 ShotTargets.react 为受击动画合并同目标命中，不能直接复用为霰弹枪的伤害聚合策略。
4. 模型不自行发事件或安排重生。未来调用方可根据 killed 生成死亡事实，在统一表现时间展示；重生时显式调用 reset。
5. 暂停、Editor 交接或刷新 UI 不自动改变属性；Home 目前也未调用本模型。

持续伤害、属性修正与状态效果等出现真实需求后再扩展，当前不预建 EffectSystem。

## 检查

```powershell
node --test tests/combat-attributes.test.mjs tests/architecture.test.mjs
```

测试覆盖护甲分担／不足／耗尽、无护甲、分数和零伤害、超额致死、死亡后命中、重置、实例隔离、纯计算、只读快照、输入校验与失败原子性。架构测试同时检查引用可解析、依赖单向与无环。
