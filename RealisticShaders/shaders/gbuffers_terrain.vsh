#version 120

#include "/common.glsl"

attribute vec4 mc_Entity;
attribute vec4 mc_midTexCoord;
attribute vec4 at_tangent;

uniform mat4 gbufferModelView;
uniform mat4 gbufferModelViewInverse;
uniform vec3 cameraPosition;
uniform float frameTimeCounter;

varying vec4 color;
varying vec2 texcoord;
varying vec2 lmcoord;
varying vec3 worldNormal;
varying vec3 worldTangent;
varying vec3 worldBitangent;
varying float blockId;

/**
 * 风：两个频率不同的噪声叠加，低频是阵风，高频是叶片抖动。
 * Wind: two noise octaves — a slow gust plus a fast per-leaf flutter.
 */
vec3 windOffset(vec3 worldPos, float strength, float verticalBias) {
    float t = frameTimeCounter;
    vec2 p = worldPos.xz * 0.35;
    float gust = valueNoise(p * 0.25 + vec2(t * 0.12, t * 0.09)) - 0.5;
    float flutter = valueNoise(p * 1.7 + vec2(t * 0.9, -t * 0.7)) - 0.5;
    float amount = (gust * 0.75 + flutter * 0.35) * strength;
    return vec3(amount, amount * verticalBias, amount * 0.7);
}

void main() {
    color = gl_Color;
    texcoord = (gl_TextureMatrix[0] * gl_MultiTexCoord0).st;
    lmcoord = (gl_TextureMatrix[1] * gl_MultiTexCoord1).st;
    lmcoord = clamp((lmcoord - 0.03125) * 1.06667, 0.0, 1.0);
    blockId = mc_Entity.x;

    vec3 viewPos = (gl_ModelViewMatrix * gl_Vertex).xyz;
    vec3 worldPos = (gbufferModelViewInverse * vec4(viewPos, 1.0)).xyz + cameraPosition;

#ifdef WAVING_PLANTS
    // 只有顶点在贴图上半部分时才摆动，草根/树干底部保持钉死。
    // Only vertices in the upper half of the sprite sway; the base stays pinned.
    bool upperHalf = gl_MultiTexCoord0.t < mc_midTexCoord.t;
    float strength = 0.0;
    float verticalBias = 0.0;
    if (blockId > float(BLOCK_WAVING_TALL) - 0.5 && blockId < float(BLOCK_WAVING_TALL) + 0.5) {
        strength = upperHalf ? 0.14 : 0.0;
        verticalBias = 0.25;
    } else if (blockId > float(BLOCK_WAVING_SHORT) - 0.5 && blockId < float(BLOCK_WAVING_SHORT) + 0.5) {
        strength = upperHalf ? 0.09 : 0.0;
        verticalBias = 0.2;
    } else if (blockId > float(BLOCK_LEAVES) - 0.5 && blockId < float(BLOCK_LEAVES) + 0.5) {
        strength = 0.06;   // 树叶整块一起晃
        verticalBias = 0.5;
    }
    if (strength > 0.0) {
        vec3 offset = windOffset(worldPos, strength * WAVING_STRENGTH, verticalBias);
        viewPos += mat3(gbufferModelView) * offset;
    }
#endif

    gl_Position = gl_ProjectionMatrix * vec4(viewPos, 1.0);

    mat3 toWorld = mat3(gbufferModelViewInverse);
    worldNormal = normalize(toWorld * (gl_NormalMatrix * gl_Normal));
    worldTangent = normalize(toWorld * (gl_NormalMatrix * at_tangent.xyz));
    worldBitangent = normalize(cross(worldTangent, worldNormal) * sign(at_tangent.w));
}
