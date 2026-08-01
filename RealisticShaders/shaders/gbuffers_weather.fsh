#version 120

#include "/common.glsl"

uniform sampler2D texture;
uniform mat4 gbufferModelViewInverse;
uniform vec3 sunPosition;

varying vec2 texcoord;
varying vec2 lmcoord;
varying vec4 color;

/* DRAWBUFFERS:0 */
void main() {
    vec4 drop = texture2D(texture, texcoord) * color;
    if (drop.a < 0.01) discard;

    float sunElevation = normalize(mat3(gbufferModelViewInverse) * sunPosition).y;
    // 雨丝本身几乎不反光，靠环境光和天空色显形。
    // Rain streaks barely reflect; they read against the sky.
    vec3 light = ambientSkyColor(sunElevation) * (0.35 + lmcoord.y * 0.8)
               + vec3(1.0, 0.62, 0.32) * lmcoord.x * lmcoord.x * 0.6;
    drop.rgb *= light;
    drop.a *= 0.65;

    gl_FragData[0] = drop;
}
