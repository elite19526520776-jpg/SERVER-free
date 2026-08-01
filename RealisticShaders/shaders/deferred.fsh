#version 120

#include "/common.glsl"
#include "/shadowing.glsl"

uniform sampler2D colortex0;   // 反照率 / albedo
uniform sampler2D colortex1;   // 法线 + 光照贴图 / normal + lightmap
uniform sampler2D colortex2;   // 光滑度 / F0 / 自发光 / 材质标记
uniform sampler2D depthtex0;

uniform mat4 gbufferProjection;
uniform mat4 gbufferModelView;
uniform mat4 gbufferProjectionInverse;
uniform mat4 gbufferModelViewInverse;
uniform vec3 sunPosition;
uniform vec3 shadowLightPosition;
uniform vec3 cameraPosition;
uniform float viewWidth;
uniform float viewHeight;
uniform float far;
uniform float rainStrength;
uniform float frameTimeCounter;
uniform int isEyeInWater;

varying vec2 texcoord;

vec3 viewFromDepth(vec2 uv, float depth) {
    vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 view = gbufferProjectionInverse * ndc;
    return view.xyz / view.w;
}

#ifdef SSAO
/**
 * 屏幕空间环境光遮蔽：在半球里撒点，看有多少落在几何体内部。
 * SSAO: scatter points in a hemisphere and count how many land inside geometry.
 */
float computeSSAO(vec2 uv, vec3 viewPos, vec3 viewNormal) {
    float occlusion = 0.0;
    float radius = SSAO_RADIUS;
    // 每像素旋转，把带状条纹换成噪点 —— 噪点看着比条纹自然得多。
    // Per-pixel rotation turns banding into noise, which reads far better.
    float angleOffset = hash12(uv * vec2(viewWidth, viewHeight)) * 6.2831853;

    for (int i = 0; i < SSAO_SAMPLES; i++) {
        float t = (float(i) + 0.5) / float(SSAO_SAMPLES);
        float angle = angleOffset + t * 6.2831853 * 3.0;
        float r = radius * sqrt(t);
        vec3 samplePos = viewPos + vec3(cos(angle) * r, sin(angle) * r, 0.0);
        // 推到法线朝向的半球里。Push into the hemisphere facing the normal.
        samplePos += viewNormal * r * 0.5;

        vec4 clip = gbufferProjection * vec4(samplePos, 1.0);
        vec2 sampleUv = (clip.xy / clip.w) * 0.5 + 0.5;
        if (sampleUv.x < 0.0 || sampleUv.x > 1.0 || sampleUv.y < 0.0 || sampleUv.y > 1.0) {
            continue;
        }
        float sampleDepth = texture2D(depthtex0, sampleUv).x;
        vec3 sampleView = viewFromDepth(sampleUv, sampleDepth);

        float diff = sampleView.z - samplePos.z;
        if (diff > 0.02) {
            // 距离衰减，避免远处的墙给近处打上假阴影。
            // Range check stops a distant wall from shading a near surface.
            float rangeFade = clamp(radius / max(abs(viewPos.z - sampleView.z), 1e-4), 0.0, 1.0);
            occlusion += rangeFade;
        }
    }
    occlusion /= float(SSAO_SAMPLES);
    return clamp(1.0 - occlusion * SSAO_STRENGTH, 0.0, 1.0);
}
#endif

/* DRAWBUFFERS:0 */
void main() {
    vec3 albedo = texture2D(colortex0, texcoord).rgb;
    vec4 material = texture2D(colortex2, texcoord);

    // 材质标记为 0 的（天空、云、UI 线框）已经着好色了，直接放行。
    // A material flag of 0 means "already shaded" — sky, clouds, wireframes.
    if (material.a < 0.5) {
        gl_FragData[0] = vec4(albedo, 1.0);
        return;
    }

    vec4 normalData = texture2D(colortex1, texcoord);
    vec3 normal = decodeNormal(normalData.rg);
    float blockLight = normalData.b;
    float skyLight = normalData.a;

    float smoothness = material.r;
    float f0 = material.g;
    float emissive = material.b;

    float depth = texture2D(depthtex0, texcoord).x;
    vec3 viewPos = viewFromDepth(texcoord, depth);
    vec3 playerPos = (gbufferModelViewInverse * vec4(viewPos, 1.0)).xyz;
    float dist = length(viewPos);

    vec3 sunDir = normalize(mat3(gbufferModelViewInverse) * sunPosition);
    vec3 lightDir = normalize(mat3(gbufferModelViewInverse) * shadowLightPosition);
    float sunElevation = sunDir.y;

    vec3 viewDirWorld = normalize(-playerPos);

    // ---------------------------------------------------------------- 直接光
    float nDotL = dot(normal, lightDir);
    vec3 shadow = sampleShadow(playerPos, normal, nDotL);
    // 用天光值封住阳光，防止光从墙缝漏进室内。
    // Gate sunlight by skylight so it cannot leak indoors through a seam.
    shadow *= smoothstep(0.0, 0.22, skyLight);
    shadow *= 1.0 - rainStrength * 0.7;

    vec3 lightColor = directLightColor(sunElevation);

    // ---------------------------------------------------------------- 金属与介电质
    bool isMetal = f0 > 0.9;
    vec3 F0 = isMetal ? albedo : vec3(max(f0, 0.02));
    vec3 diffuseAlbedo = isMetal ? albedo * 0.08 : albedo;

    float roughness = clamp(1.0 - smoothness, 0.03, 1.0);
    roughness *= roughness;

    vec3 halfDir = normalize(lightDir + viewDirWorld);
    float nDotV = max(dot(normal, viewDirWorld), 1e-4);
    float nDotH = max(dot(normal, halfDir), 0.0);
    float vDotH = max(dot(viewDirWorld, halfDir), 0.0);
    float nDotLc = max(nDotL, 0.0);

    float D = distributionGGX(nDotH, roughness);
    float G = geometrySmith(nDotV, max(nDotLc, 1e-4), roughness);
    vec3 F = fresnelSchlick(vDotH, F0);
    vec3 specular = (D * G * F) / max(4.0 * nDotV * max(nDotLc, 1e-4), 1e-4);

    vec3 direct = (diffuseAlbedo / PI + specular) * lightColor * nDotLc * shadow * 3.0;

    // ---------------------------------------------------------------- 环境光
    float ao = 1.0;
#ifdef SSAO
    // 法线要转回观察空间才能和 viewPos 配对。Normal must be in view space to pair with viewPos.
    vec3 viewNormal = normalize(mat3(gbufferModelView) * normal);
    ao = computeSSAO(texcoord, viewPos, viewNormal);
#endif

    vec3 ambient = ambientSkyColor(sunElevation) * skyLight * skyLight;
    // 天空看不到的地方也留一点点漫反射，纯黑的洞穴不像现实。
    // Even sealed caves keep a trace of bounce light; pitch black is not realistic.
    ambient += ambientSkyColor(sunElevation) * 0.045;
    ambient *= ao;

    vec3 blockLightColor = vec3(1.0, 0.58, 0.28) * blockLight * blockLight * 2.1;
    blockLightColor *= mix(1.0, ao, 0.5);

    vec3 emission = albedo * emissive * EMISSIVE_STRENGTH;

    vec3 result = diffuseAlbedo * (ambient + blockLightColor) + direct + emission;

    // ---------------------------------------------------------------- 雾
#ifdef FOG
    if (isEyeInWater == 0) {
        float fogStart = far * 0.55;
        float fogAmount = clamp((dist - fogStart) / max(far - fogStart, 1e-3), 0.0, 1.0);
        fogAmount = pow(fogAmount, 1.6) * FOG_DENSITY;
        fogAmount = mix(fogAmount, min(fogAmount * 2.4, 1.0), rainStrength);
        vec3 fogColor = skyColor(-viewDirWorld, sunDir, sunElevation);
        result = mix(result, fogColor, clamp(fogAmount, 0.0, 1.0));
    } else {
        // 水下：红光衰减得最快，所以越深越蓝。
        // Underwater: red dies first, which is why depth reads as blue.
        float fogAmount = clamp(dist / 22.0, 0.0, 1.0);
        vec3 waterFog = vec3(0.04, 0.16, 0.26) * (ambientSkyColor(sunElevation) + 0.25);
        result = mix(result, waterFog, fogAmount * WATER_ABSORPTION);
    }
#endif

    gl_FragData[0] = vec4(result, 1.0);
}
