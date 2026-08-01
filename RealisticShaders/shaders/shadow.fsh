#version 120

uniform sampler2D texture;

varying vec2 texcoord;
varying vec4 color;

void main() {
    vec4 albedo = texture2D(texture, texcoord) * color;
    if (albedo.a < 0.1) discard;
    // 深度写进 shadowtex，颜色写进 shadowcolor0 供彩色阴影使用。
    // Depth lands in shadowtex; this colour feeds coloured shadows.
    gl_FragData[0] = vec4(albedo.rgb, 1.0);
}
