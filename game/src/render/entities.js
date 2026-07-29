// 生物模型（长方体拼装 + 程序化皮肤）与实体渲染

import * as m4 from '../util/mat4.js';
import { Perlin, hash01, clamp, lerp } from '../util/noise.js';
import { BLOCK_BY_NAME, RT } from '../world/blocks.js';
import { FACES } from './mesher.js';

const SKIN = 64;
const P = new Perlin(4242);

// ── 程序化皮肤 ─────────────────────────────────────────────
function skinCanvas(painter) {
  const c = document.createElement('canvas');
  c.width = SKIN;
  c.height = SKIN;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, SKIN, SKIN);
  const img = ctx.createImageData(SKIN, SKIN);
  painter(img.data, SKIN);
  ctx.putImageData(img, 0, 0);
  return c;
}

function px(d, s, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= s || y >= s) return;
  const i = (y * s + x) * 4;
  d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a;
}

/** 用噪声铺满整张皮肤，模拟毛发/皮肤质感 */
function noiseFill(d, s, base, variance, seed, alpha = 255) {
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const n = P.fbm2(x * 0.32 + seed, y * 0.32, 3) * variance;
      const f = P.fbm2(x * 1.1 + seed * 3, y * 1.1, 2) * variance * 0.5;
      px(d, s, x, y, base[0] * (1 + n + f), base[1] * (1 + n + f), base[2] * (1 + n + f), alpha);
    }
  }
}

function patch(d, s, x0, y0, w, h, col, jitter = 0.12, seed = 0) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const n = (hash01(x, y, seed) - 0.5) * jitter * 2;
      px(d, s, x, y, col[0] * (1 + n), col[1] * (1 + n), col[2] * (1 + n));
    }
  }
}

const SKINS = {
  pig: () => skinCanvas((d, s) => {
    noiseFill(d, s, [232, 150, 150], 0.1, 1);
    patch(d, s, 8, 8, 8, 8, [240, 165, 165], 0.08, 3);      // 脸
    patch(d, s, 11, 12, 3, 3, [214, 118, 118], 0.1, 4);      // 鼻子
    px(d, s, 10, 11, 30, 20, 20); px(d, s, 14, 11, 30, 20, 20);
  }),
  cow: () => skinCanvas((d, s) => {
    noiseFill(d, s, [60, 45, 38], 0.16, 2);
    for (let i = 0; i < 26; i++) {
      const x = Math.floor(hash01(i, 7) * s), y = Math.floor(hash01(i, 9) * s);
      const w = 2 + Math.floor(hash01(i, 11) * 6), h = 2 + Math.floor(hash01(i, 13) * 5);
      patch(d, s, x, y, w, h, [232, 228, 220], 0.08, i);
    }
    patch(d, s, 8, 8, 8, 8, [58, 44, 36], 0.1, 21);
    patch(d, s, 10, 12, 4, 3, [225, 218, 205], 0.08, 22);
    px(d, s, 10, 10, 20, 14, 12); px(d, s, 14, 10, 20, 14, 12);
  }),
  sheep: () => skinCanvas((d, s) => {
    noiseFill(d, s, [236, 235, 230], 0.14, 3);
    patch(d, s, 8, 8, 8, 8, [214, 190, 168], 0.1, 31);
    px(d, s, 10, 11, 30, 24, 20); px(d, s, 14, 11, 30, 24, 20);
  }),
  chicken: () => skinCanvas((d, s) => {
    noiseFill(d, s, [235, 235, 232], 0.12, 4);
    patch(d, s, 8, 8, 8, 8, [240, 240, 238], 0.06, 41);
    patch(d, s, 11, 12, 3, 2, [235, 170, 40], 0.1, 42);      // 喙
    patch(d, s, 10, 7, 5, 2, [200, 50, 40], 0.12, 43);       // 鸡冠
    px(d, s, 10, 10, 25, 20, 18); px(d, s, 14, 10, 25, 20, 18);
  }),
  zombie: () => skinCanvas((d, s) => {
    noiseFill(d, s, [78, 124, 78], 0.14, 5);
    patch(d, s, 8, 8, 8, 8, [96, 142, 84], 0.1, 51);
    patch(d, s, 20, 20, 24, 12, [58, 82, 148], 0.14, 52);    // 衣服
    px(d, s, 10, 11, 30, 20, 20); px(d, s, 14, 11, 30, 20, 20);
    px(d, s, 11, 14, 40, 60, 40); px(d, s, 13, 14, 40, 60, 40);
  }),
  skeleton: () => skinCanvas((d, s) => {
    noiseFill(d, s, [206, 206, 200], 0.13, 6);
    patch(d, s, 8, 8, 8, 8, [214, 214, 208], 0.09, 61);
    px(d, s, 10, 11, 20, 20, 20); px(d, s, 11, 11, 20, 20, 20);
    px(d, s, 13, 11, 20, 20, 20); px(d, s, 14, 11, 20, 20, 20);
    for (let x = 9; x < 15; x++) px(d, s, x, 14, 40, 40, 38);
  }),
  creeper: () => skinCanvas((d, s) => {
    noiseFill(d, s, [80, 175, 76], 0.2, 7);
    patch(d, s, 8, 8, 8, 8, [88, 186, 82], 0.16, 71);
    patch(d, s, 10, 10, 2, 2, [20, 20, 20], 0.05, 72);
    patch(d, s, 14, 10, 2, 2, [20, 20, 20], 0.05, 73);
    patch(d, s, 11, 12, 4, 3, [20, 20, 20], 0.05, 74);
    patch(d, s, 10, 14, 2, 2, [20, 20, 20], 0.05, 75);
    patch(d, s, 14, 14, 2, 2, [20, 20, 20], 0.05, 76);
  }),
  spider: () => skinCanvas((d, s) => {
    noiseFill(d, s, [46, 40, 38], 0.22, 8);
    patch(d, s, 8, 8, 8, 8, [52, 44, 40], 0.15, 81);
    for (const [ex, ey] of [[10, 11], [13, 11], [11, 13], [14, 13]]) {
      px(d, s, ex, ey, 220, 40, 30);
    }
  }),
};

// ── 模型定义 ───────────────────────────────────────────────
// 单位：1 = 1 个方块 = 16 像素
const S = 1 / 16;

function part(name, size, pivot, uv, opts = {}) {
  return { name, size, pivot, uv, ...opts };
}

export const MODELS = {
  pig: {
    height: 0.9, width: 0.9, skin: 'pig', eyeHeight: 0.75,
    parts: [
      part('body', [10, 8, 16], [0, 12, 0], [28, 8], { rotX: Math.PI / 2 }),
      part('head', [8, 8, 8], [0, 12, -8], [0, 0], { head: true }),
      part('leg0', [4, 6, 4], [-3, 6, -5], [0, 16], { leg: 1 }),
      part('leg1', [4, 6, 4], [3, 6, -5], [0, 16], { leg: 2 }),
      part('leg2', [4, 6, 4], [-3, 6, 7], [0, 16], { leg: 2 }),
      part('leg3', [4, 6, 4], [3, 6, 7], [0, 16], { leg: 1 }),
    ],
  },
  cow: {
    height: 1.4, width: 0.9, skin: 'cow', eyeHeight: 1.2,
    parts: [
      part('body', [12, 10, 18], [0, 19, 0], [18, 4], { rotX: Math.PI / 2 }),
      part('head', [8, 8, 6], [0, 22, -12], [0, 0], { head: true }),
      part('horn0', [1, 3, 1], [-4, 26, -12], [22, 0], { head: true }),
      part('horn1', [1, 3, 1], [4, 26, -12], [22, 0], { head: true }),
      part('leg0', [4, 12, 4], [-4, 6, -7], [0, 16], { leg: 1 }),
      part('leg1', [4, 12, 4], [4, 6, -7], [0, 16], { leg: 2 }),
      part('leg2', [4, 12, 4], [-4, 6, 7], [0, 16], { leg: 2 }),
      part('leg3', [4, 12, 4], [4, 12 - 6, 7], [0, 16], { leg: 1 }),
    ],
  },
  sheep: {
    height: 1.3, width: 0.9, skin: 'sheep', eyeHeight: 1.1,
    parts: [
      part('body', [12, 12, 18], [0, 18, 0], [18, 4], { rotX: Math.PI / 2 }),
      part('head', [6, 6, 8], [0, 20, -11], [0, 0], { head: true }),
      part('leg0', [4, 12, 4], [-4, 6, -6], [0, 16], { leg: 1 }),
      part('leg1', [4, 12, 4], [4, 6, -6], [0, 16], { leg: 2 }),
      part('leg2', [4, 12, 4], [-4, 6, 6], [0, 16], { leg: 2 }),
      part('leg3', [4, 12, 4], [4, 6, 6], [0, 16], { leg: 1 }),
    ],
  },
  chicken: {
    height: 0.7, width: 0.4, skin: 'chicken', eyeHeight: 0.6,
    parts: [
      part('body', [6, 8, 6], [0, 8, 0], [0, 20], { rotX: Math.PI / 2 }),
      part('head', [4, 6, 3], [0, 13, -4], [0, 0], { head: true }),
      part('beak', [4, 2, 2], [0, 12, -6], [14, 0], { head: true }),
      part('wing0', [1, 4, 6], [-4, 9, 0], [24, 13], { arm: 1 }),
      part('wing1', [1, 4, 6], [4, 9, 0], [24, 13], { arm: 2 }),
      part('leg0', [3, 5, 3], [-2, 2, 1], [26, 0], { leg: 1 }),
      part('leg1', [3, 5, 3], [2, 2, 1], [26, 0], { leg: 2 }),
    ],
  },
  zombie: {
    height: 1.95, width: 0.6, skin: 'zombie', eyeHeight: 1.62, biped: true,
    parts: [
      part('head', [8, 8, 8], [0, 28, 0], [0, 0], { head: true }),
      part('body', [8, 12, 4], [0, 18, 0], [16, 16]),
      part('arm0', [4, 12, 4], [-6, 22, 0], [40, 16], { arm: 1, zombieArm: true }),
      part('arm1', [4, 12, 4], [6, 22, 0], [40, 16], { arm: 2, zombieArm: true }),
      part('leg0', [4, 12, 4], [-2, 6, 0], [0, 16], { leg: 1 }),
      part('leg1', [4, 12, 4], [2, 6, 0], [0, 16], { leg: 2 }),
    ],
  },
  skeleton: {
    height: 1.95, width: 0.6, skin: 'skeleton', eyeHeight: 1.62, biped: true,
    parts: [
      part('head', [8, 8, 8], [0, 28, 0], [0, 0], { head: true }),
      part('body', [8, 12, 4], [0, 18, 0], [16, 16]),
      part('arm0', [2, 12, 2], [-5, 22, 0], [40, 16], { arm: 1, zombieArm: true }),
      part('arm1', [2, 12, 2], [5, 22, 0], [40, 16], { arm: 2, zombieArm: true }),
      part('leg0', [2, 12, 2], [-2, 6, 0], [0, 16], { leg: 1 }),
      part('leg1', [2, 12, 2], [2, 6, 0], [0, 16], { leg: 2 }),
    ],
  },
  creeper: {
    height: 1.7, width: 0.6, skin: 'creeper', eyeHeight: 1.5,
    parts: [
      part('head', [8, 8, 8], [0, 24, 0], [0, 0], { head: true }),
      part('body', [8, 12, 4], [0, 14, 0], [16, 16]),
      part('leg0', [4, 6, 4], [-2, 3, -4], [0, 16], { leg: 1 }),
      part('leg1', [4, 6, 4], [2, 3, -4], [0, 16], { leg: 2 }),
      part('leg2', [4, 6, 4], [-2, 3, 4], [0, 16], { leg: 2 }),
      part('leg3', [4, 6, 4], [2, 3, 4], [0, 16], { leg: 1 }),
    ],
  },
  spider: {
    height: 0.9, width: 1.4, skin: 'spider', eyeHeight: 0.7,
    parts: [
      part('head', [8, 8, 8], [0, 9, -6], [0, 0], { head: true }),
      part('body', [10, 8, 12], [0, 9, 4], [16, 16]),
      part('leg0', [14, 2, 2], [-8, 9, -3], [24, 0], { leg: 1, spider: -1 }),
      part('leg1', [14, 2, 2], [8, 9, -3], [24, 0], { leg: 2, spider: 1 }),
      part('leg2', [14, 2, 2], [-8, 9, 0], [24, 0], { leg: 2, spider: -1 }),
      part('leg3', [14, 2, 2], [8, 9, 0], [24, 0], { leg: 1, spider: 1 }),
      part('leg4', [14, 2, 2], [-8, 9, 3], [24, 0], { leg: 1, spider: -1 }),
      part('leg5', [14, 2, 2], [8, 9, 3], [24, 0], { leg: 2, spider: 1 }),
      part('leg6', [14, 2, 2], [-8, 9, 6], [24, 0], { leg: 2, spider: -1 }),
      part('leg7', [14, 2, 2], [8, 9, 6], [24, 0], { leg: 1, spider: 1 }),
    ],
  },
};

/** Minecraft 风格的长方体 UV 展开 */
function boxMesh(w, h, d, u0, v0) {
  const verts = [];
  const idxs = [];
  const hw = w / 2, hh = h / 2, hd = d / 2;
  // [法线, 4 个顶点, uv 矩形]
  const faces = [
    { n: [0, 0, -1], p: [[-hw, -hh, -hd], [hw, -hh, -hd], [hw, hh, -hd], [-hw, hh, -hd]], uv: [u0 + d, v0 + d, w, h] },
    { n: [0, 0, 1], p: [[hw, -hh, hd], [-hw, -hh, hd], [-hw, hh, hd], [hw, hh, hd]], uv: [u0 + d + w + d, v0 + d, w, h] },
    { n: [-1, 0, 0], p: [[-hw, -hh, hd], [-hw, -hh, -hd], [-hw, hh, -hd], [-hw, hh, hd]], uv: [u0, v0 + d, d, h] },
    { n: [1, 0, 0], p: [[hw, -hh, -hd], [hw, -hh, hd], [hw, hh, hd], [hw, hh, -hd]], uv: [u0 + d + w, v0 + d, d, h] },
    { n: [0, 1, 0], p: [[-hw, hh, -hd], [hw, hh, -hd], [hw, hh, hd], [-hw, hh, hd]], uv: [u0 + d, v0, w, d] },
    { n: [0, -1, 0], p: [[-hw, -hh, hd], [hw, -hh, hd], [hw, -hh, -hd], [-hw, -hh, -hd]], uv: [u0 + d + w, v0, w, d] },
  ];
  for (const f of faces) {
    const base = verts.length / 8;
    const [ux, uy, uw, uh] = f.uv;
    const uvs = [
      [ux / SKIN, (uy + uh) / SKIN],
      [(ux + uw) / SKIN, (uy + uh) / SKIN],
      [(ux + uw) / SKIN, uy / SKIN],
      [ux / SKIN, uy / SKIN],
    ];
    for (let i = 0; i < 4; i++) {
      verts.push(f.p[i][0] * S, f.p[i][1] * S, f.p[i][2] * S, f.n[0], f.n[1], f.n[2], uvs[i][0], uvs[i][1]);
    }
    idxs.push(base, base + 1, base + 2, base + 2, base + 3, base);
  }
  return { verts: new Float32Array(verts), idxs: new Uint16Array(idxs) };
}

/** 实体渲染器：负责生物、掉落物、手持物 */
export class EntityRenderer {
  constructor(renderer) {
    this.r = renderer;
    this.gl = renderer.gl;
    this.partBuffers = new Map();
    this.skinTextures = new Map();
    this.blockCubes = new Map();
    this.quadVAO = null;
  }

  init(itemAtlasCanvas) {
    for (const [name, gen] of Object.entries(SKINS)) {
      this.skinTextures.set(name, this.r.createTexture2D(gen(), true));
    }
    this.itemAtlas = this.r.createTexture2D(itemAtlasCanvas, false);
    this.buildQuad();
  }

  buildQuad() {
    const gl = this.gl;
    const verts = new Float32Array([
      -0.5, -0.5, 0, 0, 0, 1, 0, 1,
      0.5, -0.5, 0, 0, 0, 1, 1, 1,
      0.5, 0.5, 0, 0, 0, 1, 1, 0,
      -0.5, 0.5, 0, 0, 0, 1, 0, 0,
    ]);
    const idxs = new Uint16Array([0, 1, 2, 2, 3, 0]);
    this.quadVAO = this.makeVAO(verts, idxs);
  }

  makeVAO(verts, idxs) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 24);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idxs, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, count: idxs.length };
  }

  getPart(type, p) {
    const key = `${type}:${p.name}`;
    let b = this.partBuffers.get(key);
    if (!b) {
      const mesh = boxMesh(p.size[0], p.size[1], p.size[2], p.uv[0], p.uv[1]);
      b = this.makeVAO(mesh.verts, mesh.idxs);
      this.partBuffers.set(key, b);
    }
    return b;
  }

  /** 用世界着色器画一个方块立方体（掉落物 / 手持物） */
  getBlockCube(blockName) {
    let c = this.blockCubes.get(blockName);
    if (c) return c;
    const b = BLOCK_BY_NAME.get(blockName);
    if (!b) return null;
    const gl = this.gl;
    const verts = [];
    const idxs = [];
    const cross = b.render === RT.CROSS;
    const faces = cross ? [4, 5] : [0, 1, 2, 3, 4, 5];
    for (const f of faces) {
      const F = FACES[f];
      const base = verts.length / 12;
      for (let i = 0; i < 4; i++) {
        const [off, uv] = F.v[i];
        verts.push(
          off[0] - 0.5, off[1] - 0.5, (cross ? 0.5 : off[2]) - 0.5,
          b.texLayers[f], uv[0], uv[1], f, 15, 1, 1, 1, 1,
        );
      }
      idxs.push(base, base + 1, base + 2, base + 2, base + 3, base);
    }
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
    const stride = 12 * 4;
    const attrs = [[0, 3, 0], [1, 1, 3], [2, 2, 4], [3, 1, 6], [4, 1, 7], [5, 1, 8], [6, 3, 9]];
    for (const [loc, size, off] of attrs) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off * 4);
    }
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idxs), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    c = { vao, count: idxs.length };
    this.blockCubes.set(blockName, c);
    return c;
  }

  beginEntities(env, camPos) {
    const gl = this.gl;
    const p = this.r.entity;
    gl.useProgram(p.program);
    gl.uniformMatrix4fv(p.u.uProj, false, this.r.proj);
    gl.uniformMatrix4fv(p.u.uView, false, this.r.view);
    gl.uniform3fv(p.u.uSunDir, env.sunDir);
    gl.uniform3fv(p.u.uSunColor, env.sunColor);
    gl.uniform3fv(p.u.uSkyColor, env.skyColor);
    gl.uniform3fv(p.u.uFogColor, env.fogColor);
    gl.uniform3fv(p.u.uCamera, camPos);
    const far = this.r.renderDistance * 16;
    gl.uniform1f(p.u.uFogStart, far * 0.76);
    gl.uniform1f(p.u.uFogEnd, far * 1.02);
    gl.uniform1f(p.u.uDay, env.day);
    gl.uniform1i(p.u.uTex, 0);
    gl.activeTexture(gl.TEXTURE0);
  }

  /** 绘制一只生物 */
  drawMob(mob, time, light = 1) {
    const gl = this.gl;
    const p = this.r.entity;
    const model = MODELS[mob.type];
    if (!model) return;
    gl.bindTexture(gl.TEXTURE_2D, this.skinTextures.get(model.skin));
    gl.uniform1f(p.u.uLight, light);
    gl.uniform4f(p.u.uOverlay, 1, 0.25, 0.25, mob.hurtTime > 0 ? 0.45 : 0);

    const swing = Math.sin(mob.walkPhase) * mob.walkAmount;
    const swing2 = Math.sin(mob.walkPhase + Math.PI) * mob.walkAmount;

    for (const part of model.parts) {
      const base = m4.identity(new Float32Array(16));
      m4.translate(base, mob.x, mob.y, mob.z, base);
      m4.rotateY(base, mob.yaw, base);

      const px2 = part.pivot[0] * S, py = part.pivot[1] * S, pz = part.pivot[2] * S;
      let mat;
      if (part.head) {
        mat = m4.translate(base, px2, py, pz);
        m4.rotateY(mat, mob.headYaw - mob.yaw, mat);
        m4.rotateX(mat, -mob.headPitch, mat);
      } else if (part.leg || part.arm) {
        const legLen = part.size[1] * S;
        mat = m4.translate(base, px2, py + legLen / 2, pz);
        const ang = part.spider
          ? (part.leg === 1 ? swing : swing2) * 0.5
          : (part.leg === 1 || part.arm === 1 ? swing : swing2);
        if (part.spider) {
          m4.rotateZ(mat, part.spider * (0.9 + ang * 0.4), mat);
        } else if (part.zombieArm) {
          m4.rotateX(mat, ang * 0.5 - 1.45, mat);
        } else {
          m4.rotateX(mat, ang, mat);
        }
        m4.translate(mat, 0, -legLen / 2, 0, mat);
      } else {
        mat = m4.translate(base, px2, py, pz);
        if (part.rotX) m4.rotateX(mat, part.rotX, mat);
      }
      gl.uniformMatrix4fv(p.u.uModel, false, mat);
      const buf = this.getPart(mob.type, part);
      gl.bindVertexArray(buf.vao);
      gl.drawElements(gl.TRIANGLES, buf.count, gl.UNSIGNED_SHORT, 0);
    }
    gl.bindVertexArray(null);
  }

  /** 掉落物：非方块用图标广告牌 */
  drawItemBillboard(x, y, z, iconIndex, atlasCols, camYaw, scale = 0.4, light = 1) {
    const gl = this.gl;
    const p = this.r.entity;
    gl.bindTexture(gl.TEXTURE_2D, this.itemAtlas);
    gl.uniform1f(p.u.uLight, light);
    gl.uniform4f(p.u.uOverlay, 0, 0, 0, 0);
    const mat = m4.fromTranslation(x, y, z);
    m4.rotateY(mat, camYaw, mat);
    m4.scale(mat, scale, scale, scale, mat);
    gl.uniformMatrix4fv(p.u.uModel, false, mat);
    // 用 uv 偏移选择图标：直接改 quad 的 uv 太麻烦，这里用一个专用 VAO 缓存
    const key = iconIndex;
    let q = this['icon_' + key];
    if (!q) {
      const col = iconIndex % atlasCols, row = Math.floor(iconIndex / atlasCols);
      const u0 = col / atlasCols, v0 = row / atlasCols;
      const s = 1 / atlasCols;
      const verts = new Float32Array([
        -0.5, -0.5, 0, 0, 0, 1, u0, v0 + s,
        0.5, -0.5, 0, 0, 0, 1, u0 + s, v0 + s,
        0.5, 0.5, 0, 0, 0, 1, u0 + s, v0,
        -0.5, 0.5, 0, 0, 0, 1, u0, v0,
      ]);
      q = this.makeVAO(verts, new Uint16Array([0, 1, 2, 2, 3, 0]));
      this['icon_' + key] = q;
    }
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(q.vao);
    gl.drawElements(gl.TRIANGLES, q.count, gl.UNSIGNED_SHORT, 0);
    gl.enable(gl.CULL_FACE);
    gl.bindVertexArray(null);
  }

  /** 用世界着色器画方块立方体（掉落方块、手持方块） */
  drawBlockCube(blockName, matrix, env, camPos, lightLevel = 15) {
    const gl = this.gl;
    const cube = this.getBlockCube(blockName);
    if (!cube) return;
    const p = this.r.world;
    gl.useProgram(p.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.r.albedoTex);
    gl.uniform1i(p.u.uAlbedo, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.r.normalTex);
    gl.uniform1i(p.u.uNormal, 1);
    gl.uniformMatrix4fv(p.u.uProj, false, this.r.proj);
    gl.uniformMatrix4fv(p.u.uView, false, this.r.view);
    gl.uniformMatrix4fv(p.u.uModel, false, matrix);
    gl.uniform3fv(p.u.uCamera, camPos);
    gl.uniform3fv(p.u.uSunDir, env.sunDir);
    gl.uniform3fv(p.u.uSunColor, env.sunColor);
    gl.uniform3fv(p.u.uSkyColor, env.skyColor);
    gl.uniform3fv(p.u.uFogColor, env.fogColor);
    gl.uniform1f(p.u.uFogStart, 1e6);
    gl.uniform1f(p.u.uFogEnd, 1e7);
    gl.uniform1f(p.u.uDay, env.day);
    gl.uniform1f(p.u.uAlphaTest, 0.5);
    gl.uniform1f(p.u.uWaterLayer, -1);
    gl.uniform1f(p.u.uUnderwater, 0);
    gl.uniform1f(p.u.uTime, performance.now() / 1000);
    gl.vertexAttrib1f(4, lightLevel + 15 * 16);
    gl.vertexAttrib1f(5, 1);
    gl.vertexAttrib3f(6, 1, 1, 1);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(cube.vao);
    gl.drawElements(gl.TRIANGLES, cube.count, gl.UNSIGNED_SHORT, 0);
    gl.enable(gl.CULL_FACE);
    gl.bindVertexArray(null);
  }
}

export { SKINS, clamp, lerp };
