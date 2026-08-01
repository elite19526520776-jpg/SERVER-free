# Realistic Shaders / 写实光影包

给 Iris 和 OptiFine 用的光影包。延迟着色管线，带阴影贴图、SSAO、LabPBR 材质、物理天空、
水面反射和 ACES 电影级色调映射。

A shader pack for Iris and OptiFine: deferred pipeline with shadow mapping, SSAO, LabPBR
materials, an analytic sky, water reflections and ACES filmic tonemapping.

---

## 安装 / Install

1. 装 **[Iris](https://irisshaders.dev/)**（推荐，配 Sodium 性能好）或 **OptiFine**
2. 把这个文件夹（或它的 zip）丢进 `.minecraft/shaderpacks/`
3. 游戏里 **选项 → 光影** 选中它

配套材质包在 [`RealisticTextures`](../RealisticTextures) —— 它提供本光影读取的法线和高光图。
不装也能跑，只是所有表面都是平的。

---

## 效果 / What you get

**光照**
- 2048×（可调到 4096×）阴影贴图，PCF 软阴影，向摄像机方向做分辨率畸变
- **彩色阴影**：光穿过染色玻璃会带上颜色
- 屏幕空间环境光遮蔽，每像素旋转采样把条带换成噪点
- 用天光值封住阳光，防止光从墙缝漏进室内

**材质 (LabPBR 1.3)**
- 法线贴图、感知光滑度、F0/金属度、自发光
- GGX 高光 + Smith 几何遮蔽 + Schlick 菲涅耳
- 金属用反照率当 F0 并压掉漫反射，所以铁块看起来是金属而不是灰色塑料

**大气**
- 解析式天空：天顶/地平线随时间渐变，日出日落变橙红（低角度阳光被散射掉蓝光）
- 程序化星空，只在夜里出现，下雨时被云遮住
- 云和雨丝按当前光色着色
- 距离雾用天空颜色，下雨时加浓

**水**
- 顶点位移的波浪（只抬平面，瀑布不动）
- 波形有限差分求法线，比法线贴图更贴合起伏
- 菲涅耳：正视清澈、斜视成镜，加太阳镜面闪光
- 水下红光先衰减，越深越蓝

**植被**
- 低频阵风 + 高频叶抖，两层噪声叠加
- **影子跟着一起摆**（不然草晃了影子不动，很出戏）

**后期**
- 亮部提取 + 可分离高斯泛光
- ACES filmic 色调映射（可切 Reinhard）
- 曝光、对比度、饱和度、暗角、锐化、抖动

全部可以在游戏内 **光影设置** 里调，分 6 个页签，中英文都有。

---

## 管线结构 / Pipeline

```
shadow                    投影深度 + 颜色（彩色阴影用）
  ↓
gbuffers_terrain          不透明地形：风摆、LabPBR 采样
gbuffers_entities/hand    实体与手持
gbuffers_skybasic         解析天空 + 星空
gbuffers_clouds/weather   云、雨雪
  ↓
deferred                  阴影 + SSAO + PBR 光照 + 雾   → colortex0
  ↓
gbuffers_water            半透明前向着色：波浪、菲涅耳、天空反射
  ↓
composite                 亮部提取                      → colortex3
composite1                高斯模糊（水平）              → colortex4
composite2                高斯模糊（竖直）              → colortex3
  ↓
final                     泛光合成 + 色调映射 + 调色
```

### 缓冲区布局 / Buffer layout

| 缓冲区 | 格式 | 内容 |
|---|---|---|
| colortex0 | RGBA16F | 场景颜色（HDR） |
| colortex1 | RGBA16F | RG = 八面体编码法线，B = 方块光，A = 天光 |
| colortex2 | RGBA8 | R = 光滑度，G = F0，B = 自发光，**A = 材质标记** |
| colortex3 / 4 | RGB16F | 泛光乒乓缓冲 |

法线用**八面体编码**压进两个通道，省出来的位置正好放光照贴图，两张缓冲就够了。

`colortex2.a` 是关键：默认清空成 0，表示「这个像素已经着好色了」（天空、云、准星），
`deferred` 会原样放行；写 1.0 的才走光照。这样天空不会被当成几何体去打光。

---

## 校验 / Validating changes

改完着色器可以先用 glslang 编译一遍，比开游戏快得多：

```bash
sudo apt-get install glslang-tools
python3 tools/validate_shaders.py
```

脚本会展开 `#include`、补上 `RGBA16F` 之类 OptiFine 专有的常量名，然后逐个丢给
`glslangValidator`。当前 34 个着色器全部通过。

编译通过 ≠ 画面正确 —— 语法和类型对了，但采样逻辑、矩阵空间、混合顺序这些还是得进游戏看。

---

## 性能 / Performance

默认配置面向中端显卡。跑不动的话按这个顺序砍：

1. `shadowMapResolution` 2048 → 1024（省最多）
2. `SHADOW_SAMPLES` 2 → 1（PCF 采样从 25 次降到 9 次）
3. `shadowDistance` 128 → 96
4. `SSAO` 关掉，或 `SSAO_SAMPLES` 10 → 6
5. `BLOOM` 关掉 —— 关掉后整条 composite 链会被跳过，不只是不显示

---

## 已知限制 / Known limitations

- 没有屏幕空间反射（SSR）。水面反射的是解析天空，不是实际场景，所以水里照不出岸边的树。
- 没有体积光（god rays）和体积雾。
- 没有视差遮蔽映射（POM），高度图目前只用来生成法线和 AO。
- 末地和下界只做了基本适配，天空模型是按主世界调的。

---

## License

MIT
