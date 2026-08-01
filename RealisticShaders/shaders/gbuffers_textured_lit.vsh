#version 120

#include "/common.glsl"

varying vec4 color;
varying vec2 texcoord;
varying vec2 lmcoord;
varying vec3 worldNormal;

uniform mat4 gbufferModelViewInverse;

void main() {
    gl_Position = ftransform();
    color = gl_Color;
    texcoord = (gl_TextureMatrix[0] * gl_MultiTexCoord0).st;
    lmcoord = (gl_TextureMatrix[1] * gl_MultiTexCoord1).st;
    lmcoord = clamp((lmcoord - 0.03125) * 1.06667, 0.0, 1.0);
    worldNormal = normalize(mat3(gbufferModelViewInverse) * gl_NormalMatrix * gl_Normal);
}
