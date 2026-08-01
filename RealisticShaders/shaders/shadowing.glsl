#ifndef SHADOWING_GLSL
#define SHADOWING_GLSL

#include "/common.glsl"

uniform sampler2D shadowtex0;   // 所有投影物 / every caster
uniform sampler2D shadowtex1;   // 仅不透明投影物 / opaque casters only
uniform sampler2D shadowcolor0; // 半透明投影物的颜色 / tint from translucent casters
uniform mat4 shadowModelView;
uniform mat4 shadowProjection;

/**
 * PCF 采样，并且支持彩色阴影：光穿过染色玻璃时会带上颜色。
 * PCF shadows with colour: light through stained glass picks up its tint.
 *
 * playerPos 是相对摄像机的世界坐标（即 worldPos - cameraPosition）。
 * playerPos is world space relative to the camera.
 */
vec3 sampleShadow(vec3 playerPos, vec3 normal, float nDotL) {
    if (nDotL <= 0.0) {
        return vec3(0.0);
    }

    // 沿法线推一点，最省事的自阴影痤疮解法。Normal offset — the cheapest acne fix there is.
    vec3 offsetPos = playerPos + normal * (0.05 + (1.0 - nDotL) * 0.12);

    vec4 shadowClip = shadowProjection * (shadowModelView * vec4(offsetPos, 1.0));
    vec3 ndc = shadowClip.xyz / shadowClip.w;
    vec3 sp = distortShadow(ndc) * 0.5 + 0.5;

    // 超出阴影贴图范围就当作被照亮，否则远处会出现一圈黑边。
    // Outside the shadow map counts as lit, otherwise distance gets a black ring.
    if (sp.x <= 0.001 || sp.x >= 0.999 || sp.y <= 0.001 || sp.y >= 0.999 || sp.z >= 1.0) {
        return vec3(1.0);
    }

    float bias = SHADOW_BIAS * (1.0 + (1.0 - nDotL) * 4.0);
    float z = sp.z - bias;
    vec2 texel = vec2(SHADOW_SOFTNESS / float(shadowMapResolution));

    vec3 accum = vec3(0.0);
    float total = 0.0;
    for (int y = -SHADOW_SAMPLES; y <= SHADOW_SAMPLES; y++) {
        for (int x = -SHADOW_SAMPLES; x <= SHADOW_SAMPLES; x++) {
            vec2 uv = sp.xy + vec2(float(x), float(y)) * texel;
            float opaqueDepth = texture2D(shadowtex1, uv).x;
            if (opaqueDepth < z) {
                accum += vec3(0.0);                              // 被实心物体挡住
            } else {
                float anyDepth = texture2D(shadowtex0, uv).x;
                if (anyDepth < z) {
                    accum += texture2D(shadowcolor0, uv).rgb;    // 只被半透明物体挡住 -> 染色
                } else {
                    accum += vec3(1.0);
                }
            }
            total += 1.0;
        }
    }
    return accum / total;
}

#endif
