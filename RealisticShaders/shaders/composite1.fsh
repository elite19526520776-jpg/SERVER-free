#version 120

#include "/common.glsl"

uniform sampler2D colortex3;
uniform float viewWidth;

varying vec2 texcoord;

/* DRAWBUFFERS:4 */
void main() {
    // 可分离高斯，水平方向。Separable gaussian, horizontal pass.
    float texel = BLOOM_RADIUS / viewWidth;
    const float w0 = 0.2270270270;
    const float w1 = 0.1945945946;
    const float w2 = 0.1216216216;
    const float w3 = 0.0540540541;
    const float w4 = 0.0162162162;

    vec3 sum = texture2D(colortex3, texcoord).rgb * w0;
    sum += texture2D(colortex3, texcoord + vec2(texel * 1.3846, 0.0)).rgb * w1;
    sum += texture2D(colortex3, texcoord - vec2(texel * 1.3846, 0.0)).rgb * w1;
    sum += texture2D(colortex3, texcoord + vec2(texel * 3.2308, 0.0)).rgb * w2;
    sum += texture2D(colortex3, texcoord - vec2(texel * 3.2308, 0.0)).rgb * w2;
    sum += texture2D(colortex3, texcoord + vec2(texel * 5.1765, 0.0)).rgb * w3;
    sum += texture2D(colortex3, texcoord - vec2(texel * 5.1765, 0.0)).rgb * w3;
    sum += texture2D(colortex3, texcoord + vec2(texel * 7.1250, 0.0)).rgb * w4;
    sum += texture2D(colortex3, texcoord - vec2(texel * 7.1250, 0.0)).rgb * w4;

    gl_FragData[0] = vec4(sum, 1.0);
}
