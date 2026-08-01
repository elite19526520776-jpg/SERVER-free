#version 120

#include "/common.glsl"

uniform mat4 gbufferModelViewInverse;
uniform vec3 sunPosition;
uniform float rainStrength;

varying vec3 worldDir;

/** 程序化星空：只在天黑时出现，且被雨云挡住。Procedural stars: night only, hidden by rain. */
float stars(vec3 dir) {
    vec3 p = normalize(dir) * 190.0;
    vec3 cell = floor(p);
    // 每个格子最多一颗星，位置随机决定亮不亮。One star per cell at most.
    float rnd = hash12(cell.xy + cell.z * 37.0);
    if (rnd < 0.9955) return 0.0;
    vec3 offset = fract(p) - 0.5;
    float d = length(offset);
    return smoothstep(0.34, 0.0, d) * (0.4 + rnd);
}

/* DRAWBUFFERS:0 */
void main() {
    vec3 dir = normalize(worldDir);
    vec3 sunDir = normalize(mat3(gbufferModelViewInverse) * sunPosition);
    float sunElevation = sunDir.y;

    vec3 sky = skyColor(dir, sunDir, sunElevation);

    float night = 1.0 - dayFactor(sunElevation);
    sky += vec3(0.85, 0.90, 1.0) * stars(dir) * night * (1.0 - rainStrength) * 1.6;

    // 下雨时天空整体去饱和压暗。Rain desaturates and dims the whole sky.
    sky = mix(sky, vec3(luma(sky)) * 0.55, rainStrength * 0.75);

    gl_FragData[0] = vec4(sky, 1.0);
}
