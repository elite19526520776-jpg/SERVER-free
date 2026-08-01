#version 120

varying vec4 color;

/* DRAWBUFFERS:0 */
void main() {
    // 只写颜色，材质标记留 0 -> deferred 会原样放行。
    // Colour only; the material flag stays 0 so deferred passes it straight through.
    gl_FragData[0] = color;
}
