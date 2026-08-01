#version 120

uniform mat4 gbufferModelViewInverse;

varying vec3 worldDir;

void main() {
    gl_Position = ftransform();
    vec3 viewPos = (gl_ModelViewMatrix * gl_Vertex).xyz;
    worldDir = mat3(gbufferModelViewInverse) * viewPos;
}
