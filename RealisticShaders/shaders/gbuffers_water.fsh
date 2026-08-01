#version 120

#include "/common.glsl"
#include "/shadowing.glsl"

uniform sampler2D texture;
uniform mat4 gbufferModelViewInverse;
uniform vec3 sunPosition;
uniform vec3 shadowLightPosition;
uniform vec3 cameraPosition;
uniform float frameTimeCounter;
uniform float rainStrength;
uniform int isEyeInWater;

varying vec4 color;
varying vec2 texcoord;
varying vec2 lmcoord;
varying vec3 worldNormal;
varying vec3 worldPos;
varying float isWater;

/** 用波浪函数的有限差分求法线，比法线贴图便宜也更贴合起伏。Finite-difference wave normal. */
vec3 waveNormal(vec2 p) {
    float t = frameTimeCounter;
    float e = 0.09;
    vec2 s1 = vec2(t * 0.32, t * 0.19);
    vec2 s2 = -vec2(t * 0.51, t * 0.28);
    float hC = valueNoise(p * 0.55 + s1) + valueNoise(p * 1.45 + s2) * 0.45;
    float hX = valueNoise((p + vec2(e, 0.0)) * 0.55 + s1) + valueNoise((p + vec2(e, 0.0)) * 1.45 + s2) * 0.45;
    float hZ = valueNoise((p + vec2(0.0, e)) * 0.55 + s1) + valueNoise((p + vec2(0.0, e)) * 1.45 + s2) * 0.45;
    float scale = 1.4 * WATER_WAVE_HEIGHT;
    return normalize(vec3(-(hX - hC) * scale, e, -(hZ - hC) * scale));
}

/* DRAWBUFFERS:0 */
void main() {
    vec4 albedo = texture2D(texture, texcoord) * color;
    if (albedo.a < 0.01) discard;

    vec3 sunDir = normalize(mat3(gbufferModelViewInverse) * sunPosition);
    vec3 lightDir = normalize(mat3(gbufferModelViewInverse) * shadowLightPosition);
    float sunElevation = sunDir.y;

    vec3 normal = worldNormal;
    if (isWater > 0.5 && worldNormal.y > 0.5) {
        normal = waveNormal(worldPos.xz);
    }

    vec3 playerPos = worldPos - cameraPosition;
    vec3 viewDir = normalize(-playerPos);

    float nDotL = dot(normal, lightDir);
    vec3 shadow = sampleShadow(playerPos, normal, nDotL);
    shadow *= smoothstep(0.0, 0.22, lmcoord.y);

    vec3 lightColor = directLightColor(sunElevation);
    vec3 ambient = ambientSkyColor(sunElevation) * (0.25 + lmcoord.y * lmcoord.y * 0.9);
    vec3 blockLight = vec3(1.0, 0.60, 0.30) * lmcoord.x * lmcoord.x * 1.7;

    vec3 lit = albedo.rgb * (ambient + blockLight + lightColor * max(nDotL, 0.0) * shadow);

    if (isWater > 0.5) {
        // 菲涅耳：正对着看水是透的，斜着看几乎全是反射。
        // Fresnel: water is clear head-on and a mirror at grazing angles.
        float fresnel = pow(1.0 - clamp(dot(normal, viewDir), 0.0, 1.0), 5.0);
        fresnel = mix(0.02, 1.0, fresnel) * WATER_REFLECTION;

        vec3 reflectDir = reflect(-viewDir, normal);
        vec3 reflection = skyColor(reflectDir, sunDir, sunElevation);
        reflection = mix(reflection, vec3(luma(reflection)) * 0.6, rainStrength * 0.6);

        // 太阳在水面的镜面高光。The sun's glint on the surface.
        float glint = pow(max(dot(reflectDir, lightDir), 0.0), 320.0);
        reflection += lightColor * glint * 14.0 * shadow;

        lit = mix(lit, reflection, fresnel * (1.0 - float(isEyeInWater)));
        albedo.a = mix(albedo.a, 1.0, fresnel * 0.75);
        albedo.a = clamp(albedo.a * (0.55 + 0.45 * WATER_ABSORPTION), 0.0, 1.0);
    }

    gl_FragData[0] = vec4(lit, albedo.a);
}
