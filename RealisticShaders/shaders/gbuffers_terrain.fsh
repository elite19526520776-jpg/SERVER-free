#version 120

#include "/common.glsl"

uniform sampler2D texture;
uniform sampler2D normals;
uniform sampler2D specular;

varying vec4 color;
varying vec2 texcoord;
varying vec2 lmcoord;
varying vec3 worldNormal;
varying vec3 worldTangent;
varying vec3 worldBitangent;
varying float blockId;

/* DRAWBUFFERS:012 */
void main() {
    vec4 albedo = texture2D(texture, texcoord) * color;
    if (albedo.a < 0.1) discard;

    vec3 normal = worldNormal;
    float smoothness = 0.03;
    float f0 = 0.04;
    float emissive = 0.0;
    float ao = 1.0;

#ifdef LABPBR
    // LabPBR 1.3：法线图 rg = 切线空间法线 xy，b = AO，a = 高度。
    // LabPBR 1.3: normal map rg = tangent-space xy, b = AO, a = height.
    vec4 nSample = texture2D(normals, texcoord);
    // 资源包没带法线图时这里会是全零，直接用几何法线，否则整个世界会黑掉。
    // A pack without normal maps samples to zero here; fall back or the world goes black.
    if (nSample.b > 0.01) {
        vec3 tangentNormal;
        tangentNormal.xy = (nSample.rg * 2.0 - 1.0) * NORMAL_STRENGTH;
        tangentNormal.z = sqrt(max(1.0 - dot(tangentNormal.xy, tangentNormal.xy), 0.0));
        mat3 tbn = mat3(worldTangent, worldBitangent, worldNormal);
        normal = normalize(tbn * normalize(tangentNormal));
        ao = clamp(mix(1.0, nSample.b, min(NORMAL_STRENGTH, 1.0)), 0.0, 1.0);
    }

    // 高光图 r = 感知光滑度，g = F0/金属度，b = 孔隙/次表面，a = 自发光。
    // Specular map r = perceptual smoothness, g = F0/metal, b = porosity/SSS, a = emission.
    vec4 sSample = texture2D(specular, texcoord);
    smoothness = sSample.r * SPECULAR_STRENGTH;
    f0 = sSample.g;
    // a = 255 表示"没有自发光数据"，别把整个世界点亮。
    // An alpha of 255 means "no emission data" — do not light up the whole world.
    emissive = (sSample.a < 0.996) ? sSample.a : 0.0;
#endif

    albedo.rgb *= ao;

    gl_FragData[0] = albedo;
    gl_FragData[1] = vec4(encodeNormal(normal), lmcoord.x, lmcoord.y);
    gl_FragData[2] = vec4(smoothness, f0, emissive, 1.0);
}
