// 区块网格生成：面剔除 + 平滑光照 + 环境光遮蔽(AO)
// 顶点布局（12 个 float）：
//   0-2  位置
//   3    贴图层号
//   4-5  UV
//   6    面编号（着色器据此取切线基）
//   7    光照（sky + block*16）
//   8    AO（0..1）
//   9-11 染色

import { CHUNK_X, CHUNK_Y, CHUNK_Z, idx } from '../world/chunk.js';
import { BLOCKS, getBlock, RT, shouldRenderFace } from '../world/blocks.js';

export const FLOATS_PER_VERTEX = 12;

// 每个面的 4 个顶点：[位置偏移, uv, 角落符号(su,sv)]
const FACES = [
  { // 0 +X
    n: [1, 0, 0], du: [0, 0, 1], dv: [0, 1, 0],
    v: [
      [[1, 0, 1], [0, 1], [1, -1]],
      [[1, 0, 0], [1, 1], [-1, -1]],
      [[1, 1, 0], [1, 0], [-1, 1]],
      [[1, 1, 1], [0, 0], [1, 1]],
    ],
  },
  { // 1 -X
    n: [-1, 0, 0], du: [0, 0, 1], dv: [0, 1, 0],
    v: [
      [[0, 0, 0], [0, 1], [-1, -1]],
      [[0, 0, 1], [1, 1], [1, -1]],
      [[0, 1, 1], [1, 0], [1, 1]],
      [[0, 1, 0], [0, 0], [-1, 1]],
    ],
  },
  { // 2 +Y
    n: [0, 1, 0], du: [1, 0, 0], dv: [0, 0, 1],
    v: [
      [[0, 1, 1], [0, 1], [-1, 1]],
      [[1, 1, 1], [1, 1], [1, 1]],
      [[1, 1, 0], [1, 0], [1, -1]],
      [[0, 1, 0], [0, 0], [-1, -1]],
    ],
  },
  { // 3 -Y
    n: [0, -1, 0], du: [1, 0, 0], dv: [0, 0, 1],
    v: [
      [[0, 0, 0], [0, 1], [-1, -1]],
      [[1, 0, 0], [1, 1], [1, -1]],
      [[1, 0, 1], [1, 0], [1, 1]],
      [[0, 0, 1], [0, 0], [-1, 1]],
    ],
  },
  { // 4 +Z
    n: [0, 0, 1], du: [1, 0, 0], dv: [0, 1, 0],
    v: [
      [[0, 0, 1], [0, 1], [-1, -1]],
      [[1, 0, 1], [1, 1], [1, -1]],
      [[1, 1, 1], [1, 0], [1, 1]],
      [[0, 1, 1], [0, 0], [-1, 1]],
    ],
  },
  { // 5 -Z
    n: [0, 0, -1], du: [1, 0, 0], dv: [0, 1, 0],
    v: [
      [[1, 0, 0], [0, 1], [1, -1]],
      [[0, 0, 0], [1, 1], [-1, -1]],
      [[0, 1, 0], [1, 0], [-1, 1]],
      [[1, 1, 0], [0, 0], [1, 1]],
    ],
  },
];

export { FACES };

class MeshBuilder {
  constructor() {
    this.verts = [];
    this.indices = [];
    this.count = 0;
  }
  quad(positions, layer, uvs, face, lights, aos, tint, flip) {
    const base = this.count;
    for (let i = 0; i < 4; i++) {
      const p = positions[i];
      this.verts.push(
        p[0], p[1], p[2],
        layer,
        uvs[i][0], uvs[i][1],
        face,
        lights[i],
        aos[i],
        tint[0], tint[1], tint[2],
      );
    }
    this.count += 4;
    if (flip) {
      this.indices.push(base + 1, base + 2, base + 3, base + 3, base + 0, base + 1);
    } else {
      this.indices.push(base + 0, base + 1, base + 2, base + 2, base + 3, base + 0);
    }
  }
  isEmpty() {
    return this.indices.length === 0;
  }
  build() {
    return {
      vertices: new Float32Array(this.verts),
      indices: new Uint32Array(this.indices),
      count: this.indices.length,
    };
  }
}

const WHITE = [1, 1, 1];

/**
 * 生成区块网格。world 需提供 getBlock / getSky / getBlockLight / getBiomeAt / getMeta。
 * 返回 { opaque, transparent }
 */
export function buildChunkMesh(world, chunk) {
  const solid = new MeshBuilder();
  const alpha = new MeshBuilder();
  const ox = chunk.cx * CHUNK_X;
  const oz = chunk.cz * CHUNK_Z;

  // 局部缓存，减少跨区块查询
  const gb = (x, y, z) => world.getBlock(x, y, z);
  const isSolidForAO = (x, y, z) => {
    const b = BLOCKS[gb(x, y, z)];
    return b && b.opaque && b.render === RT.CUBE;
  };
  const lightOf = (x, y, z) => {
    const b = BLOCKS[gb(x, y, z)];
    if (b && b.filter >= 15) return -1;
    return world.getSky(x, y, z) + world.getBlockLight(x, y, z) * 16;
  };

  const tintCache = new Map();
  const tintFor = (x, z, kind) => {
    const k = ((x & 1023) << 11) | (z & 1023) | (kind === 'grass' ? 0 : 1 << 21);
    let t = tintCache.get(k);
    if (t) return t;
    // 与相邻列做一次平滑，让群系交界处颜色过渡自然
    let r = 0, g = 0, b = 0, n = 0;
    for (let dz = -2; dz <= 2; dz += 2) {
      for (let dx = -2; dx <= 2; dx += 2) {
        const bi = world.getBiomeAt(x + dx, z + dz);
        const c = kind === 'grass' ? bi.grass : kind === 'foliage' ? bi.foliage : bi.water;
        r += c[0]; g += c[1]; b += c[2]; n++;
      }
    }
    t = [r / n, g / n, b / n];
    tintCache.set(k, t);
    return t;
  };

  for (let y = 0; y < CHUNK_Y; y++) {
    for (let z = 0; z < CHUNK_Z; z++) {
      for (let x = 0; x < CHUNK_X; x++) {
        const id = chunk.blocks[idx(x, y, z)];
        if (id === 0) continue;
        const b = BLOCKS[id];
        if (!b || b.render === RT.NONE) continue;
        const wx = ox + x, wy = y, wz = oz + z;
        const mb = b.transparent ? alpha : solid;

        switch (b.render) {
          case RT.CROSS:
            emitCross(mb, world, wx, wy, wz, b, tintFor);
            break;
          case RT.TORCH:
            emitBox(mb, world, wx, wy, wz, b, [0.4375, 0, 0.4375, 0.5625, 0.625, 0.5625], tintFor, true);
            break;
          case RT.LADDER:
            emitLadder(mb, world, wx, wy, wz, b, chunk.meta[idx(x, y, z)]);
            break;
          case RT.LIQUID:
            emitLiquid(mb, world, wx, wy, wz, b, chunk.meta[idx(x, y, z)], tintFor,
              gb, lightOf, isSolidForAO);
            break;
          case RT.SLAB:
            emitBox(mb, world, wx, wy, wz, b, [0, 0, 0, 1, 0.5, 1], tintFor, false);
            break;
          case RT.CACTUS:
            emitBox(mb, world, wx, wy, wz, b, [0.0625, 0, 0.0625, 0.9375, 1, 0.9375], tintFor, false);
            break;
          default:
            emitCube(mb, world, wx, wy, wz, b, tintFor, gb, lightOf, isSolidForAO);
            break;
        }
      }
    }
  }

  return {
    opaque: solid.isEmpty() ? null : solid.build(),
    transparent: alpha.isEmpty() ? null : alpha.build(),
  };
}

function faceTint(b, face, wx, wz, tintFor) {
  if (!b.tint) return WHITE;
  if (b.tintFaces && !b.tintFaces.includes(face)) return WHITE;
  return tintFor(wx, wz, b.tint);
}

/** 完整立方体（含 AO 与平滑光照） */
function emitCube(mb, world, wx, wy, wz, b, tintFor, gb, lightOf, isSolidForAO) {
  for (let f = 0; f < 6; f++) {
    const F = FACES[f];
    const nx = wx + F.n[0], ny = wy + F.n[1], nz = wz + F.n[2];
    const neighbor = gb(nx, ny, nz);
    if (!shouldRenderFace(b.id, neighbor)) continue;

    const positions = [], uvs = [], lights = [], aos = [];
    for (let i = 0; i < 4; i++) {
      const [off, uv, sgn] = F.v[i];
      positions.push([wx + off[0], wy + off[1], wz + off[2]]);
      uvs.push(uv);
      const [su, sv] = sgn;
      const ux = F.du[0] * su, uy = F.du[1] * su, uz = F.du[2] * su;
      const vx = F.dv[0] * sv, vy = F.dv[1] * sv, vz = F.dv[2] * sv;
      const s1 = isSolidForAO(nx + ux, ny + uy, nz + uz) ? 1 : 0;
      const s2 = isSolidForAO(nx + vx, ny + vy, nz + vz) ? 1 : 0;
      const co = isSolidForAO(nx + ux + vx, ny + uy + vy, nz + uz + vz) ? 1 : 0;
      const ao = s1 && s2 ? 0 : 3 - (s1 + s2 + co);
      aos.push(0.42 + ao * 0.1933);

      // 平滑光照：取顶点周围 4 个格子的平均
      let sky = 0, blk = 0, n = 0;
      const samples = [
        [nx, ny, nz],
        [nx + ux, ny + uy, nz + uz],
        [nx + vx, ny + vy, nz + vz],
        [nx + ux + vx, ny + uy + vy, nz + uz + vz],
      ];
      for (const [sx, sy, sz] of samples) {
        const l = lightOf(sx, sy, sz);
        if (l < 0) continue;
        sky += l & 15;
        blk += (l >> 4) & 15;
        n++;
      }
      if (n === 0) { sky = world.getSky(nx, ny, nz); blk = world.getBlockLight(nx, ny, nz); n = 1; }
      lights.push(Math.round(sky / n) + Math.round(blk / n) * 16);
    }
    const flip = aos[0] + aos[2] > aos[1] + aos[3];
    mb.quad(positions, b.texLayers[f], uvs, f, lights, aos,
      faceTint(b, f, wx, wz, tintFor), flip);

    // 覆盖层（草方块侧面）
    if (b.overlay && b.overlay.faces.includes(f)) {
      const eps = 0.0025;
      const op = positions.map((p) => [p[0] + F.n[0] * eps, p[1] + F.n[1] * eps, p[2] + F.n[2] * eps]);
      mb.quad(op, b.overlay.layer, uvs, f, lights, aos,
        tintFor(wx, wz, b.overlay.tint), flip);
    }
  }
}

/** 任意长方体（台阶、火把、仙人掌） */
function emitBox(mb, world, wx, wy, wz, b, box, tintFor, alwaysDraw) {
  const [x0, y0, z0, x1, y1, z1] = box;
  for (let f = 0; f < 6; f++) {
    const F = FACES[f];
    if (!alwaysDraw) {
      const full = (f === 3 && y0 === 0) || (f === 2 && y1 === 1) ||
        (f === 0 && x1 === 1) || (f === 1 && x0 === 0) || (f === 4 && z1 === 1) || (f === 5 && z0 === 0);
      if (full) {
        const nb = world.getBlock(wx + F.n[0], wy + F.n[1], wz + F.n[2]);
        if (!shouldRenderFace(b.id, nb)) continue;
      }
    }
    const positions = [], uvs = [], lights = [], aos = [];
    for (let i = 0; i < 4; i++) {
      const [off, uv] = F.v[i];
      positions.push([
        wx + (off[0] ? x1 : x0),
        wy + (off[1] ? y1 : y0),
        wz + (off[2] ? z1 : z0),
      ]);
      // 侧面 UV 需要按照实际高度裁剪，避免拉伸
      let u = uv[0], v = uv[1];
      if (f !== 2 && f !== 3) v = uv[1] === 0 ? 1 - y1 : 1 - y0;
      uvs.push([u, v]);
      const sky = world.getSky(wx + F.n[0], wy + F.n[1], wz + F.n[2]);
      const blk = world.getBlockLight(wx + F.n[0], wy + F.n[1], wz + F.n[2]);
      lights.push(sky + blk * 16);
      aos.push(1);
    }
    mb.quad(positions, b.texLayers[f], uvs, f, lights, aos,
      faceTint(b, f, wx, wz, tintFor), false);
  }
}

/** 十字植物：两个交叉的双面平面 */
function emitCross(mb, world, wx, wy, wz, b, tintFor) {
  const sky = world.getSky(wx, wy, wz);
  const blk = world.getBlockLight(wx, wy, wz);
  const l = Math.max(sky, world.getSky(wx, wy + 1, wz) - 1) + blk * 16;
  const lights = [l, l, l, l];
  const aos = [0.92, 0.92, 1, 1];
  const tint = b.tint ? tintFor(wx, wz, b.tint) : WHITE;
  const layer = b.texLayers[0];
  const k = 0.1464;   // (1 - 1/√2)/2，让对角线正好填满方块
  const planes = [
    [[k, 0, k], [1 - k, 0, 1 - k]],
    [[1 - k, 0, k], [k, 0, 1 - k]],
  ];
  for (const [p0, p1] of planes) {
    const A0 = [wx + p0[0], wy, wz + p0[2]];
    const A1 = [wx + p1[0], wy, wz + p1[2]];
    const B0 = [A0[0], wy + 1, A0[2]];
    const B1 = [A1[0], wy + 1, A1[2]];
    // 正反两面都画，避免背面被剔除
    mb.quad([A0, A1, B1, B0], layer, [[0, 1], [1, 1], [1, 0], [0, 0]], 2, lights, aos, tint, false);
    mb.quad([A1, A0, B0, B1], layer, [[0, 1], [1, 1], [1, 0], [0, 0]], 2, lights, aos, tint, false);
  }
}

/** 梯子：贴在墙上的单面（meta 存朝向） */
function emitLadder(mb, world, wx, wy, wz, b, meta) {
  const f = meta < 6 ? meta : 5;
  const F = FACES[f];
  const eps = 0.06;
  const positions = [], uvs = [];
  for (let i = 0; i < 4; i++) {
    const [off, uv] = F.v[i];
    positions.push([
      wx + off[0] - F.n[0] * eps,
      wy + off[1],
      wz + off[2] - F.n[2] * eps,
    ]);
    uvs.push(uv);
  }
  const l = world.getSky(wx, wy, wz) + world.getBlockLight(wx, wy, wz) * 16;
  const lights = [l, l, l, l];
  const aos = [1, 1, 1, 1];
  mb.quad(positions, b.texLayers[f], uvs, f, lights, aos, WHITE, false);
  mb.quad([positions[1], positions[0], positions[3], positions[2]],
    b.texLayers[f], uvs, f, lights, aos, WHITE, false);
}

/** 液体：顶面高度随流动等级下降 */
function emitLiquid(mb, world, wx, wy, wz, b, meta, tintFor, gb, lightOf, isSolidForAO) {
  const above = gb(wx, wy + 1, wz);
  const sameAbove = above === b.id;
  const levelHeight = (m) => 1 - Math.min(m, 7) / 9 - 0.06;
  const h = sameAbove ? 1 : levelHeight(meta);
  const tint = b.tint ? tintFor(wx, wz, b.tint) : WHITE;

  for (let f = 0; f < 6; f++) {
    const F = FACES[f];
    const nb = gb(wx + F.n[0], wy + F.n[1], wz + F.n[2]);
    if (!shouldRenderFace(b.id, nb)) continue;
    if (f === 2 && sameAbove) continue;

    const positions = [], uvs = [], lights = [], aos = [];
    for (let i = 0; i < 4; i++) {
      const [off, uv] = F.v[i];
      const py = off[1] ? h : 0;
      positions.push([wx + off[0], wy + py, wz + off[2]]);
      let v = uv[1];
      if (f !== 2 && f !== 3 && uv[1] === 0) v = 1 - h;
      uvs.push([uv[0], v]);
      const sky = world.getSky(wx + F.n[0], wy + F.n[1], wz + F.n[2]);
      const blk = world.getBlockLight(wx + F.n[0], wy + F.n[1], wz + F.n[2]);
      lights.push(sky + blk * 16);
      aos.push(1);
    }
    mb.quad(positions, b.texLayers[f], uvs, f, lights, aos, tint, false);
    // 水面从下方也要可见
    if (f === 2) {
      mb.quad([positions[3], positions[2], positions[1], positions[0]],
        b.texLayers[f], [uvs[3], uvs[2], uvs[1], uvs[0]], 3, lights, aos, tint, false);
    }
  }
  void isSolidForAO; void lightOf; void getBlock;
}
