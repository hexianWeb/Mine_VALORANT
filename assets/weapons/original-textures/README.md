# 枪械原始皮肤贴图

从 `skin_work_folder/vandal_skin_work/three_vandals/Vandal_EGO_Magazine_Fixed.blend` 的内嵌图片逐字节提取。PNG 保留源分辨率、RGBA 及原始文件字节。这里只存放美术源图，游戏不直接读取本目录。

| 枪械目录 | `weapon.png` | `scope.png` |
| --- | --- | --- |
| `ghost` | 256×256 | — |
| `sheriff` | 512×512 | — |
| `vandal` | 256×256 | — |
| `phantom` | 256×256 | — |
| `operator` | 256×256 | 256×256 |
| `outlaw` | 256×256 | 256×256 |
| `judge` | 256×256 | — |
| `odin` | 512×512 | — |

Vandal 取自 `Royal Gold EGO and Original` 场景的 `03 Original - Body`；该对象与主展示场景中的 EGO 材质引用同一个图片数据块。不包含 Classic、角色手臂或其他变体贴图。

其中 6 张内嵌 PNG 在结束块（`IEND`）后有 1–3 个零字节。源文件原样保留；校验时只对结束块以内的 PNG 数据做解码。

游戏默认原皮：`ghost/v2`、`sheriff/v2`、`vandal/v1`、`phantom/v4`、`judge/v2`、`odin/v2`。新增版本保留现有 GLB，所有已发布枪械三角面的 UV 均与原图的制作源匹配；Odin 的原工程另有 160 个三角面，不在现有 GLB 中。发布版 PNG 只移除 `IEND` 之后的零填充，不改变像素、尺寸或 Alpha。[固定来源配方](../../../tools/weapons/skin-releases/original-atlas.json)及逐枪 UV 审核记录随新版本保存。Operator、Outlaw 目前只有美术资源，没有已验证的游戏武器包。
