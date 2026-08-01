# 让 Minecraft 还原现实 / Making Minecraft Feel Real

三个独立的项目，各管一层。分开做是因为它们本来就是三种不同的东西 —— 模组改不了画面，
资源包改不了物理，光影改不了玩法。

Three separate projects, one layer each. They are split because they genuinely are different
things: a mod cannot change how pixels look, a resource pack cannot change physics, and a shader
cannot change gameplay.

| 项目 | 类型 | 装到哪 | 管什么 |
|---|---|---|---|
| [`RealisticBlocks`](RealisticBlocks) | Fabric 模组 (MC 1.21.1) | `mods/` | 结构重力、塌方伤害、工具需求、背包负重 |
| [`RealisticTextures`](RealisticTextures) | 资源包 | `resourcepacks/` | 113 个方块的 64× 材质 + LabPBR 法线/高光图 |
| [`RealisticShaders`](RealisticShaders) | 光影包 | `shaderpacks/` | 阴影、SSAO、PBR 光照、物理天空、水面反射、色调映射 |

---

## 完整安装 / Full setup

```
.minecraft/
├── mods/
│   ├── fabric-api-*.jar
│   ├── iris-*.jar              ← 光影加载器
│   ├── sodium-*.jar            ← Iris 的性能依赖
│   └── realisticblocks-1.0.0.jar
├── resourcepacks/
│   └── RealisticTextures/
└── shaderpacks/
    └── RealisticShaders/
```

1. 装 Fabric Loader (≥ 0.16.0) + Fabric API
2. 装 [Iris](https://irisshaders.dev/) + Sodium（或改用 OptiFine）
3. 构建模组：`cd RealisticBlocks && ./gradlew build`，把 `build/libs/*.jar` 放进 `mods/`
4. `RealisticTextures/` 整个文件夹放进 `resourcepacks/`，游戏里启用
5. `RealisticShaders/` 整个文件夹放进 `shaderpacks/`，游戏里启用
6. 光影设置里确认 **LabPBR** 是开的（材质包的法线/高光图靠它生效）

三个都是独立的，只装其中一个也能正常工作。

---

## 各自的边界 / What each layer can and cannot do

**模组**能做物理，做不了画面。它让方块有重量、有结构、需要工具，但一块石头长什么样它管不着。

**资源包**能换贴图和 PBR 数据，但它只是提供数据 —— 没有光影读取的话，法线图和高光图完全不起作用。

**光影**能做光照、阴影和后期，但它读到什么材质数据取决于资源包。不装 PBR 材质包的话，
所有表面在光影眼里都是平的、同样粗糙的。

所以「还原现实」的效果是叠出来的：模组给世界物理规则，资源包给表面细节，光影把这些细节点亮。

---

## 一个诚实的说明 / An honest note

材质是**程序化生成**的写实风格（噪声、Voronoi、木纹和砌体算法），不是照片扫描材质。
它比原版真实得多，但和真正的照片级 PBR 材质包（几百 MB 的那种）不是一个量级。

光影通过了 glslang 的编译校验（34/34），但**没有在游戏里跑过** —— 编译对了不代表画面对了。
模组的 Java 源码通过了语法校验，但因为构建环境拿不到 Fabric 依赖，**没有做过完整编译**。
两者都需要你在本地实测一遍。
