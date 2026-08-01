#version 120

uniform mat4 gbufferModelViewInverse;

varying vec2 texcoord;
varying vec4 color;
varying vec3 worldDir;

void main() {
    gl_Position = ftransform();
    texcoord = (gl_TextureMatrix[0] * gl_MultiTexCoord0).st;
    color = gl_Color;
    worldDir = mat3(gbufferModelViewInverse) * (gl_ModelViewMatrix * gl_Vertex).xyz;
}
