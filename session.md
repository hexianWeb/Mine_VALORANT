下面是计划书，还没有动任何代码。

## 一、任务理解

目标是把现在只在 `?weaponStudy=1` 下、只对 Classic v4 AG 生效的外观，变成游戏的默认外观，覆盖所有武器和皮肤。

**这套外观具体是什么：**

- 枪身材质：金属度 1，粗糙度 1，颜色贴图同时作为自发光、强度 0.4，清漆粗糙度 0.18，平直着色。
- 枪身环境反射：静态室内 Cubemap，倍率 0.3。

**游戏里实际用到的武器和皮肤：**

| 武器 | 版本 | 皮肤 | GLB 里的枪身材质 |
|---|---|---|---|
| Classic | v4 | ag、smite、sakura | 带自发光贴图（内嵌的是 AG 颜色图），清漆 0.29 |
| Phantom | v2 | tactiplay | 金属度 0，没有自发光，没有清漆 |

## 二、查到的三个风险

1. **切到别的皮肤会串色。** Classic v4 的 GLB 里，自发光贴图内嵌的是 AG 的颜色图。`weapon-assets.js` 换皮肤时只换 `map`，不换 `emissiveMap`。所以 smite 和 sakura 一旦开启自发光，发出来的是 AG 的图案。
2. **你的未提交测试已经定好了自发光规则，但还没有实现。** `tests/weapon-assets.test.mjs` 里有一条用例"albedo-only weapon skins glow with their color map and ignore embedded emission"，规定只有颜色贴图的皮肤要用自己的颜色贴图做自发光、强度为 1，并且忽略 GLB 里内嵌的那张。目前失败的 4 个测试就是因为这部分实现还没写。这条规则正好能解决第 1 个风险，但它要求强度 1，和我们定下的 0.4 冲突。
3. **Phantom 没有清漆。** GLTFLoader 只会给它生成 `MeshStandardMaterial`，这种材质根本没有清漆属性，设置清漆粗糙度也不会有效果。

## 三、方案（选最简单可行的）

**1. 默认材质：改 `weapon-materials.js`**

- 把枪身配置从金属度 0.8、粗糙度 0.42 改成金属度 1、粗糙度 1、清漆粗糙度 0.18、平直着色。
- 加载时的 `applyWeaponMaterialProfile` 本来就会对每把枪身执行一次，所以不需要新增机制。

**2. 自发光：改 `weapon-assets.js` 换皮肤的逻辑**

- 换皮肤时，`emissiveMap` 跟随皮肤：皮肤自己有 `emissiveMap` 就用它，没有就用这张皮肤的颜色贴图。
- 自发光颜色设为白色，强度用 0.4，或者用皮肤里写的 `emissiveIntensity`。
- 这一步同时让你那 4 个尚未通过的测试有了实现。

**3. 环境反射：靠关卡和资源层传递**

- 关卡默认就加载室内反射，不再要求 `weaponStudy=1` 或 `reflectionPreview=1`。
- 把反射贴图传给 `WeaponAssets`，克隆枪身材质时设置 `envMap = 室内反射`、`envMapIntensity = 0.3`。
- 全局灯光开关时，把已经创建的枪身材质的反射强度一起清零或恢复。这个联动现在由小样的 `refresh()` 承担，改为由 `WeaponAssets` 自己提供。
- 手臂和瞄具保持现状，不使用室内反射。

**4. 删掉小样**

删除以下内容，以及 `bootstrap.js`、`config.js`、`level.js`、`editor.js`、`render-panel.js` 里的引用：

- `weapon-material-study.js`、`weapon-study-panel.js`
- `?weaponStudy=1` 参数
- 对应的单元测试和浏览器测试

保留 `?reflectionPreview=1`，它只是用来查看 Cubemap 的调试工具。

**为什么不选更复杂的做法：**

- 不保留"小样 + 默认"两套并存。两条路径会长期分叉，而你已经确认要用这个效果了。
- 不把视图模型整个场景的环境贴图换成室内反射。那样手臂的观感也会跟着变，超出了这次的范围。
- 不在运行时把 Phantom 的材质换成 `MeshPhysicalMaterial`，见下面的待决定事项。

## 四、需要你决定的事

1. **自发光强度用 0.4 还是 1？** 你的未提交测试规定的是 1，按 AG 调出来的结果是 0.4。我建议用 0.4，同时把那条测试的期望值改成 0.4。
2. **Phantom 要不要清漆？**
   - 方案 A，不要：Phantom 只应用金属度、粗糙度、自发光和反射这几项，改动最小。
   - 方案 B，要：需要在 Blender 里给 Phantom 加上清漆，再按发布流程出一个新版本。这不是改代码能解决的。
3. **旧版本（Classic v1 到 v3、Phantom v1）要不要管？** 它们的配置文件不再被引用，我建议不管。

## 五、实施步骤

1. 修改 `weapon-materials.js` 里的枪身配置。
2. 在 `weapon-assets.js` 里实现自发光跟随皮肤，并接收反射贴图、设置给枪身材质，同时提供灯光开关时更新反射强度的接口。
3. 让 `level.js` 默认加载室内反射并传给 `WeaponAssets`，灯光开关时调用上一步的接口。
4. 删除小样相关的代码、面板、参数和测试。
5. 更新 `docs/weapons/material-quality-roadmap.md` 里关于默认材质的描述。

## 六、验证

- **单元测试**：`weapon-assets.test.mjs` 应全部通过，包括原来失败的 4 个。另外新增断言：枪身材质为金属度 1、粗糙度 1、清漆粗糙度 0.18；切到 smite 或 sakura 后，`emissiveMap` 是该皮肤自己的颜色贴图；灯光关闭后反射强度为 0。
- **相关测试**：`app-config.test.mjs`（会删除 `weaponStudy` 参数）以及反射预览的测试。
- **画面检查**：跑一次 `check-weapons-browser.mjs --quick`，分别看 Classic 的 ag、smite、sakura 和 Phantom 的 tactiplay。这一步只看画面。
- 按 AGENTS.md 的约定，这次只改运行时代码，不重新发布 GLB，也不改资源哈希。

请确认第四节的三个问题。确认后我按这个顺序实施。