#version 120

#include "/common.glsl"

attribute vec4 mc_Entity;
attribute vec4 mc_midTexCoord;

uniform mat4 gbufferModelView;
uniform mat4 gbufferModelViewInverse;
uniform vec3 cameraPosition;
uniform float frameTimeCounter;

varying vec4 color;
varying vec2 texcoord;
varying vec2 lmcoord;
varying vec3 worldNormal;
varying vec3 worldPos;
varying float isWater;

void main() {
    color = gl_Color;
    texcoord = (gl_TextureMatrix[0] * gl_MultiTexCoord0).st;
    lmcoord = (gl_TextureMatrix[1] * gl_MultiTexCoord1).st;
    lmcoord = clamp((lmcoord - 0.03125) * 1.06667, 0.0, 1.0);

    isWater = (mc_Entity.x > float(BLOCK_WATER) - 0.5 && mc_Entity.x < float(BLOCK_WATER) + 0.5)
            ? 1.0 : 0.0;

    vec3 viewPos = (gl_ModelViewMatrix * gl_Vertex).xyz;
    worldPos = (gbufferModelViewInverse * vec4(viewPos, 1.0)).xyz + cameraPosition;

#ifdef WATER_WAVES
    if (isWater > 0.5) {
        // 只抬高水平面，竖直的水幕不动。Only lift horizontal surfaces; waterfalls stay put.
        vec3 n = normalize(mat3(gbufferModelViewInverse) * (gl_NormalMatrix * gl_Normal));
        if (n.y > 0.5) {
            float t = frameTimeCounter;
            float h = valueNoise(worldPos.xz * 0.55 + vec2(t * 0.32, t * 0.19)) - 0.5;
            h += (valueNoise(worldPos.xz * 1.45 - vec2(t * 0.51, t * 0.28)) - 0.5) * 0.45;
            viewPos += mat3(gbufferModelView) * vec3(0.0, h * 0.09 * WATER_WAVE_HEIGHT, 0.0);
        }
    }
#endif

    gl_Position = gl_ProjectionMatrix * vec4(viewPos, 1.0);
    worldNormal = normalize(mat3(gbufferModelViewInverse) * (gl_NormalMatrix * gl_Normal));
}
