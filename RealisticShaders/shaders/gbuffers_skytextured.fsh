#version 120

#include "/common.glsl"

uniform sampler2D texture;
uniform float rainStrength;

varying vec2 texcoord;
varying vec4 color;

/* DRAWBUFFERS:0 */
void main() {
    // 日月贴图。太阳给一点过曝，看起来才像在发光。
    // Sun and moon sprites. The sun is pushed over 1.0 so it actually reads as a light source.
    vec4 tex = texture2D(texture, texcoord) * color;
    if (tex.a < 0.01) discard;
    tex.rgb *= 2.6;
    tex.rgb *= 1.0 - rainStrength * 0.85;
    gl_FragData[0] = tex;
}
