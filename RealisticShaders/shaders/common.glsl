#ifndef COMMON_GLSL
#define COMMON_GLSL

#include "/settings.glsl"

/* ============================================================================
   公共函数：颜色、噪声、天空模型、阴影畸变。
   Shared helpers: colour, noise, sky model, shadow distortion.
   ============================================================================ */

const float PI = 3.14159265;

float luma(vec3 c) {
    return dot(c, vec3(0.2125, 0.7154, 0.0721));
}

vec3 toLinear(vec3 c) {
    return pow(c, vec3(2.2));
}

vec3 toGamma(vec3 c) {
    return pow(max(c, vec3(0.0)), vec3(1.0 / 2.2));
}

/**
 * 八面体法线编码：把单位向量压进两个通道，省出来的通道正好放光照贴图。
 * Octahedral normal encoding — a unit vector in two channels, freeing room for the lightmap.
 */
vec2 encodeNormal(vec3 n) {
    n /= (abs(n.x) + abs(n.y) + abs(n.z) + 1e-6);
    vec2 e = n.xy;
    if (n.z < 0.0) {
        vec2 signs = vec2(n.x >= 0.0 ? 1.0 : -1.0, n.y >= 0.0 ? 1.0 : -1.0);
        e = (1.0 - abs(n.yx)) * signs;
    }
    return e * 0.5 + 0.5;
}

vec3 decodeNormal(vec2 f) {
    f = f * 2.0 - 1.0;
    vec3 n = vec3(f.x, f.y, 1.0 - abs(f.x) - abs(f.y));
    float t = max(-n.z, 0.0);
    n.x += n.x >= 0.0 ? -t : t;
    n.y += n.y >= 0.0 ? -t : t;
    return normalize(n);
}

float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

/** 可微分的值噪声，水波和风都用它。Value noise; drives both wind and water. */
float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash12(i);
    float b = hash12(i + vec2(1.0, 0.0));
    float c = hash12(i + vec2(0.0, 1.0));
    float d = hash12(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

/* -------------------------------------------------------------- 阴影贴图畸变 */

/**
 * 把阴影贴图的分辨率往镜头附近挤 —— 远处本来也看不清阴影边缘。
 * Squeezes shadow map resolution towards the camera; distant shadow edges do not matter.
 */
vec3 distortShadow(vec3 pos) {
    float factor = length(pos.xy) * SHADOW_DISTORTION + (1.0 - SHADOW_DISTORTION);
    return vec3(pos.xy / factor, pos.z * 0.5);
}

/* -------------------------------------------------------------- 天空与光照 */

/** 太阳越低，光越红越弱 —— 大气对蓝光散射得更厉害。Low sun = red and dim: Rayleigh scattering. */
vec3 sunlightColor(float elevation) {
    float horizon = smoothstep(-0.08, 0.30, elevation);
    vec3 low  = vec3(1.00, 0.42, 0.16);   // 地平线：被散射掉了蓝绿
    vec3 mid  = vec3(1.00, 0.78, 0.55);
    vec3 high = vec3(1.00, 0.97, 0.92);
    vec3 c = mix(low, mid, smoothstep(0.0, 0.14, elevation));
    c = mix(c, high, smoothstep(0.12, 0.42, elevation));
    return c * horizon;
}

vec3 moonlightColor() {
    return vec3(0.34, 0.44, 0.72);
}

/** 白天程度：日出前后有一段平滑过渡。How "day" it is, with a smooth twilight ramp. */
float dayFactor(float sunElevation) {
    return smoothstep(-0.12, 0.12, sunElevation);
}

/** 主光源颜色（太阳或月亮）。Colour of whichever body is casting shadows. */
vec3 directLightColor(float sunElevation) {
    float day = dayFactor(sunElevation);
    vec3 sun = sunlightColor(sunElevation) * SUN_INTENSITY;
    vec3 moon = moonlightColor() * 0.18 * MOON_INTENSITY;
    return mix(moon, sun, day);
}

/** 天空的环境光（打在阴影里的部分）。Ambient sky light — what fills the shadows. */
vec3 ambientSkyColor(float sunElevation) {
    float day = dayFactor(sunElevation);
    vec3 nightAmbient = vec3(0.055, 0.075, 0.135);
    vec3 duskAmbient  = vec3(0.30, 0.24, 0.26);
    vec3 dayAmbient   = vec3(0.46, 0.58, 0.80);
    vec3 c = mix(nightAmbient, duskAmbient, smoothstep(-0.12, 0.06, sunElevation));
    c = mix(c, dayAmbient, smoothstep(0.04, 0.30, sunElevation));
    return c * SKY_BRIGHTNESS * mix(0.9, 1.0, day);
}

/**
 * 解析式天空：天顶深、地平线亮，加上太阳/月亮的辉光。
 * Analytic sky: deep zenith, bright horizon, plus the glow around sun and moon.
 */
vec3 skyColor(vec3 viewDir, vec3 sunDir, float sunElevation) {
    float up = clamp(viewDir.y, -1.0, 1.0);
    float horizonBlend = pow(1.0 - clamp(up, 0.0, 1.0), 3.5);

    vec3 zenithDay   = vec3(0.16, 0.34, 0.72);
    vec3 horizonDay  = vec3(0.62, 0.76, 0.94);
    vec3 zenithDusk  = vec3(0.10, 0.13, 0.30);
    vec3 horizonDusk = vec3(0.95, 0.45, 0.20);
    vec3 zenithNight = vec3(0.014, 0.022, 0.055);
    vec3 horizonNight= vec3(0.045, 0.060, 0.115);

    float dusk = 1.0 - smoothstep(0.02, 0.28, abs(sunElevation));
    float day = dayFactor(sunElevation);

    vec3 zenith = mix(zenithNight, zenithDay, day);
    vec3 horizon = mix(horizonNight, horizonDay, day);
    zenith = mix(zenith, zenithDusk, dusk * day);
    horizon = mix(horizon, horizonDusk, dusk);

    vec3 sky = mix(zenith, horizon, horizonBlend);

    // 太阳辉光。Sun glow.
    float sunDot = max(dot(normalize(viewDir), sunDir), 0.0);
    float glow = pow(sunDot, 12.0) * 0.55 + pow(sunDot, 220.0) * 2.2;
    sky += sunlightColor(sunElevation) * glow * day;

    // 月亮辉光。Moon glow.
    float moonDot = max(dot(normalize(viewDir), -sunDir), 0.0);
    sky += moonlightColor() * pow(moonDot, 90.0) * 0.35 * (1.0 - day) * MOON_INTENSITY;

    // 地平线以下逐渐压暗，避免看到硬边。Fade below the horizon so there is no hard seam.
    sky *= mix(0.35, 1.0, smoothstep(-0.25, 0.02, up));

    return sky * SKY_BRIGHTNESS;
}

/* -------------------------------------------------------------- 色调映射 */

/** ACES filmic 近似（Narkowicz 拟合）。ACES filmic approximation. */
vec3 acesTonemap(vec3 x) {
    const float a = 2.51;
    const float b = 0.03;
    const float c = 2.43;
    const float d = 0.59;
    const float e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

vec3 reinhardTonemap(vec3 x) {
    return x / (1.0 + x);
}

/* -------------------------------------------------------------- PBR */

/** Schlick 菲涅耳。Schlick's Fresnel approximation. */
vec3 fresnelSchlick(float cosTheta, vec3 f0) {
    return f0 + (1.0 - f0) * pow(1.0 - clamp(cosTheta, 0.0, 1.0), 5.0);
}

/** GGX 法线分布。GGX normal distribution. */
float distributionGGX(float nDotH, float roughness) {
    float a = roughness * roughness;
    float a2 = a * a;
    float d = nDotH * nDotH * (a2 - 1.0) + 1.0;
    return a2 / max(PI * d * d, 1e-5);
}

/** Smith 几何遮蔽（Schlick-GGX，IBL 版 k）。Smith geometry term. */
float geometrySmith(float nDotV, float nDotL, float roughness) {
    float r = roughness + 1.0;
    float k = (r * r) / 8.0;
    float gv = nDotV / (nDotV * (1.0 - k) + k);
    float gl = nDotL / (nDotL * (1.0 - k) + k);
    return gv * gl;
}

#endif
