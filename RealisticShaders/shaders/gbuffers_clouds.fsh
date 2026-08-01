#version 120

#include "/common.glsl"

uniform sampler2D texture;
uniform mat4 gbufferModelViewInverse;
uniform vec3 sunPosition;
uniform float rainStrength;

varying vec2 texcoord;
varying vec4 color;
varying vec3 worldDir;

/* DRAWBUFFERS:0 */
void main() {
    vec4 cloud = texture2D(texture, texcoord) * color;
    if (cloud.a < 0.01) discard;

    vec3 sunDir = normalize(mat3(gbufferModelViewInverse) * sunPosition);
    float sunElevation = sunDir.y;

    // 云是被天光和阳光一起照亮的，日落时会染成橙色。
    // Clouds take both skylight and sunlight, so they go orange at sunset.
    vec3 lit = ambientSkyColor(sunElevation) * 0.9 + directLightColor(sunElevation) * 0.75;
    cloud.rgb *= lit;

    // 背光边缘透出一点光。A little light bleeds through the backlit edge.
    float rim = pow(max(dot(normalize(worldDir), sunDir), 0.0), 6.0);
    cloud.rgb += directLightColor(sunElevation) * rim * 0.35 * dayFactor(sunElevation);

    cloud.rgb = mix(cloud.rgb, vec3(luma(cloud.rgb)) * 0.5, rainStrength * 0.8);
    cloud.a *= mix(1.0, 0.85, rainStrength);

    gl_FragData[0] = cloud;
}
