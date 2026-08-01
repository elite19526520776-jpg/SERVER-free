#version 120

varying vec2 texcoord;
varying vec2 lmcoord;
varying vec4 color;

void main() {
    gl_Position = ftransform();
    texcoord = (gl_TextureMatrix[0] * gl_MultiTexCoord0).st;
    lmcoord = (gl_TextureMatrix[1] * gl_MultiTexCoord1).st;
    lmcoord = clamp((lmcoord - 0.03125) * 1.06667, 0.0, 1.0);
    color = gl_Color;
}
