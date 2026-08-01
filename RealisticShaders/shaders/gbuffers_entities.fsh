#version 120

#include "/common.glsl"

uniform sampler2D texture;
uniform sampler2D normals;
uniform sampler2D specular;
uniform vec4 entityColor;

varying vec4 color;
varying vec2 texcoord;
varying vec2 lmcoord;
varying vec3 worldNormal;
varying vec3 worldTangent;
varying vec3 worldBitangent;

/* DRAWBUFFERS:012 */
void main() {
    vec4 albedo = texture2D(texture, texcoord) * color;
    if (albedo.a < 0.1) discard;
    // 受伤闪红 / creeper 充能等由 entityColor 提供。Hurt flash and charge tint.
    albedo.rgb = mix(albedo.rgb, entityColor.rgb, entityColor.a);

    vec3 normal = worldNormal;
    float smoothness = 0.05;
    float f0 = 0.04;
    float emissive = 0.0;

#ifdef LABPBR
    vec4 nSample = texture2D(normals, texcoord);
    if (nSample.b > 0.01) {
        vec3 tangentNormal;
        tangentNormal.xy = (nSample.rg * 2.0 - 1.0) * NORMAL_STRENGTH;
        tangentNormal.z = sqrt(max(1.0 - dot(tangentNormal.xy, tangentNormal.xy), 0.0));
        mat3 tbn = mat3(worldTangent, worldBitangent, worldNormal);
        normal = normalize(tbn * normalize(tangentNormal));
    }

    vec4 sSample = texture2D(specular, texcoord);
    smoothness = sSample.r * SPECULAR_STRENGTH;
    f0 = sSample.g;
    emissive = (sSample.a < 0.996) ? sSample.a : 0.0;
#endif

    gl_FragData[0] = albedo;
    gl_FragData[1] = vec4(encodeNormal(normal), lmcoord.x, lmcoord.y);
    gl_FragData[2] = vec4(smoothness, f0, emissive, 1.0);
}
