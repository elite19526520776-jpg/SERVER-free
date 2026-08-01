#version 120

#include "/common.glsl"

uniform sampler2D texture;

varying vec4 color;
varying vec2 texcoord;
varying vec2 lmcoord;
varying vec3 worldNormal;

/* DRAWBUFFERS:012 */
void main() {
    vec4 albedo = texture2D(texture, texcoord) * color;
    if (albedo.a < 0.01) discard;

    gl_FragData[0] = albedo;
    gl_FragData[1] = vec4(encodeNormal(worldNormal), lmcoord.x, lmcoord.y);
    gl_FragData[2] = vec4(0.05, 0.04, 0.0, 1.0);   // 粗糙、非金属、不自发光、参与光照
}
