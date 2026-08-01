#version 120

#include "/common.glsl"

uniform sampler2D colortex0;

varying vec2 texcoord;

/* DRAWBUFFERS:3 */
void main() {
    vec3 color = texture2D(colortex0, texcoord).rgb;

#ifdef BLOOM
    // 亮部提取：只有超过阈值的部分才会晕开。Bright pass — only what is over threshold blooms.
    float brightness = luma(color);
    float threshold = 1.0;
    float knee = 0.6;
    float contribution = clamp((brightness - threshold + knee) / (2.0 * knee), 0.0, 1.0);
    contribution *= contribution;
    gl_FragData[0] = vec4(color * contribution, 1.0);
#else
    gl_FragData[0] = vec4(0.0, 0.0, 0.0, 1.0);
#endif
}
