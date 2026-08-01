#version 120

#include "/common.glsl"

attribute vec4 mc_Entity;
attribute vec4 mc_midTexCoord;

uniform float frameTimeCounter;
uniform vec3 cameraPosition;
uniform mat4 shadowModelViewInverse;

varying vec2 texcoord;
varying vec4 color;

void main() {
    texcoord = (gl_TextureMatrix[0] * gl_MultiTexCoord0).st;
    color = gl_Color;

    vec4 position = gl_ModelViewMatrix * gl_Vertex;

#ifdef WAVING_PLANTS
    // 影子必须跟着一起摆，否则草晃了影子不动，穿帮得很明显。
    // Shadows must sway too, or the grass moves while its shadow does not.
    float id = mc_Entity.x;
    bool upperHalf = gl_MultiTexCoord0.t < mc_midTexCoord.t;
    float strength = 0.0;
    if (id > float(BLOCK_WAVING_TALL) - 0.5 && id < float(BLOCK_WAVING_TALL) + 0.5) {
        strength = upperHalf ? 0.14 : 0.0;
    } else if (id > float(BLOCK_WAVING_SHORT) - 0.5 && id < float(BLOCK_WAVING_SHORT) + 0.5) {
        strength = upperHalf ? 0.09 : 0.0;
    } else if (id > float(BLOCK_LEAVES) - 0.5 && id < float(BLOCK_LEAVES) + 0.5) {
        strength = 0.06;
    }
    if (strength > 0.0) {
        vec3 worldPos = (shadowModelViewInverse * position).xyz + cameraPosition;
        float t = frameTimeCounter;
        vec2 p = worldPos.xz * 0.35;
        float gust = valueNoise(p * 0.25 + vec2(t * 0.12, t * 0.09)) - 0.5;
        float flutter = valueNoise(p * 1.7 + vec2(t * 0.9, -t * 0.7)) - 0.5;
        float amount = (gust * 0.75 + flutter * 0.35) * strength * WAVING_STRENGTH;
        vec3 offsetWorld = vec3(amount, amount * 0.25, amount * 0.7);
        position.xyz += mat3(gl_ModelViewMatrix) * (mat3(shadowModelViewInverse) * offsetWorld);
    }
#endif

    vec4 clip = gl_ProjectionMatrix * position;
    clip.xyz = distortShadow(clip.xyz / clip.w) * clip.w;
    gl_Position = clip;
}
