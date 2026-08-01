#version 120

uniform sampler2D texture;

varying vec4 color;
varying vec2 texcoord;

/* DRAWBUFFERS:0 */
void main() {
    vec4 albedo = texture2D(texture, texcoord) * color;
    if (albedo.a < 0.01) discard;
    gl_FragData[0] = albedo;
}
