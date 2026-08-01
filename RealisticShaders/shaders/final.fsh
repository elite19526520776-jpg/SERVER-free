#version 120

#include "/common.glsl"

uniform sampler2D colortex0;
uniform sampler2D colortex3;
uniform float viewWidth;
uniform float viewHeight;
uniform float frameTimeCounter;
uniform int isEyeInWater;

varying vec2 texcoord;

void main() {
    vec3 color = texture2D(colortex0, texcoord).rgb;

#ifdef SHARPEN
    // 反锐化掩模：抵消色调映射带来的发糊。Unsharp mask; counteracts tonemapping softness.
    if (SHARPEN > 0.0) {
        vec2 texel = vec2(1.0 / viewWidth, 1.0 / viewHeight);
        vec3 blur = texture2D(colortex0, texcoord + vec2(texel.x, 0.0)).rgb
                  + texture2D(colortex0, texcoord - vec2(texel.x, 0.0)).rgb
                  + texture2D(colortex0, texcoord + vec2(0.0, texel.y)).rgb
                  + texture2D(colortex0, texcoord - vec2(0.0, texel.y)).rgb;
        color += (color - blur * 0.25) * SHARPEN;
    }
#endif

#ifdef BLOOM
    color += texture2D(colortex3, texcoord).rgb * BLOOM_STRENGTH;
#endif

    color *= EXPOSURE;

    if (isEyeInWater == 1) {
        color *= vec3(0.62, 0.86, 1.0);
    } else if (isEyeInWater == 2) {
        color *= vec3(1.6, 0.55, 0.2);   // 熔岩里
    }

#ifdef TONEMAP_ACES
    color = acesTonemap(color);
#else
    color = reinhardTonemap(color);
#endif

    color = toGamma(color);

    // 对比度与饱和度。Contrast and saturation, in that order.
    color = clamp((color - 0.5) * CONTRAST + 0.5, 0.0, 1.0);
    color = clamp(mix(vec3(luma(color)), color, SATURATION), 0.0, 1.0);

#ifdef VIGNETTE
    if (VIGNETTE > 0.0) {
        vec2 centered = texcoord - 0.5;
        float v = 1.0 - dot(centered, centered) * VIGNETTE * 1.6;
        color *= clamp(v, 0.0, 1.0);
    }
#endif

#ifdef DITHERING
    // 抖动：8bit 输出的色带靠这一点噪声抹平。A pinch of noise hides 8-bit banding.
    float noise = hash12(gl_FragCoord.xy + fract(frameTimeCounter) * 137.0);
    color += (noise - 0.5) / 255.0;
#endif

    gl_FragColor = vec4(color, 1.0);
}
