# Realistic Blocks / 真实方块

给 Minecraft Java 版 **1.21.1** 的 Fabric 模组。让方块不再是漂浮的乐高积木，而是遵守现实世界规则的物质。

A Fabric mod for Minecraft Java **1.21.1** that makes blocks behave like real matter instead of
floating Lego bricks.

---

## 它做了什么 / What it does

### 1. 结构重力：没有支撑就会塌
挖空底下的岩石，上面的东西会真的掉下来。悬空的桥、抽掉承重柱的房子、被 TNT 炸空的山体，都会连锁坍塌。

判定规则（三条，依次生效）：

| 条件 | 结果 |
|---|---|
| 脚下是实心方块 | 稳 |
| 头顶压着 ≥ `selfSupportThickness`（默认 3）格实心方块 | 稳（拱效应，保护天然洞穴/矿道不连锁塌方） |
| 沿实心方块向下 / 水平走 ≤ `maxSupportDistance`（默认 6）步能走到上面两种方块 | 稳 |
| 以上都不满足 | 塌 |

也就是说：**跨度 13 格以内的屋顶没问题，再宽就要在中间加柱子。** 悬臂式的桥超过 6 格会从末端开始断。

坍塌前有 `collapseDelayTicks`（默认 4 刻 ≈ 0.2 秒）的宽限时间，来得及补一根柱子。

触发来源覆盖玩家挖掘、爆炸、活塞、着火、末影人搬砖 —— 任何方块变化都会重新做支撑判定。

### 2. 砸下来是会死人的
下落的方块按落差造成伤害（默认每格 2 点，单次上限 40）。塌方现场别站在下面。

### 3. 玻璃摔不成一块完整的玻璃
玻璃、玻璃板一类脆性方块失去支撑时直接碎掉，不掉落物品。

### 4. 徒手撬不开花岗岩
需要工具的方块，没有合适工具时**根本挖不动**（而不是原版的"能挖但不掉落"），硬凿还会伤到自己。

### 5. 背包是有重量的
一整背包石头在现实里有几吨重。总重量超过阈值就开始触发缓慢效果，越重越慢。重量按方块硬度估算，工具/盔甲另算。

### 6. 内置 64× 写实材质包
22 张程序化生成的 64×64 材质（原版是 16×16）：石头、圆石、深板岩、泥土、沙子、沙砾、砖块、石砖、橡木板/原木/年轮、草方块、树叶、安山岩/闪长岩/花岗岩、粘土、雪、砂岩。

在 **选项 → 资源包** 里启用 `Realistic Blocks — Textures` 即可。材质由 `tools/generate_textures.py` 生成，改配方重跑脚本就能换风格：

```bash
python3 tools/generate_textures.py
```

---

## 构建 / Build

需要 JDK 21。

```bash
cd RealisticBlocks
./gradlew build
```

产物在 `build/libs/realisticblocks-1.0.0.jar`，丢进 `mods/` 文件夹即可（客户端和服务端都放）。

依赖：Fabric Loader ≥ 0.16.0 + Fabric API。

> **注意**：首次构建需要联网下载 Fabric Loom、Yarn 映射和 Minecraft 本体。如果 `maven.fabricmc.net`
> 被网络策略拦截，构建会在插件解析阶段失败。

### 换 Minecraft 版本
只改 `gradle.properties` 里的四个坐标（去 https://fabricmc.net/develop/ 查对应版本号），
以及 `fabric.mod.json` 里的 `minecraft` 依赖范围。

1.21.2 以上有几处 Yarn 改名需要跟进：`EntityAttributes.GENERIC_MOVEMENT_SPEED` → `MOVEMENT_SPEED`、
`World#getTopY()` → `getTopYInclusive()`、`ServerPlayerEntity#getServerWorld()` → `getWorld()`、
`LivingEntity#damage` 多了一个 `ServerWorld` 参数。

---

## 配置 / Configuration

首次启动生成 `config/realisticblocks.json`，所有开关都在里面，注释见
[`RBConfig.java`](src/main/java/com/realisticblocks/config/RBConfig.java)。

常用项：

| 键 | 默认 | 说明 |
|---|---|---|
| `enableGravity` | `true` | 结构重力总开关 |
| `maxSupportDistance` | `6` | 离最近支撑点的最大水平格数 |
| `selfSupportThickness` | `3` | 头顶多厚的岩体算"自撑" |
| `collapseDelayTicks` | `4` | 坍塌前的宽限刻数 |
| `affectBlockEntities` | `false` | 箱子/熔炉等是否也会塌（默认不塌，避免掉物品） |
| `gravityBlacklist` | 基岩、黑曜石等 | 永不坍塌的方块 ID |
| `requireProperTools` | `true` | 没工具就挖不动 |
| `enableEncumbrance` | `true` | 背包负重 |
| `maxChecksPerTick` / `maxCollapsesPerTick` | `256` / `64` | 性能限流，卡就调小 |

### 游戏内指令（需要 OP，权限等级 2）

```
/realisticblocks status              查看当前状态和待检查队列长度
/realisticblocks reload              重新读取配置文件
/realisticblocks gravity on|off
/realisticblocks gravity distance <0-32>
/realisticblocks tools on|off
/realisticblocks weight on|off
```

---

## 性能 / Performance

支撑判定只在方块变化的邻域触发，不做全局扫描。每刻每个维度有硬预算（默认 256 次判定 / 64 次坍塌），
单次搜索的节点数也有上限（默认 512，超了就判定为"撑得住"）—— 宁可少塌，不让服务器卡住。

在大型服务器上如果仍然吃 TPS，优先调小 `maxChecksPerTick` 和 `maxSearchNodes`。

---

## 一个诚实的说明 / An honest note

「让方块还原现实」有两层意思，这个模组两边都做了，但侧重点不同：

- **物理行为**（重力、结构、重量、工具）—— 这是模组的主体，也是资源包做不到的部分。
- **外观**—— 严格来说属于资源包的范畴。内置的 64× 材质是程序化生成的写实风格（噪声 + Voronoi +
  木纹/砖缝算法），比原版真实得多，但它不是照片扫描材质。想要照片级画面还需要配合光影包
  （Iris + Complementary / BSL 之类）和 PBR 材质包。

---

## License

MIT
