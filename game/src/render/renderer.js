// WebGL2 渲染器：法线贴图 + 天空/日夜 + 体积雾 + 水面反射

import * as m4 from '../util/mat4.js';
import { buildTextureData, TEX_SIZE, TEX_INDEX } from './textures.js';
import { CHUNK_X, CHUNK_Y, CHUNK_Z } from '../world/chunk.js';
import { FLOATS_PER_VERTEX } from './mesher.js';

const WORLD_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in float aLayer;
layout(location=2) in vec2 aUV;
layout(location=3) in float aFace;
layout(location=4) in float aLight;
layout(location=5) in float aAO;
layout(location=6) in vec3 aTint;

uniform mat4 uProj, uView, uModel;
uniform float uTime;
uniform float uWaterLayer;

out vec2 vUV;
out float vLayer;
out vec3 vNormal, vTangent, vBitangent;
out vec2 vLight;
out float vAO;
out vec3 vTint;
out vec3 vWorld;
out float vIsWater;

const vec3 FN[6] = vec3[6](
  vec3(1,0,0), vec3(-1,0,0), vec3(0,1,0), vec3(0,-1,0), vec3(0,0,1), vec3(0,0,-1));
const vec3 FT[6] = vec3[6](
  vec3(0,0,-1), vec3(0,0,1), vec3(1,0,0), vec3(1,0,0), vec3(1,0,0), vec3(-1,0,0));
const vec3 FB[6] = vec3[6](
  vec3(0,-1,0), vec3(0,-1,0), vec3(0,0,1), vec3(0,0,-1), vec3(0,-1,0), vec3(0,-1,0));

void main() {
  int f = int(aFace + 0.5);
  vec4 world = uModel * vec4(aPos, 1.0);
  vIsWater = abs(aLayer - uWaterLayer) < 0.5 ? 1.0 : 0.0;
  if (vIsWater > 0.5 && f == 2) {
    world.y += sin(world.x * 1.7 + uTime * 1.6) * 0.022
             + sin(world.z * 2.3 - uTime * 1.1) * 0.018;
  }
  vWorld = world.xyz;
  vUV = aUV;
  vLayer = aLayer;
  mat3 nm = mat3(uModel);
  vNormal = normalize(nm * FN[f]);
  vTangent = normalize(nm * FT[f]);
  vBitangent = normalize(nm * FB[f]);
  float sky = mod(aLight, 16.0);
  float blk = floor(aLight / 16.0);
  vLight = vec2(sky / 15.0, blk / 15.0);
  vAO = aAO;
  vTint = aTint;
  gl_Position = uProj * uView * world;
}`;

const WORLD_FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;

in vec2 vUV;
in float vLayer;
in vec3 vNormal, vTangent, vBitangent;
in vec2 vLight;
in float vAO;
in vec3 vTint;
in vec3 vWorld;
in float vIsWater;

uniform sampler2DArray uAlbedo;
uniform sampler2DArray uNormal;
uniform vec3 uCamera;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uFogColor;
uniform float uFogStart, uFogEnd;
uniform float uDay;
uniform float uAlphaTest;
uniform float uTime;
uniform float uUnderwater;

out vec4 fragColor;

vec3 skyGradient(vec3 dir) {
  float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 horizon = mix(uFogColor, uSkyColor, 0.35);
  return mix(horizon, uSkyColor, pow(h, 0.7));
}

void main() {
  vec4 albedo = texture(uAlbedo, vec3(vUV, vLayer));
  if (albedo.a < uAlphaTest) discard;
  albedo.rgb *= vTint;

  vec4 nr = texture(uNormal, vec3(vUV, vLayer));
  vec3 tn = nr.xyz * 2.0 - 1.0;
  float rough = clamp(nr.a, 0.04, 1.0);
  mat3 TBN = mat3(vTangent, vBitangent, vNormal);
  vec3 N = normalize(TBN * tn);

  vec3 V = normalize(uCamera - vWorld);
  float dist = length(uCamera - vWorld);
  if (dot(N, V) < 0.0) N = -N;      // 双面几何（树叶、草）翻转法线

  // 水面：程序化波纹法线
  if (vIsWater > 0.5) {
    float w1 = sin(vWorld.x * 2.6 + uTime * 2.0) + sin(vWorld.z * 3.1 - uTime * 1.4);
    float w2 = sin(vWorld.x * 5.3 - uTime * 1.1) * 0.4 + sin(vWorld.z * 4.7 + uTime * 1.9) * 0.4;
    N = normalize(vNormal + vec3(w1 * 0.055 + w2 * 0.03, 0.0, w2 * 0.055 + w1 * 0.03));
    rough = 0.035;
  }

  vec3 L = normalize(uSunDir);
  float ndl = max(dot(N, L), 0.0);

  // 天空光 / 方块光
  float skyL = pow(vLight.x, 1.3) * mix(0.055, 1.0, uDay);
  float blkL = pow(vLight.y, 1.4);
  vec3 blockTint = vec3(1.0, 0.66, 0.34);

  // 环境光取天空色与中性白的混合，避免所有材质都被染蓝
  vec3 skyAmb = mix(skyGradient(N), vec3(1.0), 0.45);
  vec3 ambient = skyAmb * (skyL * 0.30 + 0.018) + blockTint * blkL * 0.85;
  ambient *= vAO;

  float shadowish = mix(0.3, 1.0, smoothstep(0.3, 0.95, vLight.x));
  vec3 direct = uSunColor * ndl * skyL * shadowish * 0.55;

  // GGX 近似高光
  vec3 H = normalize(L + V);
  float a = rough * rough;
  float ndh = max(dot(N, H), 0.0);
  float d = (ndh * ndh * (a * a - 1.0) + 1.0);
  float spec = (a * a) / max(3.14159 * d * d, 1e-4);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 5.0);
  float specStrength = mix(0.04, 1.0, fres) * (1.0 - rough * 0.85);
  vec3 specular = uSunColor * spec * specStrength * ndl * skyL * 1.4;

  vec3 color = albedo.rgb * (ambient + direct) + specular;

  // 水面：菲涅尔反射天空
  float alpha = albedo.a;
  if (vIsWater > 0.5) {
    vec3 R = reflect(-V, N);
    vec3 refl = skyGradient(R) * mix(0.25, 1.0, uDay);
    float f = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 4.0);
    color = mix(color, refl, clamp(f, 0.0, 0.85));
    alpha = mix(0.72, 0.94, f);
  }

  // 雾
  float fog = smoothstep(uFogStart, uFogEnd, dist);
  if (uUnderwater > 0.5) fog = smoothstep(0.0, 26.0, dist);
  color = mix(color, uFogColor, fog);

  // 色调映射 + gamma
  color = color / (color + vec3(1.0));
  color = pow(color, vec3(1.0 / 2.2));
  fragColor = vec4(color, alpha);
}`;

const SKY_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
uniform mat4 uInvVP;
uniform vec3 uCamera;
out vec3 vDir;
void main() {
  vec4 near = uInvVP * vec4(aPos, -1.0, 1.0);
  vec4 far = uInvVP * vec4(aPos, 1.0, 1.0);
  vDir = normalize(far.xyz / far.w - near.xyz / near.w);
  gl_Position = vec4(aPos, 0.9999, 1.0);
}`;

const SKY_FS = `#version 300 es
precision highp float;
in vec3 vDir;
uniform vec3 uSkyColor, uFogColor, uSunDir, uSunColor;
uniform float uDay, uTime;
uniform float uUnderwater;
out vec4 fragColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
             mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; }
  return s;
}

void main() {
  vec3 dir = normalize(vDir);
  float h = clamp(dir.y, -1.0, 1.0);
  vec3 horizon = uFogColor;
  vec3 zenith = uSkyColor;
  vec3 col = mix(horizon, zenith, pow(clamp(h * 0.5 + 0.5, 0.0, 1.0), 0.55));

  // 日出/日落时地平线染红
  float sunHoriz = pow(max(0.0, 1.0 - abs(uSunDir.y)), 3.0);
  col = mix(col, vec3(0.95, 0.52, 0.26), sunHoriz * pow(max(0.0, dot(dir, normalize(vec3(uSunDir.x, 0.0, uSunDir.z)))), 4.0) * 0.55);

  // 星空
  if (uDay < 0.45 && h > 0.02) {
    vec2 sp = dir.xz * clamp(1.0 / max(h, 0.12), 0.0, 8.0) * 3.0;
    float star = pow(hash(floor(sp * 55.0)), 60.0) * 6.0;
    star *= smoothstep(0.45, 0.0, uDay) * smoothstep(0.02, 0.3, h);
    col += vec3(star);
  }

  // 太阳与月亮
  float sd = dot(dir, uSunDir);
  col += uSunColor * pow(max(sd, 0.0), 900.0) * 8.0;
  col += uSunColor * pow(max(sd, 0.0), 32.0) * 0.16;
  float md = dot(dir, -uSunDir);
  col += vec3(0.85, 0.88, 1.0) * pow(max(md, 0.0), 1400.0) * 6.0 * smoothstep(0.5, 0.0, uDay);

  // 云层：与一个虚拟的高空平面求交，靠近地平线时收敛避免拉丝
  if (h > 0.03) {
    float t = clamp(1.0 / h, 0.0, 26.0);
    vec2 cp = dir.xz * t * 0.14 + vec2(uTime * 0.006, uTime * 0.0022);
    float c = fbm(cp);
    c = smoothstep(0.5, 0.76, c);
    float fade = smoothstep(0.03, 0.34, h);
    vec3 cloudCol = mix(vec3(0.55, 0.58, 0.66), vec3(1.0, 0.99, 0.96), uDay);
    cloudCol *= 0.75 + 0.45 * max(0.0, uSunDir.y);
    col = mix(col, cloudCol, c * fade * 0.85);
  }

  if (uUnderwater > 0.5) col = mix(col, vec3(0.06, 0.22, 0.42), 0.85);

  col = col / (col + vec3(1.0));
  col = pow(col, vec3(1.0 / 2.2));
  fragColor = vec4(col, 1.0);
}`;

const ENTITY_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUV;
uniform mat4 uProj, uView, uModel;
out vec3 vNormal, vWorld;
out vec2 vUV;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vWorld = w.xyz;
  vNormal = normalize(mat3(uModel) * aNormal);
  vUV = aUV;
  gl_Position = uProj * uView * w;
}`;

const ENTITY_FS = `#version 300 es
precision highp float;
in vec3 vNormal, vWorld;
in vec2 vUV;
uniform sampler2D uTex;
uniform vec3 uSunDir, uSunColor, uFogColor, uSkyColor;
uniform vec3 uCamera;
uniform float uFogStart, uFogEnd, uDay, uLight;
uniform vec4 uOverlay;
out vec4 fragColor;
void main() {
  vec4 tex = texture(uTex, vUV);
  if (tex.a < 0.35) discard;
  vec3 N = normalize(vNormal);
  float ndl = max(dot(N, normalize(uSunDir)), 0.0);
  vec3 ambient = mix(uFogColor, uSkyColor, 0.5) * (0.28 + 0.5 * uDay) * uLight;
  vec3 color = tex.rgb * (ambient + uSunColor * ndl * 0.75 * uDay * uLight);
  color = mix(color, uOverlay.rgb, uOverlay.a);
  float dist = length(uCamera - vWorld);
  color = mix(color, uFogColor, smoothstep(uFogStart, uFogEnd, dist));
  color = color / (color + vec3(1.0));
  color = pow(color, vec3(1.0 / 2.2));
  fragColor = vec4(color, 1.0);
}`;

const LINE_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
uniform mat4 uProj, uView, uModel;
void main() { gl_Position = uProj * uView * uModel * vec4(aPos, 1.0); }`;

const LINE_FS = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 fragColor;
void main() { fragColor = uColor; }`;

function compile(gl, type, src, name) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(`${name} 着色器编译失败：\n${gl.getShaderInfoLog(s)}`);
  }
  return s;
}

function program(gl, vs, fs, name) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs, name + ' VS'));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs, name + ' FS'));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(`${name} 程序链接失败：${gl.getProgramInfoLog(p)}`);
  }
  const uniforms = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    uniforms[info.name.replace('[0]', '')] = gl.getUniformLocation(p, info.name);
  }
  return { program: p, u: uniforms };
}

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', {
      antialias: true, alpha: false, powerPreference: 'high-performance',
      preserveDrawingBuffer: false, desynchronized: true,
    });
    if (!gl) throw new Error('浏览器不支持 WebGL2，无法运行本游戏。');
    this.gl = gl;
    this.canvas = canvas;
    this.proj = m4.identity();
    this.view = m4.identity();
    this.vp = m4.identity();
    this.invVP = m4.identity();
    this.model = m4.identity();
    this.planes = null;
    this.renderDistance = 8;
    this.fov = 70;
    this.stats = { chunks: 0, tris: 0 };
  }

  init() {
    const gl = this.gl;
    this.world = program(gl, WORLD_VS, WORLD_FS, 'world');
    this.sky = program(gl, SKY_VS, SKY_FS, 'sky');
    this.entity = program(gl, ENTITY_VS, ENTITY_FS, 'entity');
    this.line = program(gl, LINE_VS, LINE_FS, 'line');

    // 全屏三角形
    this.quadVAO = gl.createVertexArray();
    gl.bindVertexArray(this.quadVAO);
    const qb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.uploadTextures();
    this.initLineBuffers();

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.clearColor(0.5, 0.7, 1, 1);
  }

  uploadTextures() {
    const gl = this.gl;
    const data = buildTextureData();
    this.texCount = data.count;
    this.waterLayer = TEX_INDEX.water;

    const mk = (buf) => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
      gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, TEX_SIZE, TEX_SIZE, data.count,
        0, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
      const ext = gl.getExtension('EXT_texture_filter_anisotropic');
      if (ext) {
        const max = gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
        gl.texParameterf(gl.TEXTURE_2D_ARRAY, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, max));
      }
      return t;
    };
    this.albedoTex = mk(data.albedo);
    this.normalTex = mk(data.normal);
    this.textureData = data;
  }

  /** 由 2D canvas 创建普通纹理（生物皮肤、物品图标图集） */
  createTexture2D(canvas, nearest = true) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, nearest ? gl.NEAREST : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, nearest ? gl.NEAREST : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  initLineBuffers() {
    const gl = this.gl;
    // 单位立方体的 12 条边
    const e = [];
    const C = [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1], [0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]];
    const E = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
    for (const [a, b] of E) e.push(...C[a], ...C[b]);
    this.boxVAO = gl.createVertexArray();
    gl.bindVertexArray(this.boxVAO);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(e), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.boxLineCount = e.length / 3;
  }

  /** 上传区块网格 */
  uploadChunk(chunk, mesh) {
    const gl = this.gl;
    if (chunk.mesh) this.disposeChunk(chunk);
    const make = (data) => {
      if (!data) return null;
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const vb = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vb);
      gl.bufferData(gl.ARRAY_BUFFER, data.vertices, gl.STATIC_DRAW);
      const stride = FLOATS_PER_VERTEX * 4;
      const attrs = [[0, 3, 0], [1, 1, 3], [2, 2, 4], [3, 1, 6], [4, 1, 7], [5, 1, 8], [6, 3, 9]];
      for (const [loc, size, off] of attrs) {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off * 4);
      }
      const ib = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.indices, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      return { vao, vb, ib, count: data.count };
    };
    chunk.mesh = {
      opaque: make(mesh.opaque),
      transparent: make(mesh.transparent),
      dispose: () => this.disposeChunk(chunk),
    };
  }

  disposeChunk(chunk) {
    const gl = this.gl;
    if (!chunk.mesh) return;
    for (const part of [chunk.mesh.opaque, chunk.mesh.transparent]) {
      if (!part) continue;
      gl.deleteVertexArray(part.vao);
      gl.deleteBuffer(part.vb);
      gl.deleteBuffer(part.ib);
    }
    chunk.mesh = null;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(this.canvas.clientWidth * dpr);
    const h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  /** 计算这一帧的环境参数 */
  environment(world, camPos, biome) {
    const day = world.dayFactor;
    const ang = world.sunAngle;
    // 太阳沿一条固定的水平方位升落
    const hx = 0.48, hz = 0.88;
    const sunDir = [Math.cos(ang) * hx, Math.sin(ang), Math.cos(ang) * hz];
    const len = Math.hypot(sunDir[0], sunDir[1], sunDir[2]) || 1;
    for (let i = 0; i < 3; i++) sunDir[i] /= len;
    // 太阳越接近地平线越偏橙红
    const dusk = Math.pow(Math.max(0, 1 - Math.abs(sunDir[1]) * 2.6), 2) * day;
    const sunColor = [
      (0.16 + day * 1.02) + dusk * 0.5,
      (0.15 + day * 0.94) + dusk * 0.08,
      (0.17 + day * 0.86) - dusk * 0.14,
    ];
    const skyColor = [0.05 + day * 0.32, 0.09 + day * 0.48, 0.2 + day * 0.72];
    const bf = biome ? biome.fog : [0.66, 0.78, 1.0];
    const night = 1 - day;
    const fogColor = [
      0.05 * night + day * bf[0] * 1.02 + dusk * 0.2,
      0.07 * night + day * bf[1] * 1.0 + dusk * 0.05,
      0.13 * night + day * bf[2] * 1.0 - dusk * 0.05,
    ];
    return { day, sunDir, sunColor, skyColor, fogColor };
  }

  beginFrame(camPos, yaw, pitch, aspect, fovScale = 1) {
    m4.perspective((this.fov * fovScale) * Math.PI / 180, aspect, 0.06, 1400, this.proj);
    m4.lookRotation(camPos, yaw, pitch, this.view);
    m4.multiply(this.proj, this.view, this.vp);
    m4.invert(this.vp, this.invVP);
    this.planes = m4.frustumPlanes(this.vp, this.planes || []);
  }

  drawSky(env, camPos, underwater) {
    const gl = this.gl;
    const p = this.sky;
    gl.useProgram(p.program);
    gl.depthMask(false);
    gl.disable(gl.DEPTH_TEST);
    gl.uniformMatrix4fv(p.u.uInvVP, false, this.invVP);
    gl.uniform3fv(p.u.uCamera, camPos);
    gl.uniform3fv(p.u.uSkyColor, env.skyColor);
    gl.uniform3fv(p.u.uFogColor, env.fogColor);
    gl.uniform3fv(p.u.uSunDir, env.sunDir);
    gl.uniform3fv(p.u.uSunColor, env.sunColor);
    gl.uniform1f(p.u.uDay, env.day);
    gl.uniform1f(p.u.uTime, performance.now() / 1000);
    gl.uniform1f(p.u.uUnderwater, underwater ? 1 : 0);
    gl.bindVertexArray(this.quadVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
  }

  drawChunks(world, env, camPos, underwater, chunks) {
    const gl = this.gl;
    const p = this.world;
    gl.useProgram(p.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.albedoTex);
    gl.uniform1i(p.u.uAlbedo, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.normalTex);
    gl.uniform1i(p.u.uNormal, 1);
    gl.uniformMatrix4fv(p.u.uProj, false, this.proj);
    gl.uniformMatrix4fv(p.u.uView, false, this.view);
    gl.uniformMatrix4fv(p.u.uModel, false, m4.identity(this.model));
    gl.uniform3fv(p.u.uCamera, camPos);
    gl.uniform3fv(p.u.uSunDir, env.sunDir);
    gl.uniform3fv(p.u.uSunColor, env.sunColor);
    gl.uniform3fv(p.u.uSkyColor, env.skyColor);
    gl.uniform3fv(p.u.uFogColor, env.fogColor);
    const far = this.renderDistance * CHUNK_X;
    gl.uniform1f(p.u.uFogStart, far * 0.76);
    gl.uniform1f(p.u.uFogEnd, far * 1.02);
    gl.uniform1f(p.u.uDay, env.day);
    gl.uniform1f(p.u.uTime, performance.now() / 1000);
    gl.uniform1f(p.u.uWaterLayer, this.waterLayer);
    gl.uniform1f(p.u.uUnderwater, underwater ? 1 : 0);

    // 不透明批次（含 alpha 测试的树叶/植物）
    gl.uniform1f(p.u.uAlphaTest, 0.5);
    gl.disable(gl.BLEND);
    this.stats.chunks = 0;
    this.stats.tris = 0;
    const visible = [];
    for (const c of chunks) {
      if (!c.mesh) continue;
      const x0 = c.cx * CHUNK_X, z0 = c.cz * CHUNK_Z;
      if (!m4.aabbInFrustum(this.planes, x0, 0, z0, x0 + CHUNK_X, CHUNK_Y, z0 + CHUNK_Z)) continue;
      visible.push(c);
      if (c.mesh.opaque) {
        gl.bindVertexArray(c.mesh.opaque.vao);
        gl.drawElements(gl.TRIANGLES, c.mesh.opaque.count, gl.UNSIGNED_INT, 0);
        this.stats.tris += c.mesh.opaque.count / 3;
      }
      this.stats.chunks++;
    }

    // 半透明批次（水、玻璃、冰），按距离从远到近
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1f(p.u.uAlphaTest, 0.02);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    visible.sort((a, b) => {
      const da = (a.cx * 16 + 8 - camPos[0]) ** 2 + (a.cz * 16 + 8 - camPos[2]) ** 2;
      const db = (b.cx * 16 + 8 - camPos[0]) ** 2 + (b.cz * 16 + 8 - camPos[2]) ** 2;
      return db - da;
    });
    for (const c of visible) {
      if (!c.mesh || !c.mesh.transparent) continue;
      gl.bindVertexArray(c.mesh.transparent.vao);
      gl.drawElements(gl.TRIANGLES, c.mesh.transparent.count, gl.UNSIGNED_INT, 0);
      this.stats.tris += c.mesh.transparent.count / 3;
    }
    gl.enable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  drawSelection(x, y, z, boxes) {
    const gl = this.gl;
    const p = this.line;
    gl.useProgram(p.program);
    gl.uniformMatrix4fv(p.u.uProj, false, this.proj);
    gl.uniformMatrix4fv(p.u.uView, false, this.view);
    gl.uniform4f(p.u.uColor, 0, 0, 0, 0.55);
    gl.bindVertexArray(this.boxVAO);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    for (const [bx, by, bz, bX, bY, bZ] of boxes) {
      const m = m4.identity(this.model);
      m4.translate(m, x + bx - 0.002, y + by - 0.002, z + bz - 0.002, m);
      m4.scale(m, bX - bx + 0.004, bY - by + 0.004, bZ - bz + 0.004, m);
      gl.uniformMatrix4fv(p.u.uModel, false, m);
      gl.drawArrays(gl.LINES, 0, this.boxLineCount);
    }
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  clear() {
    const gl = this.gl;
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }
}

export { m4 };
