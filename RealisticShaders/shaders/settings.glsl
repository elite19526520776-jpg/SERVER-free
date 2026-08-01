#ifndef SETTINGS_GLSL
#define SETTINGS_GLSL

/* ============================================================================
   Realistic Shaders —— 所有可调项都在这里，游戏内「光影设置」界面读的也是这些。
   Every tunable lives here; the in-game shader options screen reads these too.
   ============================================================================ */

// ---------------------------------------------------------------- 缓冲区格式
const int colortex0Format = RGBA16F;   // 场景颜色 HDR / scene colour
const int colortex1Format = RGBA16F;   // 法线 + 材质标记 / normal + material flag
const int colortex2Format = RGBA8;     // 光滑度 / F0 / 自发光 / 天光
const int colortex3Format = RGB16F;    // 泛光乒乓 A / bloom ping
const int colortex4Format = RGB16F;    // 泛光乒乓 B / bloom pong

// ---------------------------------------------------------------- 阴影
const int shadowMapResolution = 2048;  // [512 1024 2048 3072 4096]
const float shadowDistance = 128.0;    // [64.0 96.0 128.0 192.0 256.0]
const float sunPathRotation = -30.0;   // [-50.0 -40.0 -30.0 -20.0 -10.0 0.0 10.0 20.0 30.0 40.0 50.0]
const bool shadowHardwareFiltering = false;
const float ambientOcclusionLevel = 0.5;

// 阴影贴图畸变：把分辨率集中到镜头附近。Shadow distortion concentrates resolution near the camera.
#define SHADOW_DISTORTION 0.85         // [0.0 0.6 0.75 0.85 0.92]

// PCF 半径，越大越柔和。PCF radius; bigger is softer.
#define SHADOW_SOFTNESS 1.1            // [0.0 0.6 1.1 1.8 2.6]

// PCF 采样环数，(2N+1)^2 次采样。Rings of PCF taps -> (2N+1)^2 samples.
#define SHADOW_SAMPLES 2               // [1 2 3]

#define SHADOW_BIAS 0.00035            // [0.0002 0.00035 0.0006 0.001]

// ---------------------------------------------------------------- 环境光遮蔽
#define SSAO                           // 屏幕空间环境光遮蔽 / screen-space ambient occlusion
#define SSAO_SAMPLES 10                // [6 10 16 24]
#define SSAO_RADIUS 0.75               // [0.4 0.75 1.2 2.0]
#define SSAO_STRENGTH 1.0              // [0.5 0.75 1.0 1.5 2.0]

// ---------------------------------------------------------------- PBR
// 读取资源包的 LabPBR 法线/高光贴图。Read LabPBR normal & specular maps from the resource pack.
#define LABPBR
#define NORMAL_STRENGTH 1.0            // [0.0 0.5 1.0 1.5 2.0]
#define SPECULAR_STRENGTH 1.0          // [0.0 0.5 1.0 1.5 2.0]
#define EMISSIVE_STRENGTH 2.5          // [0.0 1.0 2.5 4.0 6.0]

// ---------------------------------------------------------------- 大气
#define FOG                            // 大气雾 / atmospheric fog
#define FOG_DENSITY 1.0                // [0.0 0.5 1.0 1.5 2.5]
#define SKY_BRIGHTNESS 1.0             // [0.6 0.8 1.0 1.3 1.6]
#define SUN_INTENSITY 1.0              // [0.6 0.8 1.0 1.3 1.8]
#define MOON_INTENSITY 1.0             // [0.0 0.5 1.0 1.5 2.5]

// ---------------------------------------------------------------- 植被与水
#define WAVING_PLANTS                  // 草木随风摆动 / wind sway
#define WAVING_STRENGTH 1.0            // [0.0 0.5 1.0 1.5 2.0]

#define WATER_WAVES                    // 水面起伏 / water surface waves
#define WATER_WAVE_HEIGHT 1.0          // [0.0 0.5 1.0 1.6 2.4]
#define WATER_REFLECTION 1.0           // [0.0 0.5 1.0]
#define WATER_ABSORPTION 1.0           // [0.0 0.5 1.0 1.6]

// ---------------------------------------------------------------- 后期
#define BLOOM
#define BLOOM_STRENGTH 0.55            // [0.0 0.25 0.4 0.55 0.8 1.2]
#define BLOOM_RADIUS 1.6               // [0.8 1.2 1.6 2.4 3.5]

#define TONEMAP_ACES                   // ACES 电影级色调映射 / filmic tonemapping
#define EXPOSURE 1.0                   // [0.6 0.8 1.0 1.25 1.6]
#define CONTRAST 1.06                  // [0.9 1.0 1.06 1.15 1.3]
#define SATURATION 1.08                // [0.7 0.9 1.0 1.08 1.25 1.5]
#define VIGNETTE 0.35                  // [0.0 0.2 0.35 0.55 0.8]
#define SHARPEN 0.35                   // [0.0 0.2 0.35 0.6]
#define DITHERING                      // 抵消 8bit 色带 / kills 8-bit banding

// ---------------------------------------------------------------- 方块 ID
// 与 block.properties 对应。Must match block.properties.
#define BLOCK_WAVING_TALL   10
#define BLOCK_WAVING_SHORT  11
#define BLOCK_LEAVES        12
#define BLOCK_WATER         13

#endif
