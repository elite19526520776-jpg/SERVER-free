#version 120

#include "/common.glsl"

attribute vec4 at_tangent;

uniform mat4 gbufferModelViewInverse;

varying vec4 color;
varying vec2 texcoord;
varying vec2 lmcoord;
varying vec3 worldNormal;
varying vec3 worldTangent;
varying vec3 worldBitangent;

void main() {
    gl_Position = ftransform();
    color = gl_Color;
    texcoord = (gl_TextureMatrix[0] * gl_MultiTexCoord0).st;
    lmcoord = (gl_TextureMatrix[1] * gl_MultiTexCoord1).st;
    lmcoord = clamp((lmcoord - 0.03125) * 1.06667, 0.0, 1.0);

    mat3 toWorld = mat3(gbufferModelViewInverse);
    worldNormal = normalize(toWorld * (gl_NormalMatrix * gl_Normal));
    worldTangent = normalize(toWorld * (gl_NormalMatrix * at_tangent.xyz));
    worldBitangent = normalize(cross(worldTangent, worldNormal) * sign(at_tangent.w));
}
