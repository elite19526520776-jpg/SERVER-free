// 程序化 PBR 材质生成
// 所有方块材质都在运行时用噪声算法生成，不依赖任何外部图片资源。
// 每个材质产出三样东西：
//   1. albedo  —— 基础色 (RGBA，A 用于镂空)
//   2. normal  —— 由高度场经 Sobel 求得的切线空间法线
//   3. rough   —— 粗糙度（打包进法线贴图的 A 通道）
// 渲染器把它们上传成两个 WebGL2 TEXTURE_2D_ARRAY，从根本上避免图集渗色。

import { Perlin, voronoiTile, hash01, clamp, lerp, smoothstep } from '../util/noise.js';

export const TEX_SIZE = 64;

const P = new Perlin(20240501);
const P2 = new Perlin(77113);

/** 十六进制颜色 → [r,g,b] (0..1) */
function hex(h) {
  return [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
}
function mix3(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/** 材质画布：浮点颜色 + 高度 + 粗糙度 */
class Tex {
  constructor(size = TEX_SIZE) {
    this.size = size;
    this.col = new Float32Array(size * size * 4);
    this.height = new Float32Array(size * size);
    this.rough = new Float32Array(size * size).fill(0.85);
    this.metal = new Float32Array(size * size);
    for (let i = 0; i < size * size; i++) this.col[i * 4 + 3] = 1;
  }
  idx(x, y) {
    const s = this.size;
    return (((y % s) + s) % s) * s + (((x % s) + s) % s);
  }
  set(x, y, rgb, a = 1) {
    const i = this.idx(x, y) * 4;
    this.col[i] = rgb[0];
    this.col[i + 1] = rgb[1];
    this.col[i + 2] = rgb[2];
    this.col[i + 3] = a;
  }
  get(x, y) {
    const i = this.idx(x, y) * 4;
    return [this.col[i], this.col[i + 1], this.col[i + 2]];
  }
  setH(x, y, h) {
    this.height[this.idx(x, y)] = h;
  }
  setR(x, y, r) {
    this.rough[this.idx(x, y)] = r;
  }
  setM(x, y, m) {
    this.metal[this.idx(x, y)] = m;
  }
  /** 遍历每个像素，回调收到 (x, y, u, v)，u/v ∈ [0,1) */
  each(fn) {
    const s = this.size;
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) fn(x, y, x / s, y / s);
    }
  }
  /** 整体填充 */
  fill(rgb, a = 1) {
    this.each((x, y) => this.set(x, y, rgb, a));
  }
  /** 矩形 */
  rect(x0, y0, w, h, rgb, a = 1) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, rgb, a);
  }
  /** 让高度场等于亮度（多数材质的默认做法） */
  heightFromLuma(scale = 1) {
    this.each((x, y) => {
      const c = this.get(x, y);
      this.setH(x, y, (c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11) * scale);
    });
  }
}

// ── 通用材质构件 ────────────────────────────────────────────────

/** 带颗粒感的岩石类底材 */
function rockBase(t, color, opts = {}) {
  const {
    grain = 0.10,      // 细颗粒强度
    blotch = 0.08,     // 大块色斑强度
    cells = 10,        // 元胞密度（矿物晶粒）
    cellStrength = 0.07,
    rough = 0.92,
    seed = 1,
  } = opts;
  const { speckle = 0.085 } = opts;
  t.each((x, y, u, v) => {
    const fine = P.tileFbm2(u * 16, v * 16, 16, 4) * grain;
    const micro = P2.tileFbm2(u * 32, v * 32, 32, 2) * grain * 0.8;
    const big = P2.tileFbm2(u * 4 + seed, v * 4, 4, 3) * blotch;
    const vor = voronoiTile(u, v, cells, seed);
    // 晶粒：边界暗、粒内亮度随机，模拟矿物颗粒
    const edge = smoothstep(0, 0.045, vor.f2 - vor.f1);
    const cell = (edge - 0.5) * cellStrength * 2.2;
    const grainTone = ((vor.id % 97) / 97 - 0.5) * cellStrength * 1.6;
    const dust = (hash01(x, y, seed * 31 + 7) - 0.5) * speckle;
    const l = 1 + fine + micro + big + cell + grainTone + dust;
    t.set(x, y, [color[0] * l, color[1] * l, color[2] * l]);
    t.setR(x, y, clamp(rough + fine * 0.6, 0.35, 1));
  });
  t.heightFromLuma(1);
}

/** 泥土类：湿润、团粒、混杂小石子 */
function soilBase(t, color, opts = {}) {
  const { pebbles = 0.35, rough = 0.95, seed = 3 } = opts;
  t.each((x, y, u, v) => {
    const clump = P.tileFbm2(u * 8 + seed, v * 8, 8, 4) * 0.17;
    const fine = P2.tileFbm2(u * 26, v * 26, 26, 3) * 0.11;
    const dust = (hash01(x, y, seed * 17 + 3) - 0.5) * 0.11;
    let l = 1 + clump + fine + dust;
    let c = [color[0] * l, color[1] * l, color[2] * l];
    const vor = voronoiTile(u, v, 12, seed + 5);
    if (vor.f1 < 0.022 && hash01(vor.id) < pebbles) {
      const g = 0.34 + (vor.id % 40) / 260;
      c = mix3(c, [g, g * 0.95, g * 0.88], 0.6);
    }
    t.set(x, y, c);
    t.setR(x, y, clamp(rough - clump, 0.6, 1));
  });
  t.heightFromLuma(1);
}

/** 草叶层：一簇簇细密的叶尖 */
function grassLayer(t, base, tip, density = 1, alphaCut = false) {
  t.each((x, y, u, v) => {
    const blade = P.tileFbm2(u * 26, v * 26, 26, 3);
    const clump = P2.tileFbm2(u * 5, v * 5, 5, 3);
    const streak = P.tileNoise2xy(u * 40, v * 12, 40, 12);
    const m = clamp(0.5 + blade * 0.9 + clump * 0.5 + streak * 0.25, 0, 1);
    const c = mix3(base, tip, m);
    const shade = 1 + (m - 0.5) * 0.28;
    const a = alphaCut ? (m > 0.5 - 0.42 * density ? 1 : 0) : 1;
    t.set(x, y, [c[0] * shade, c[1] * shade, c[2] * shade], a);
    t.setR(x, y, 0.88 - m * 0.12);
    t.setH(x, y, m * 0.8);
  });
}

/**
 * 树皮：纵向纤维 + 深裂纹。
 * 纹理沿 u（水平）方向重复，沿 v（垂直）方向拉长，符合树干的真实走向。
 */
function barkTexture(t, light, dark, opts = {}) {
  const {
    cracks = 7, fiberFreq = 26, rough = 0.94, contrast = 1,
    crackDepth = 1, seed = 2,
  } = opts;
  t.each((x, y, u, v) => {
    // 三层纤维：粗块 → 主纹理 → 细毛刺，纵向拉长
    const coarse = P2.tileFbm2xy(u * 5 + seed * 2, v * 2, 5, 2, 3);
    const fiber = P.tileFbm2xy(u * fiberFreq + seed, v * 7, fiberFreq, 7, 4);
    const micro = P2.tileFbm2xy(u * fiberFreq * 2.2 + seed, v * 16, fiberFreq * 2.2, 16, 2);
    const dust = (hash01(x, y, seed * 13) - 0.5) * 0.12;
    let m = clamp(0.5 + coarse * 0.42 + fiber * 0.52 + micro * 0.3 + dust, 0, 1);
    // 纵向深裂沟
    const crack = Math.abs(P.tileNoise2xy(u * cracks + seed * 3, v * 1.8, cracks, 1.8));
    const deep = smoothstep(0.085, 0.0, crack) * crackDepth;
    const shade = clamp((m * 0.66 + deep * 0.7) * contrast, 0, 1);
    const c = mix3(light, dark, shade);
    t.set(x, y, c);
    t.setR(x, y, rough - m * 0.06);
    t.setH(x, y, (1 - deep * 0.85) * (0.35 + m * 0.65));
  });
}

/** 木板：多块木条拼接，条与条之间有缝 */
function planks(t, light, dark, seed = 1) {
  const s = t.size;
  const plankH = s / 4;
  t.each((x, y, u, v) => {
    const row = Math.floor(y / plankH);
    const off = hash01(row, seed) * 10;
    const local = (y % plankH) / plankH;
    // 木板纹理沿 x 方向延伸：低频在 u，高频在 v
    const warp = P.tileFbm2xy(u * 3 + off, v * 6, 3, 6, 3) * 0.32;
    const fib = P2.tileFbm2xy(u * 5 + off, v * 30, 5, 30, 3) * 0.55;
    let m = clamp(0.45 + warp * 0.9 + fib * 0.5, 0, 1);
    let c = mix3(light, dark, m);
    let h = 1 - m * 0.4;
    // 木板之间的缝隙
    const edge = local < 0.055 || local > 0.955;
    if (edge) {
      c = mix3(c, [0.05, 0.035, 0.02], 0.62);
      h = 0.05;
    }
    // 竖向断口
    const segW = s / 2;
    const segX = (x + Math.floor(hash01(row, seed + 3) * s)) % s;
    if (segX % segW < 1) {
      c = mix3(c, [0.06, 0.04, 0.03], 0.55);
      h = 0.08;
    }
    t.set(x, y, c);
    t.setR(x, y, 0.7 + m * 0.15);
    t.setH(x, y, h);
  });
}

/** 树叶：镂空 + 多层叠影 */
function leaves(t, color, opts = {}) {
  const { density = 0.62, needle = false, seed = 4 } = opts;
  t.each((x, y, u, v) => {
    const n1 = needle
      ? Math.abs(P.tileNoise2xy(u * 30, v * 9, 30, 9))
      : P.tileFbm2(u * 12 + seed, v * 12, 12, 3) * 0.5 + 0.5;
    const n2 = P2.tileFbm2(u * 26, v * 26, 26, 2) * 0.5 + 0.5;
    const m = n1 * 0.65 + n2 * 0.35;
    const solid = m > 1 - density;
    if (!solid) {
      t.set(x, y, [0, 0, 0], 0);
      t.setH(x, y, 0);
      return;
    }
    const depth = clamp((m - (1 - density)) / density, 0, 1);
    const shade = 0.62 + depth * 0.58;
    const hueShift = (n2 - 0.5) * 0.12;
    t.set(x, y, [
      clamp(color[0] * shade + hueShift * 0.3, 0, 1),
      clamp(color[1] * shade + hueShift, 0, 1),
      clamp(color[2] * shade, 0, 1),
    ], 1);
    t.setR(x, y, 0.8);
    t.setH(x, y, depth);
  });
}

/** 在底材上撒矿脉 */
function oreOverlay(t, oreCol, opts = {}) {
  const { blobs = 5, size = 0.115, metal = 0.0, rough = 0.4, glow = 0 } = opts;
  const spots = [];
  for (let i = 0; i < blobs; i++) {
    spots.push([hash01(i, 1, opts.seed || 0), hash01(i, 2, opts.seed || 0), size * (0.6 + hash01(i, 3) * 0.8)]);
  }
  t.each((x, y, u, v) => {
    let best = 1e9;
    for (const [sx, sy, sr] of spots) {
      let dx = Math.abs(u - sx); dx = Math.min(dx, 1 - dx);
      let dy = Math.abs(v - sy); dy = Math.min(dy, 1 - dy);
      const wob = P.tileFbm2(u * 10, v * 10, 10, 3) * 0.035;
      const d = Math.sqrt(dx * dx + dy * dy) - sr - wob;
      best = Math.min(best, d);
    }
    if (best < 0) {
      const core = clamp(-best / size, 0, 1);
      const sparkle = P2.tileFbm2(u * 30, v * 30, 30, 2) * 0.22;
      const l = 0.72 + core * 0.5 + sparkle;
      t.set(x, y, [clamp(oreCol[0] * l, 0, 1), clamp(oreCol[1] * l, 0, 1), clamp(oreCol[2] * l, 0, 1)]);
      t.setR(x, y, rough);
      t.setM(x, y, metal);
      t.setH(x, y, 0.55 + core * 0.45);
    }
  });
}

/** 砖块 / 石砖：错缝砌法 */
function brickPattern(t, brick, mortar, opts = {}) {
  const { rows = 4, cols = 2, mortarW = 0.055, jitter = 0.06, seed = 6 } = opts;
  t.each((x, y, u, v) => {
    const ry = v * rows;
    const row = Math.floor(ry);
    const fy = ry - row;
    const shift = row % 2 === 0 ? 0 : 0.5;
    const rx = (u + shift) * cols;
    const col = Math.floor(rx);
    const fx = rx - col;
    const isMortar = fy < mortarW * rows * 0.5 || fy > 1 - mortarW * rows * 0.5 ||
                     fx < mortarW * cols * 0.5 || fx > 1 - mortarW * cols * 0.5;
    if (isMortar) {
      const g = P.tileFbm2(u * 30, v * 30, 30, 3) * 0.12;
      t.set(x, y, [mortar[0] + g, mortar[1] + g, mortar[2] + g]);
      t.setR(x, y, 0.97);
      t.setH(x, y, 0.12);
    } else {
      const tone = (hash01(row, col, seed) - 0.5) * jitter * 2;
      const grit = P.tileFbm2(u * 22, v * 22, 22, 3) * 0.13
        + P2.tileFbm2(u * 44, v * 44, 44, 2) * 0.08
        + (hash01(x, y, seed + 5) - 0.5) * 0.09;
      const edge = smoothstep(0, 0.12, Math.min(fx, 1 - fx)) * smoothstep(0, 0.16, Math.min(fy, 1 - fy));
      const l = 1 + tone + grit;
      const c = [brick[0] * l, brick[1] * l, brick[2] * l];
      t.set(x, y, mix3([c[0] * 0.7, c[1] * 0.7, c[2] * 0.7], c, edge));
      t.setR(x, y, 0.9);
      t.setH(x, y, 0.45 + edge * 0.55);
    }
  });
}

/** 苔藓覆盖（用于苔石、苔石砖） */
function mossOverlay(t, mossCol = hex(0x4f6f34), coverage = 0.5) {
  t.each((x, y, u, v) => {
    const m = P.tileFbm2(u * 6 + 31, v * 6, 6, 4) * 0.5 + 0.5;
    const fine = P2.tileFbm2(u * 22, v * 22, 22, 2) * 0.2;
    if (m + fine > 1 - coverage) {
      const k = clamp((m + fine - (1 - coverage)) / coverage, 0, 1);
      const c = t.get(x, y);
      const shade = 0.75 + fine * 1.6;
      t.set(x, y, mix3(c, [mossCol[0] * shade, mossCol[1] * shade, mossCol[2] * shade], k * 0.92));
      t.setR(x, y, 0.95);
      t.setH(x, y, t.height[t.idx(x, y)] * 0.6 + k * 0.4);
    }
  });
}

/** 金属/宝石方块：高反射，带斜面 */
function mineralBlock(t, color, opts = {}) {
  const { metal = 1, rough = 0.22, facets = 4, gem = false } = opts;
  t.each((x, y, u, v) => {
    const vor = voronoiTile(u, v, facets, gem ? 12 : 4);
    const face = (vor.id % 61) / 61;
    const edge = smoothstep(0, 0.06, vor.f2 - vor.f1);
    const grain = P.tileFbm2(u * 20, v * 20, 20, 3) * 0.05;
    const l = 0.82 + face * 0.34 + grain + (1 - edge) * 0.25;
    t.set(x, y, [clamp(color[0] * l, 0, 1), clamp(color[1] * l, 0, 1), clamp(color[2] * l, 0, 1)]);
    t.setR(x, y, clamp(rough + (1 - edge) * 0.25 + grain, 0.05, 1));
    t.setM(x, y, metal);
    t.setH(x, y, 0.35 + edge * 0.65);
  });
}

/** 十字植物：在透明底上画茎与叶/花 */
function plantCross(t, stemCol, leafCol, flowerCol, opts = {}) {
  const { height = 0.9, bushy = 0.5, flower = false, flowerSize = 0.1, seed = 8 } = opts;
  t.fill([0, 0, 0], 0);
  const s = t.size;
  const stems = 4 + Math.floor(bushy * 7);
  for (let i = 0; i < stems; i++) {
    const baseX = 0.16 + hash01(i, seed) * 0.68;
    const bend = (hash01(i, seed + 1) - 0.5) * 0.62;
    const h = height * (0.45 + hash01(i, seed + 2) * 0.55);
    const thick = 1.1 + hash01(i, seed + 3) * 1.5;
    const steps = 96;
    for (let step = 0; step <= steps; step++) {
      const tt = (step / steps) * h;
      // 叶片自然弯曲：越靠近尖端偏移越大
      const px = (baseX + bend * tt * tt) * s;
      const py = (1 - tt) * s;
      // 尖端收细
      const w = Math.max(0, thick * (1 - Math.pow(tt / Math.max(h, 0.01), 1.6)));
      const shade = 0.6 + tt * 0.62 + hash01(i, step) * 0.1;
      const c = mix3(stemCol, leafCol, clamp(tt / Math.max(h, 0.01), 0, 1));
      const iw = Math.ceil(w);
      for (let dx = -iw; dx <= iw; dx++) {
        if (Math.abs(dx) > w) continue;
        const xx = Math.round(px + dx), yy = Math.round(py);
        if (xx < 0 || xx >= s || yy < 0 || yy >= s) continue;
        // 叶片中脉略亮，边缘略暗
        const rib = 1 - Math.abs(dx) / (w + 0.6) * 0.3;
        t.set(xx, yy, [c[0] * shade * rib, c[1] * shade * rib, c[2] * shade * rib], 1);
        t.setR(xx, yy, 0.85);
        t.setH(xx, yy, 0.55 + rib * 0.45);
      }
    }
    if (flower && i < 3) {
      const fx = (baseX + bend * h * h) * s;
      const fy = (1 - h) * s;
      const r = flowerSize * s;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > r) continue;
          const xx = Math.round(fx + dx), yy = Math.round(fy + dy);
          if (xx < 0 || xx >= s || yy < 0 || yy >= s) continue;
          const petal = Math.abs(Math.sin(Math.atan2(dy, dx) * 3)) * 0.35 + 0.75;
          const c = d < r * 0.32 ? [0.95, 0.85, 0.35] : flowerCol;
          t.set(xx, yy, [clamp(c[0] * petal, 0, 1), clamp(c[1] * petal, 0, 1), clamp(c[2] * petal, 0, 1)], 1);
          t.setR(xx, yy, 0.7);
          t.setH(xx, yy, 0.9);
        }
      }
    }
  }
}

// ── 材质注册表 ─────────────────────────────────────────────────

/** name → generator，按注册顺序决定纹理数组的层号 */
export const TEXTURES = {};
function def(name, gen) {
  TEXTURES[name] = gen;
}

// 石材
def('stone', (t) => rockBase(t, hex(0x7d7d7d), { cells: 14, seed: 1 }));
def('granite', (t) => rockBase(t, hex(0x9a6b5b), { cells: 9, cellStrength: 0.13, blotch: 0.12, seed: 2 }));
def('diorite', (t) => rockBase(t, hex(0xc6c6c8), { cells: 9, cellStrength: 0.09, blotch: 0.08, speckle: 0.13, seed: 3 }));
def('andesite', (t) => rockBase(t, hex(0x888a88), { cells: 12, cellStrength: 0.1, seed: 4 }));
def('deepslate', (t) => rockBase(t, hex(0x4b4b50), { cells: 16, grain: 0.13, seed: 21 }));
def('bedrock', (t) => {
  rockBase(t, hex(0x4a4a4e), { cells: 7, cellStrength: 0.34, grain: 0.2, blotch: 0.26, speckle: 0.16, seed: 5 });
  t.each((x, y, u, v) => {
    const n = P.tileFbm2(u * 9 + 13, v * 9, 9, 4) * 0.5 + 0.5;
    const c = t.get(x, y);
    // 大块明暗交错，边界柔和
    const k = smoothstep(0.42, 0.62, n);
    t.set(x, y, mix3([c[0] * 0.42, c[1] * 0.42, c[2] * 0.46], [c[0] * 1.35, c[1] * 1.35, c[2] * 1.3], k));
  });
  t.heightFromLuma();
});
def('cobblestone', (t) => {
  t.fill(hex(0x4c4c4c));
  t.each((x, y, u, v) => {
    const vor = voronoiTile(u, v, 5, 11);
    const rockShade = 0.55 + ((vor.id % 53) / 53) * 0.55;
    const bevel = smoothstep(0, 0.075, vor.f2 - vor.f1);
    const grit = P.tileFbm2(u * 24, v * 24, 24, 3) * 0.1;
    const base = hex(0x7f7f7f);
    const l = rockShade * (0.55 + bevel * 0.65) + grit;
    t.set(x, y, [base[0] * l, base[1] * l, base[2] * l]);
    t.setR(x, y, 0.93);
    t.setH(x, y, bevel * 0.9 + 0.05);
  });
});
def('mossy_cobblestone', (t) => {
  TEXTURES.cobblestone(t);
  mossOverlay(t, hex(0x4c6b32), 0.55);
});
def('stone_bricks', (t) => brickPattern(t, hex(0x7a7a7a), hex(0x4a4a4a), { rows: 2, cols: 2, mortarW: 0.05, jitter: 0.1, seed: 12 }));
def('mossy_stone_bricks', (t) => {
  TEXTURES.stone_bricks(t);
  mossOverlay(t, hex(0x4c6b32), 0.5);
});
def('bricks', (t) => brickPattern(t, hex(0x96513a), hex(0xb0aca6), { rows: 4, cols: 2, mortarW: 0.05, jitter: 0.13, seed: 7 }));
def('obsidian', (t) => {
  t.each((x, y, u, v) => {
    const vor = voronoiTile(u, v, 6, 33);
    const facet = (vor.id % 41) / 41;
    const edge = smoothstep(0, 0.05, vor.f2 - vor.f1);
    const sheen = P.tileFbm2(u * 12, v * 12, 12, 3) * 0.1;
    const base = mix3(hex(0x0d0b17), hex(0x241d3a), facet * 0.8 + sheen + (1 - edge) * 0.5);
    t.set(x, y, base);
    t.setR(x, y, 0.18 + facet * 0.1);
    t.setM(x, y, 0.25);
    t.setH(x, y, edge * 0.8 + 0.1);
  });
});

// 土壤
def('dirt', (t) => soilBase(t, hex(0x866043)));
def('coarse_dirt', (t) => soilBase(t, hex(0x77563b), { pebbles: 0.6 }));
def('dirt_path_top', (t) => {
  soilBase(t, hex(0x94794a), { pebbles: 0.45 });
  // 被踩实的路面：局部压平、少量车辙
  t.each((x, y, u, v) => {
    const packed = P.tileFbm2(u * 5 + 21, v * 5, 5, 3) * 0.5 + 0.5;
    const c = t.get(x, y);
    const l = 0.92 + packed * 0.2;
    t.set(x, y, [c[0] * l, c[1] * l, c[2] * l]);
    t.setH(x, y, t.height[t.idx(x, y)] * 0.6);
  });
});
// 草类贴图使用近似灰度的底色，实际颜色由生物群系染色决定（与原版一致）
def('grass_top', (t) => grassLayer(t, hex(0x7d8f74), hex(0xbfcbb0)));
def('grass_side', (t) => soilBase(t, hex(0x866043)));
def('grass_side_overlay', (t) => {
  // 只有顶部草皮部分不透明，其余镂空，叠加在泥土侧面之上并接受染色
  t.fill([0, 0, 0], 0);
  t.each((x, y, u, v) => {
    const edge = 0.16 + P.tileNoise2xy(u * 8, 3.3, 8, 8) * 0.16 + P2.tileNoise2xy(u * 20, 1.1, 20, 20) * 0.06;
    if (v < edge) {
      const m = clamp(0.5 + P.tileFbm2(u * 26, v * 26, 26, 3) * 0.9, 0, 1);
      const c = mix3(hex(0x6f8168), hex(0xc2cfb2), m);
      t.set(x, y, c, 1);
      t.setR(x, y, 0.88);
      t.setH(x, y, 0.65 + m * 0.3);
    }
  });
});
def('podzol_top', (t) => {
  soilBase(t, hex(0x5b3f22), { pebbles: 0.1 });
  t.each((x, y, u, v) => {
    const n = P.tileFbm2(u * 9, v * 9, 9, 4) * 0.5 + 0.5;
    if (n > 0.52) {
      const c = t.get(x, y);
      t.set(x, y, mix3(c, hex(0xc07b2e), (n - 0.52) * 2.4));
    }
  });
  t.heightFromLuma();
});
def('podzol_side', (t) => {
  soilBase(t, hex(0x866043));
  t.each((x, y, u, v) => {
    const edge = 0.18 + P.tileNoise2xy(u * 7, 2.1, 7, 7) * 0.12;
    if (v < edge) t.set(x, y, mix3(hex(0x5b3f22), hex(0xa9691f), P.tileFbm2(u * 14, v * 14, 14, 3) * 0.5 + 0.5));
  });
  t.heightFromLuma();
});
def('mycelium_top', (t) => {
  soilBase(t, hex(0x6f6272), { pebbles: 0.05 });
  t.each((x, y, u, v) => {
    const n = P.tileFbm2(u * 13, v * 13, 13, 4) * 0.5 + 0.5;
    if (n > 0.55) t.set(x, y, mix3(t.get(x, y), hex(0x9c8ba0), (n - 0.55) * 2.2));
  });
  t.heightFromLuma();
});
def('mycelium_side', (t) => {
  soilBase(t, hex(0x866043));
  t.each((x, y, u, v) => {
    const edge = 0.17 + P.tileNoise2xy(u * 7, 5.1, 7, 7) * 0.12;
    if (v < edge) t.set(x, y, mix3(hex(0x6f6272), hex(0x9c8ba0), P.tileFbm2(u * 12, v * 12, 12, 3) * 0.5 + 0.5));
  });
  t.heightFromLuma();
});
def('farmland', (t) => {
  soilBase(t, hex(0x6b4a2b), { pebbles: 0.2 });
  t.each((x, y, u, v) => {
    const furrow = Math.sin(v * Math.PI * 4) * 0.5 + 0.5;
    const c = t.get(x, y);
    const l = 0.78 + furrow * 0.34;
    t.set(x, y, [c[0] * l, c[1] * l, c[2] * l]);
    t.setH(x, y, furrow);
  });
});
def('farmland_wet', (t) => {
  TEXTURES.farmland(t);
  t.each((x, y) => {
    const c = t.get(x, y);
    t.set(x, y, [c[0] * 0.72, c[1] * 0.6, c[2] * 0.5]);
    t.setR(x, y, 0.35);
  });
});

// 沙 / 砾石 / 黏土
def('sand', (t) => {
  t.each((x, y, u, v) => {
    const dune = P.tileFbm2(u * 6, v * 6, 6, 3) * 0.085;
    const grain = P2.tileFbm2(u * 30, v * 30, 30, 3) * 0.115;
    const sparkle = hash01(x, y, 5) > 0.992 ? 0.12 : 0;
    const base = hex(0xdbcd97);
    const l = 1 + dune + grain + sparkle;
    t.set(x, y, [clamp(base[0] * l, 0, 1), clamp(base[1] * l, 0, 1), clamp(base[2] * l, 0, 1)]);
    t.setR(x, y, 0.96 - sparkle);
    t.setH(x, y, 0.5 + grain * 2.2 + dune * 2.4);
  });
});
def('red_sand', (t) => {
  TEXTURES.sand(t);
  t.each((x, y) => {
    const c = t.get(x, y);
    t.set(x, y, [clamp(c[0] * 1.1, 0, 1), c[1] * 0.62, c[2] * 0.42]);
  });
});
def('gravel', (t) => {
  t.each((x, y, u, v) => {
    const vor = voronoiTile(u, v, 9, 21);
    const stone = (vor.id % 71) / 71;
    const bevel = smoothstep(0, 0.05, vor.f2 - vor.f1);
    const tint = stone < 0.25 ? hex(0x6d6d6d) : stone < 0.6 ? hex(0x8a8175) : hex(0x9d9d9d);
    const grit = P.tileFbm2(u * 26, v * 26, 26, 3) * 0.11;
    const l = 0.6 + bevel * 0.6 + grit;
    t.set(x, y, [tint[0] * l, tint[1] * l, tint[2] * l]);
    t.setR(x, y, 0.94);
    t.setH(x, y, bevel);
  });
});
def('clay', (t) => {
  t.each((x, y, u, v) => {
    const n = P.tileFbm2(u * 10, v * 10, 10, 4) * 0.09;
    const base = hex(0xa4a8b8);
    t.set(x, y, [base[0] + n, base[1] + n, base[2] + n]);
    t.setR(x, y, 0.62);
    t.setH(x, y, 0.5 + n * 3);
  });
});
def('sandstone_top', (t) => {
  TEXTURES.sand(t);
  t.each((x, y) => {
    const c = t.get(x, y);
    t.set(x, y, [c[0] * 0.97, c[1] * 0.97, c[2] * 0.95]);
    t.setR(x, y, 0.9);
  });
});
def('sandstone_side', (t) => {
  t.each((x, y, u, v) => {
    const strata = Math.sin(v * Math.PI * 9 + P.tileFbm2(u * 3, v * 3, 3, 2) * 3) * 0.5 + 0.5;
    const grain = P2.tileFbm2(u * 26, v * 26, 26, 3) * 0.1;
    const base = mix3(hex(0xd6c79a), hex(0xc4b183), strata);
    const l = 1 + grain;
    t.set(x, y, [clamp(base[0] * l, 0, 1), clamp(base[1] * l, 0, 1), clamp(base[2] * l, 0, 1)]);
    t.setR(x, y, 0.93);
    t.setH(x, y, strata * 0.6 + grain * 2);
  });
});
def('red_sandstone_top', (t) => {
  TEXTURES.red_sand(t);
});
def('red_sandstone_side', (t) => {
  TEXTURES.sandstone_side(t);
  t.each((x, y) => {
    const c = t.get(x, y);
    t.set(x, y, [clamp(c[0] * 1.08, 0, 1), c[1] * 0.58, c[2] * 0.36]);
  });
});

// 矿石
function ore(name, col, opts) {
  def(name, (t) => {
    TEXTURES.stone(t);
    oreOverlay(t, col, opts);
  });
}
ore('coal_ore', hex(0x1a1a1a), { blobs: 5, size: 0.12, rough: 0.85, seed: 1 });
ore('iron_ore', hex(0xd8a882), { blobs: 5, size: 0.11, metal: 0.7, rough: 0.42, seed: 2 });
ore('copper_ore', hex(0xd07b4a), { blobs: 5, size: 0.115, metal: 0.7, rough: 0.4, seed: 8 });
ore('gold_ore', hex(0xfcdc5f), { blobs: 4, size: 0.11, metal: 0.95, rough: 0.25, seed: 3 });
ore('redstone_ore', hex(0xd11a1a), { blobs: 6, size: 0.1, rough: 0.45, seed: 4 });
ore('lapis_ore', hex(0x2350c8), { blobs: 5, size: 0.11, rough: 0.35, seed: 5 });
ore('diamond_ore', hex(0x5decdb), { blobs: 4, size: 0.115, rough: 0.14, seed: 6 });
ore('emerald_ore', hex(0x2fd05a), { blobs: 3, size: 0.11, rough: 0.16, seed: 7 });

// 原木 / 木板
const WOODS = {
  oak: { bark: [hex(0x6b5231), hex(0x3c2c17)], core: hex(0xb08a55), plank: [hex(0xba8f56), hex(0x8a6636)] },
  birch: { bark: [hex(0xe6e2d6), hex(0xa8a596)], core: hex(0xd7c9a1), plank: [hex(0xe0d4ab), hex(0xbcae83)] },
  spruce: { bark: [hex(0x4a3620), hex(0x241a0d)], core: hex(0x7a5a34), plank: [hex(0x866239), hex(0x5b421f)] },
  jungle: { bark: [hex(0x6f5637), hex(0x3d2f1c)], core: hex(0xa9744f), plank: [hex(0xb1805a), hex(0x845a3a)] },
  acacia: { bark: [hex(0x6b6152), hex(0x35302a)], core: hex(0xba6337), plank: [hex(0xc06740), hex(0x8c4526)] },
  dark_oak: { bark: [hex(0x3f2d17), hex(0x1e1409)], core: hex(0x6b4a26), plank: [hex(0x53381d), hex(0x341f0d)] },
};
for (const [w, cfg] of Object.entries(WOODS)) {
  const barkOpts = {
    oak: { cracks: 9, fiberFreq: 26, contrast: 1.0, crackDepth: 1.0 },
    birch: { cracks: 4, fiberFreq: 34, contrast: 0.5, crackDepth: 0.18 },
    spruce: { cracks: 11, fiberFreq: 22, contrast: 1.15, crackDepth: 1.15 },
    jungle: { cracks: 8, fiberFreq: 28, contrast: 0.95, crackDepth: 0.9 },
    acacia: { cracks: 7, fiberFreq: 24, contrast: 1.0, crackDepth: 0.85 },
    dark_oak: { cracks: 12, fiberFreq: 24, contrast: 1.2, crackDepth: 1.2 },
  }[w];
  def(`${w}_log_side`, (t) => {
    barkTexture(t, cfg.bark[0], cfg.bark[1], { ...barkOpts, seed: w.length + 1 });
    if (w === 'birch') {
      // 白桦特有的横向皮孔：细而短的深色横道，随机分布
      const marks = [];
      for (let i = 0; i < 9; i++) {
        marks.push({
          u: hash01(i, 71),
          v: hash01(i, 73),
          len: 0.05 + hash01(i, 77) * 0.11,
          h: 0.012 + hash01(i, 79) * 0.018,
          dark: 0.55 + hash01(i, 83) * 0.4,
        });
      }
      t.each((x, y, u, v) => {
        for (const m of marks) {
          let du = Math.abs(u - m.u); du = Math.min(du, 1 - du);
          let dv = Math.abs(v - m.v); dv = Math.min(dv, 1 - dv);
          if (du < m.len && dv < m.h) {
            const k = (1 - du / m.len) * (1 - dv / m.h);
            if (k > 0.12) {
              t.set(x, y, mix3(t.get(x, y), [0.12, 0.11, 0.09], m.dark * clamp(k * 2.2, 0, 1)));
              t.setH(x, y, 0.25);
            }
          }
        }
      });
    }
  });
  def(`${w}_log_top`, (t) => {
    t.each((x, y, u, v) => {
      const dx = u - 0.5, dy = v - 0.5;
      const r = Math.sqrt(dx * dx + dy * dy);
      const wob = P.tileFbm2(u * 6, v * 6, 6, 3) * 0.06;
      const ring = Math.sin((r + wob) * 58) * 0.5 + 0.5;
      let c = mix3(cfg.core, [cfg.core[0] * 0.62, cfg.core[1] * 0.6, cfg.core[2] * 0.55], ring * 0.85);
      if (r > 0.44) c = mix3(cfg.bark[0], cfg.bark[1], 0.5);
      t.set(x, y, c);
      t.setR(x, y, 0.78);
      t.setH(x, y, 1 - ring * 0.5);
    });
  });
  def(`${w}_planks`, (t) => planks(t, cfg.plank[0], cfg.plank[1], w.length * 7));
}

// 树叶：橡木/丛林/金合欢/深色橡木用中性底色接受群系染色，白桦与云杉保持固有色
def('oak_leaves', (t) => leaves(t, hex(0x9aa87c), { density: 0.66, seed: 1 }));
def('birch_leaves', (t) => leaves(t, hex(0x77a544), { density: 0.62, seed: 2 }));
def('spruce_leaves', (t) => leaves(t, hex(0x3f6b3f), { density: 0.7, needle: true, seed: 3 }));
def('jungle_leaves', (t) => leaves(t, hex(0x94a878), { density: 0.78, seed: 4 }));
def('acacia_leaves', (t) => leaves(t, hex(0xa0ac7c), { density: 0.6, seed: 5 }));
def('dark_oak_leaves', (t) => leaves(t, hex(0x8e9c72), { density: 0.72, seed: 6 }));

// 液体与冰雪
def('water', (t) => {
  t.each((x, y, u, v) => {
    const w1 = P.tileFbm2(u * 5, v * 5, 5, 3);
    const w2 = P2.tileFbm2(u * 11, v * 11, 11, 2);
    const c = mix3(hex(0x1a4f8f), hex(0x2f7ec4), clamp(0.5 + w1 * 0.9 + w2 * 0.4, 0, 1));
    t.set(x, y, c, 0.78);
    t.setR(x, y, 0.04);
    t.setH(x, y, 0.5 + w1 * 0.5 + w2 * 0.25);
  });
});
def('lava', (t) => {
  t.each((x, y, u, v) => {
    const flow = P.tileFbm2(u * 4, v * 4, 4, 4);
    const crust = P2.tileFbm2(u * 9, v * 9, 9, 3);
    const heat = clamp(0.5 + flow * 1.2 + crust * 0.5, 0, 1);
    let c;
    if (heat > 0.62) c = mix3(hex(0xff9d1f), hex(0xfff3a0), (heat - 0.62) / 0.38);
    else c = mix3(hex(0x5a1200), hex(0xe04a05), heat / 0.62);
    t.set(x, y, c);
    t.setR(x, y, 0.75);
    t.setH(x, y, heat);
  });
});
def('snow', (t) => {
  t.each((x, y, u, v) => {
    const drift = P.tileFbm2(u * 7, v * 7, 7, 3) * 0.045;
    const sparkle = hash01(x, y, 11) > 0.978 ? 0.35 : 0;
    const c = [clamp(0.94 + drift + sparkle, 0, 1), clamp(0.96 + drift + sparkle, 0, 1), clamp(1.0 + drift, 0, 1)];
    t.set(x, y, c);
    t.setR(x, y, 0.62 - sparkle * 0.5);
    t.setH(x, y, 0.5 + drift * 6);
  });
});
def('ice', (t) => {
  t.each((x, y, u, v) => {
    const crack = voronoiTile(u, v, 5, 71);
    const edge = smoothstep(0, 0.035, crack.f2 - crack.f1);
    const c = mix3(hex(0x9fd0ff), hex(0xd6ecff), edge);
    t.set(x, y, c, 0.72);
    t.setR(x, y, 0.08);
    t.setH(x, y, edge);
  });
});
def('packed_ice', (t) => {
  TEXTURES.ice(t);
  t.each((x, y) => {
    const c = t.get(x, y);
    t.set(x, y, [c[0] * 0.9, c[1] * 0.95, c[2], 1], 1);
    t.setR(x, y, 0.2);
  });
});
def('glass', (t) => {
  t.each((x, y, u, v) => {
    const border = u < 0.045 || u > 0.955 || v < 0.045 || v > 0.955;
    const smudge = P.tileFbm2(u * 8, v * 8, 8, 3) * 0.05;
    if (border) {
      t.set(x, y, [0.72, 0.82, 0.86], 0.55);
      t.setH(x, y, 0.9);
    } else {
      t.set(x, y, [0.86 + smudge, 0.93 + smudge, 0.97], 0.14);
      t.setH(x, y, 0.5);
    }
    t.setR(x, y, 0.03);
  });
});
def('glowstone', (t) => {
  t.each((x, y, u, v) => {
    const vor = voronoiTile(u, v, 7, 44);
    const core = smoothstep(0.14, 0, vor.f1);
    const c = mix3(hex(0x8a6a3a), hex(0xfff2b0), core);
    t.set(x, y, c);
    t.setR(x, y, 0.5);
    t.setH(x, y, core);
  });
});
def('sea_lantern', (t) => {
  t.each((x, y, u, v) => {
    const vor = voronoiTile(u, v, 4, 91);
    const edge = smoothstep(0, 0.06, vor.f2 - vor.f1);
    const c = mix3(hex(0x7fb0a8), hex(0xdcf5ee), edge);
    t.set(x, y, c);
    t.setR(x, y, 0.25);
    t.setH(x, y, edge);
  });
});

// 功能方块
def('crafting_table_top', (t) => {
  planks(t, hex(0xba8f56), hex(0x8a6636), 3);
  t.each((x, y, u, v) => {
    const gx = Math.floor(u * 3), gy = Math.floor(v * 3);
    const fx = u * 3 - gx, fy = v * 3 - gy;
    if (fx < 0.08 || fx > 0.92 || fy < 0.08 || fy > 0.92) {
      t.set(x, y, mix3(t.get(x, y), [0.15, 0.1, 0.06], 0.7));
      t.setH(x, y, 0.1);
    } else {
      t.set(x, y, mix3(t.get(x, y), hex(0x6b4b26), 0.35));
    }
  });
});
def('crafting_table_side', (t) => {
  planks(t, hex(0xa87d47), hex(0x77552b), 4);
  t.each((x, y, u, v) => {
    if (v > 0.55 && v < 0.9 && u > 0.12 && u < 0.88) {
      t.set(x, y, mix3(t.get(x, y), hex(0x4a3418), 0.55));
      t.setH(x, y, 0.25);
    }
  });
});
def('crafting_table_front', (t) => {
  planks(t, hex(0xa87d47), hex(0x77552b), 5);
  t.each((x, y, u, v) => {
    if (v > 0.3 && v < 0.85 && u > 0.15 && u < 0.85) {
      const saw = Math.abs(u - 0.5) < 0.06 || Math.abs(v - 0.55) < 0.05;
      t.set(x, y, mix3(t.get(x, y), saw ? hex(0x8b8b8b) : hex(0x50381b), 0.6));
    }
  });
});
def('furnace_top', (t) => rockBase(t, hex(0x6e6e6e), { cells: 12, seed: 41 }));
def('furnace_side', (t) => {
  TEXTURES.cobblestone(t);
  t.each((x, y) => {
    const c = t.get(x, y);
    t.set(x, y, [c[0] * 0.92, c[1] * 0.92, c[2] * 0.94]);
  });
});
def('furnace_front', (t) => {
  TEXTURES.furnace_side(t);
  t.each((x, y, u, v) => {
    if (v > 0.3 && v < 0.85 && u > 0.15 && u < 0.85) {
      const frame = v < 0.36 || v > 0.79 || u < 0.21 || u > 0.79;
      t.set(x, y, frame ? hex(0x3a3a3a) : hex(0x1a1a1a));
      t.setR(x, y, 0.7);
      t.setH(x, y, frame ? 0.6 : 0.1);
    }
  });
});
def('furnace_front_lit', (t) => {
  TEXTURES.furnace_side(t);
  t.each((x, y, u, v) => {
    if (v > 0.3 && v < 0.85 && u > 0.15 && u < 0.85) {
      const frame = v < 0.36 || v > 0.79 || u < 0.21 || u > 0.79;
      if (frame) {
        t.set(x, y, hex(0x3a3a3a));
        t.setH(x, y, 0.6);
      } else {
        const flame = P.tileFbm2(u * 12, v * 12, 12, 3) * 0.5 + 0.5;
        t.set(x, y, mix3(hex(0xc23a06), hex(0xffe07a), flame));
        t.setH(x, y, flame);
      }
      t.setR(x, y, 0.6);
    }
  });
});
def('chest_top', (t) => planks(t, hex(0xa9773d), hex(0x74501f), 9));
def('chest_side', (t) => {
  planks(t, hex(0xa9773d), hex(0x74501f), 10);
  t.each((x, y, u, v) => {
    if (Math.abs(v - 0.36) < 0.035) {
      t.set(x, y, [0.16, 0.11, 0.05]);
      t.setH(x, y, 0.1);
    }
  });
});
def('chest_front', (t) => {
  TEXTURES.chest_side(t);
  t.each((x, y, u, v) => {
    if (Math.abs(u - 0.5) < 0.09 && v > 0.28 && v < 0.52) {
      t.set(x, y, mix3(hex(0x6b5a2c), hex(0xd8bf6a), 0.6));
      t.setR(x, y, 0.28);
      t.setM(x, y, 0.85);
      t.setH(x, y, 0.95);
    }
  });
});
def('bookshelf', (t) => {
  planks(t, hex(0xba8f56), hex(0x8a6636), 12);
  const books = [hex(0xa53b3b), hex(0x3b62a5), hex(0x3ba55c), hex(0xa5993b), hex(0x7a3ba5), hex(0xb06a2c)];
  t.each((x, y, u, v) => {
    const shelf = v > 0.16 && v < 0.46 || v > 0.54 && v < 0.84;
    if (!shelf) return;
    const bi = Math.floor(u * 9);
    const fx = u * 9 - bi;
    const c = books[Math.floor(hash01(bi, v > 0.5 ? 1 : 0) * books.length)];
    const shade = fx < 0.1 || fx > 0.9 ? 0.5 : 0.85 + hash01(bi, 3) * 0.35;
    const top = Math.abs(v - (v > 0.5 ? 0.55 : 0.17)) < 0.03 ? 0.6 : 1;
    t.set(x, y, [c[0] * shade * top, c[1] * shade * top, c[2] * shade * top]);
    t.setR(x, y, 0.8);
    t.setH(x, y, shade);
  });
});
def('tnt_top', (t) => {
  t.fill(hex(0xd23a2a));
  t.each((x, y, u, v) => {
    const n = P.tileFbm2(u * 20, v * 20, 20, 3) * 0.1;
    t.set(x, y, [0.82 + n, 0.24 + n, 0.18 + n]);
    const dx = u - 0.5, dy = v - 0.5;
    if (dx * dx + dy * dy < 0.02) t.set(x, y, [0.15, 0.13, 0.12]);
    t.setR(x, y, 0.8);
  });
  t.heightFromLuma();
});
def('tnt_side', (t) => {
  t.each((x, y, u, v) => {
    const n = P.tileFbm2(u * 20, v * 20, 20, 3) * 0.09;
    if (v > 0.34 && v < 0.66) {
      t.set(x, y, [0.92 + n, 0.9 + n, 0.86 + n]);
      if (v > 0.42 && v < 0.58 && Math.abs(u - 0.5) < 0.28) t.set(x, y, [0.12, 0.1, 0.1]);
    } else {
      t.set(x, y, [0.8 + n, 0.22 + n, 0.17 + n]);
    }
    t.setR(x, y, 0.82);
  });
  t.heightFromLuma();
});
def('tnt_bottom', (t) => {
  t.each((x, y, u, v) => {
    const n = P.tileFbm2(u * 20, v * 20, 20, 3) * 0.09;
    t.set(x, y, [0.62 + n, 0.18 + n, 0.14 + n]);
    t.setR(x, y, 0.85);
  });
  t.heightFromLuma();
});
def('hay_top', (t) => {
  t.each((x, y, u, v) => {
    const dx = u - 0.5, dy = v - 0.5;
    const r = Math.sqrt(dx * dx + dy * dy);
    const ring = Math.sin(r * 40) * 0.5 + 0.5;
    const c = mix3(hex(0xb8961f), hex(0xe6c74e), ring);
    t.set(x, y, c);
    t.setR(x, y, 0.9);
    t.setH(x, y, ring);
  });
});
def('hay_side', (t) => {
  t.each((x, y, u, v) => {
    const straw = P.tileFbm2xy(u * 5, v * 34, 5, 34, 2) * 0.5 + 0.5;
    const c = mix3(hex(0xa4831a), hex(0xe8cc5c), straw);
    t.set(x, y, c);
    t.setR(x, y, 0.92);
    t.setH(x, y, straw);
  });
});
def('sponge', (t) => {
  t.each((x, y, u, v) => {
    const vor = voronoiTile(u, v, 10, 63);
    const hole = smoothstep(0.03, 0.075, vor.f1);
    const c = mix3(hex(0x9a8a24), hex(0xd8cb52), hole);
    t.set(x, y, c);
    t.setR(x, y, 0.95);
    t.setH(x, y, hole);
  });
});
def('ladder', (t) => {
  t.fill([0, 0, 0], 0);
  const rails = [[0.1, 0.24], [0.76, 0.9]];
  t.each((x, y, u, v) => {
    const onRail = rails.some(([a, b]) => u >= a && u <= b);
    const onRung = (v * 4) % 1 < 0.16;
    if (onRail || (onRung && u > 0.1 && u < 0.9)) {
      const g = P.tileFbm2(u * 20, v * 20, 20, 3) * 0.12;
      t.set(x, y, [0.55 + g, 0.4 + g, 0.2 + g], 1);
      t.setR(x, y, 0.85);
      t.setH(x, y, 0.8);
    }
  });
});
def('torch', (t) => {
  t.fill([0, 0, 0], 0);
  t.each((x, y, u, v) => {
    const inStick = Math.abs(u - 0.5) < 0.09 && v > 0.34;
    const inHead = Math.abs(u - 0.5) < 0.13 && v > 0.18 && v <= 0.36;
    if (inStick) {
      const g = P.tileFbm2(u * 20, v * 20, 20, 2) * 0.12;
      t.set(x, y, [0.48 + g, 0.34 + g, 0.16 + g], 1);
      t.setR(x, y, 0.85);
      t.setH(x, y, 0.7);
    } else if (inHead) {
      const f = P.tileFbm2(u * 14, v * 14, 14, 3) * 0.5 + 0.5;
      t.set(x, y, mix3(hex(0xff8a1a), hex(0xfff3b0), f), 1);
      t.setR(x, y, 0.4);
      t.setH(x, y, 1);
    }
  });
});

// 羊毛与陶瓦（参数化生成 16 色）
export const DYE_COLORS = {
  white: 0xe9ecec, orange: 0xf07613, magenta: 0xbd44b3, light_blue: 0x3aafd9,
  yellow: 0xf8c527, lime: 0x70b919, pink: 0xed8dac, gray: 0x3e4447,
  light_gray: 0x8e8e86, cyan: 0x158991, purple: 0x792aac, blue: 0x35399d,
  brown: 0x724728, green: 0x546d1b, red: 0xa12722, black: 0x141519,
};
for (const [name, c] of Object.entries(DYE_COLORS)) {
  def(`${name}_wool`, (t) => {
    const col = hex(c);
    t.each((x, y, u, v) => {
      const fiber = P.tileFbm2(u * 22, v * 22, 22, 4);
      const curl = P2.tileFbm2(u * 9, v * 9, 9, 3);
      const l = 1 + fiber * 0.22 + curl * 0.12;
      t.set(x, y, [clamp(col[0] * l, 0, 1), clamp(col[1] * l, 0, 1), clamp(col[2] * l, 0, 1)]);
      t.setR(x, y, 0.98);
      t.setH(x, y, 0.5 + fiber * 0.5);
    });
  });
}
const TERRACOTTA = {
  terracotta: 0x975d43, white_terracotta: 0xd1b1a1, orange_terracotta: 0xa15325,
  yellow_terracotta: 0xba8523, red_terracotta: 0x8e3c2e, brown_terracotta: 0x4d3323,
  light_gray_terracotta: 0x876b62,
};
for (const [name, c] of Object.entries(TERRACOTTA)) {
  def(name, (t) => {
    const col = hex(c);
    t.each((x, y, u, v) => {
      const grain = P.tileFbm2(u * 16, v * 16, 16, 4) * 0.13;
      const swirl = P2.tileFbm2(u * 5, v * 5, 5, 3) * 0.08;
      const l = 1 + grain + swirl;
      t.set(x, y, [clamp(col[0] * l, 0, 1), clamp(col[1] * l, 0, 1), clamp(col[2] * l, 0, 1)]);
      t.setR(x, y, 0.7);
      t.setH(x, y, 0.5 + grain * 2);
    });
  });
}

// 矿物方块
def('iron_block', (t) => mineralBlock(t, hex(0xd8d8d8), { metal: 1, rough: 0.28, facets: 3 }));
def('gold_block', (t) => mineralBlock(t, hex(0xf9d94a), { metal: 1, rough: 0.16, facets: 3 }));
def('copper_block', (t) => mineralBlock(t, hex(0xc3703f), { metal: 1, rough: 0.32, facets: 4 }));
def('diamond_block', (t) => mineralBlock(t, hex(0x62e6de), { metal: 0.1, rough: 0.08, facets: 5, gem: true }));
def('emerald_block', (t) => mineralBlock(t, hex(0x2fd05a), { metal: 0.1, rough: 0.1, facets: 5, gem: true }));
def('lapis_block', (t) => mineralBlock(t, hex(0x1e46b0), { metal: 0.05, rough: 0.42, facets: 6 }));
def('redstone_block', (t) => mineralBlock(t, hex(0xa81212), { metal: 0.05, rough: 0.5, facets: 8 }));
def('coal_block', (t) => mineralBlock(t, hex(0x141414), { metal: 0.0, rough: 0.55, facets: 6 }));

// 植物（十字渲染）
def('tall_grass', (t) => plantCross(t, hex(0x7f8f6a), hex(0xc0cba8), null, { height: 0.75, bushy: 0.9, seed: 1 }));
def('fern', (t) => plantCross(t, hex(0x76866a), hex(0xb0bd98), null, { height: 0.85, bushy: 0.6, seed: 2 }));
def('dead_bush', (t) => plantCross(t, hex(0x6b4a22), hex(0x8a6634), null, { height: 0.7, bushy: 0.7, seed: 3 }));
def('dandelion', (t) => plantCross(t, hex(0x3f7a24), hex(0x5c9c34), hex(0xf2d63a), { height: 0.72, bushy: 0.25, flower: true, flowerSize: 0.1, seed: 4 }));
def('poppy', (t) => plantCross(t, hex(0x3f7a24), hex(0x5c9c34), hex(0xd42d24), { height: 0.72, bushy: 0.25, flower: true, flowerSize: 0.1, seed: 5 }));
def('blue_orchid', (t) => plantCross(t, hex(0x3f7a24), hex(0x5c9c34), hex(0x2ab5e0), { height: 0.75, bushy: 0.2, flower: true, flowerSize: 0.09, seed: 6 }));
def('allium', (t) => plantCross(t, hex(0x3f7a24), hex(0x5c9c34), hex(0xb96ee0), { height: 0.78, bushy: 0.2, flower: true, flowerSize: 0.1, seed: 7 }));
def('cornflower', (t) => plantCross(t, hex(0x3f7a24), hex(0x5c9c34), hex(0x466ce0), { height: 0.74, bushy: 0.2, flower: true, flowerSize: 0.09, seed: 8 }));
def('oxeye_daisy', (t) => plantCross(t, hex(0x3f7a24), hex(0x5c9c34), hex(0xf0f0e6), { height: 0.74, bushy: 0.22, flower: true, flowerSize: 0.1, seed: 9 }));
def('brown_mushroom', (t) => {
  t.fill([0, 0, 0], 0);
  t.each((x, y, u, v) => {
    const dx = u - 0.5;
    if (v > 0.45 && v < 0.82 && Math.abs(dx) < 0.06) {
      t.set(x, y, [0.86, 0.82, 0.74], 1);
      t.setH(x, y, 0.7);
    }
    const cap = Math.sqrt(dx * dx * 1.6 + (v - 0.5) * (v - 0.5) * 4);
    if (v <= 0.5 && cap < 0.3) {
      const sh = 0.7 + (0.3 - cap) * 1.3;
      t.set(x, y, [0.62 * sh, 0.44 * sh, 0.28 * sh], 1);
      t.setH(x, y, 1);
    }
    t.setR(x, y, 0.9);
  });
});
def('red_mushroom', (t) => {
  TEXTURES.brown_mushroom(t);
  t.each((x, y, u, v) => {
    const c = t.get(x, y);
    const i = t.idx(x, y) * 4;
    if (t.col[i + 3] > 0 && v <= 0.52 && c[0] > 0.3) {
      t.set(x, y, [clamp(c[0] * 1.5, 0, 1), c[1] * 0.5, c[2] * 0.5], 1);
      if (hash01(x, y, 3) > 0.8) t.set(x, y, [0.94, 0.94, 0.9], 1);
    }
  });
});
def('sugar_cane', (t) => {
  t.fill([0, 0, 0], 0);
  t.each((x, y, u, v) => {
    if (Math.abs(u - 0.5) < 0.13) {
      const seg = Math.abs((v * 6) % 1 - 0.5) < 0.08 ? 0.7 : 1;
      const g = P.tileFbm2(u * 20, v * 20, 20, 2) * 0.12;
      t.set(x, y, [(0.53 + g) * seg, (0.76 + g) * seg, (0.42 + g) * seg], 1);
      t.setR(x, y, 0.85);
      t.setH(x, y, seg);
    }
    if (Math.abs(u - 0.5) > 0.13 && Math.abs(u - 0.5) < 0.42 && (v * 6) % 1 < 0.1 && v > 0.15) {
      t.set(x, y, [0.45, 0.68, 0.35], 1);
      t.setH(x, y, 0.6);
    }
  });
});
def('wheat', (t) => {
  t.fill([0, 0, 0], 0);
  t.each((x, y, u, v) => {
    const stalks = 5;
    const sx = (u * stalks) % 1;
    if (Math.abs(sx - 0.5) < 0.1 && v > 0.15) {
      t.set(x, y, [0.72, 0.62, 0.22], 1);
      t.setH(x, y, 0.7);
    }
    if (v < 0.45 && Math.abs(sx - 0.5) < 0.22 && (v * 10) % 1 < 0.5) {
      t.set(x, y, [0.86, 0.74, 0.28], 1);
      t.setH(x, y, 0.9);
    }
    t.setR(x, y, 0.9);
  });
});
def('cactus_side', (t) => {
  t.each((x, y, u, v) => {
    const ribs = Math.abs(Math.sin(u * Math.PI * 4));
    const base = mix3(hex(0x2f5c1e), hex(0x5c9a3a), ribs);
    const g = P.tileFbm2(u * 18, v * 18, 18, 3) * 0.08;
    t.set(x, y, [base[0] + g, base[1] + g, base[2] + g]);
    t.setR(x, y, 0.8);
    t.setH(x, y, ribs);
    if (Math.abs((u * 4) % 1 - 0.5) < 0.05 && (v * 8) % 1 < 0.12) {
      t.set(x, y, [0.86, 0.86, 0.78]);
      t.setH(x, y, 1);
    }
  });
});
def('cactus_top', (t) => {
  t.each((x, y, u, v) => {
    const dx = u - 0.5, dy = v - 0.5;
    const r = Math.sqrt(dx * dx + dy * dy);
    const c = mix3(hex(0x74b04a), hex(0x2f5c1e), smoothstep(0.2, 0.45, r));
    t.set(x, y, c);
    t.setR(x, y, 0.8);
    t.setH(x, y, 1 - r);
  });
});
def('pumpkin_top', (t) => {
  t.each((x, y, u, v) => {
    const dx = u - 0.5, dy = v - 0.5;
    const r = Math.sqrt(dx * dx + dy * dy);
    const c = r < 0.13 ? hex(0x6b5227) : mix3(hex(0xd4791b), hex(0xa8590f), Math.abs(Math.sin(Math.atan2(dy, dx) * 5)));
    t.set(x, y, c);
    t.setR(x, y, 0.75);
    t.setH(x, y, r < 0.13 ? 1 : 0.6);
  });
});
def('pumpkin_side', (t) => {
  t.each((x, y, u, v) => {
    const ribs = Math.abs(Math.sin(u * Math.PI * 4));
    const c = mix3(hex(0xa8590f), hex(0xe08a24), ribs);
    const g = P.tileFbm2(u * 14, v * 14, 14, 3) * 0.07;
    t.set(x, y, [clamp(c[0] + g, 0, 1), clamp(c[1] + g, 0, 1), clamp(c[2] + g, 0, 1)]);
    t.setR(x, y, 0.75);
    t.setH(x, y, ribs);
  });
});
def('pumpkin_face', (t) => {
  TEXTURES.pumpkin_side(t);
  t.each((x, y, u, v) => {
    const eye = (Math.abs(u - 0.3) < 0.11 || Math.abs(u - 0.7) < 0.11) && v > 0.3 && v < 0.48 &&
      Math.abs(u - 0.5) * 1.0 > (0.5 - v) * 0.5;
    const mouth = v > 0.6 && v < 0.78 && Math.abs(u - 0.5) < 0.28 && (Math.floor(u * 10) % 2 === 0 || v < 0.68);
    if (eye || mouth) {
      t.set(x, y, [0.1, 0.07, 0.03]);
      t.setH(x, y, 0.05);
    }
  });
});
def('melon_top', (t) => {
  t.each((x, y, u, v) => {
    const n = P.tileFbm2(u * 10, v * 10, 10, 3) * 0.5 + 0.5;
    t.set(x, y, mix3(hex(0x4f7a1f), hex(0x88b53a), n));
    t.setR(x, y, 0.6);
    t.setH(x, y, n);
  });
});
def('melon_side', (t) => {
  t.each((x, y, u, v) => {
    const stripe = Math.abs(Math.sin(u * Math.PI * 5)) > 0.55 ? 1 : 0;
    const n = P.tileFbm2(u * 12, v * 12, 12, 3) * 0.5 + 0.5;
    const c = stripe ? mix3(hex(0x3f6417), hex(0x5c8a24), n) : mix3(hex(0x86b23a), hex(0xa8cc5c), n);
    t.set(x, y, c);
    t.setR(x, y, 0.6);
    t.setH(x, y, 0.5 + n * 0.5);
  });
});

// 树苗（十字渲染的小树）
const SAPLING_COLORS = {
  oak: [0x3f6b22, 0x6ba03a], birch: [0x5c8a2e, 0x93bd5c], spruce: [0x2f5c33, 0x4f7d4a],
  jungle: [0x2f7a1e, 0x54a83a], acacia: [0x5c7a1e, 0x93b53a], dark_oak: [0x2f5c1a, 0x54802a],
};
for (const [w, [a, b]] of Object.entries(SAPLING_COLORS)) {
  def(`${w}_sapling`, (t) => {
    t.fill([0, 0, 0], 0);
    const s = t.size;
    // 主干
    for (let y = Math.floor(s * 0.42); y < s; y++) {
      for (let dx = -1; dx <= 1; dx++) {
        t.set(Math.floor(s / 2) + dx, y, [0.42, 0.31, 0.16], 1);
        t.setH(Math.floor(s / 2) + dx, y, 0.7);
      }
    }
    // 树冠
    t.each((x, y, u, v) => {
      const dx = u - 0.5, dy = v - 0.32;
      const r = Math.sqrt(dx * dx * 1.3 + dy * dy * 2.2);
      const wob = P.tileFbm2(u * 12, v * 12, 12, 3) * 0.09;
      if (r + wob < 0.26) {
        const m = P2.tileFbm2(u * 16, v * 16, 16, 3) * 0.5 + 0.5;
        if (m > 0.28) {
          const c = mix3(hex(a), hex(b), m);
          t.set(x, y, c, 1);
          t.setR(x, y, 0.85);
          t.setH(x, y, m);
        }
      }
    });
  });
}

// ── 打包成 GPU 可用的数据 ─────────────────────────────────────

export const TEX_NAMES = Object.keys(TEXTURES);
export const TEX_INDEX = {};
TEX_NAMES.forEach((n, i) => (TEX_INDEX[n] = i));

/**
 * 生成所有材质，返回 { albedo, normal, count, size, canvases }
 * albedo: Uint8Array (RGBA)，normal: Uint8Array (法线 XYZ + 粗糙度A)
 */
export function buildTextureData() {
  const s = TEX_SIZE;
  const count = TEX_NAMES.length;
  const albedo = new Uint8Array(s * s * 4 * count);
  const normal = new Uint8Array(s * s * 4 * count);
  const extra = new Uint8Array(s * s * 4 * count); // R=金属度 其余保留
  const canvases = [];

  for (let li = 0; li < count; li++) {
    const t = new Tex(s);
    TEXTURES[TEX_NAMES[li]](t);
    const off = li * s * s * 4;

    for (let i = 0; i < s * s; i++) {
      albedo[off + i * 4] = clamp(t.col[i * 4] * 255, 0, 255);
      albedo[off + i * 4 + 1] = clamp(t.col[i * 4 + 1] * 255, 0, 255);
      albedo[off + i * 4 + 2] = clamp(t.col[i * 4 + 2] * 255, 0, 255);
      albedo[off + i * 4 + 3] = clamp(t.col[i * 4 + 3] * 255, 0, 255);
      extra[off + i * 4] = clamp(t.metal[i] * 255, 0, 255);
    }

    // Sobel 求法线（环绕采样，保证无缝）
    const H = (x, y) => t.height[t.idx(x, y)];
    const strength = 1.8;
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const dX =
          (H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1)) -
          (H(x - 1, y - 1) + 2 * H(x - 1, y) + H(x - 1, y + 1));
        const dY =
          (H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1)) -
          (H(x - 1, y - 1) + 2 * H(x, y - 1) + H(x + 1, y - 1));
        let nx = -dX * strength, ny = -dY * strength, nz = 1;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len; ny /= len; nz /= len;
        const i = y * s + x;
        normal[off + i * 4] = clamp((nx * 0.5 + 0.5) * 255, 0, 255);
        normal[off + i * 4 + 1] = clamp((ny * 0.5 + 0.5) * 255, 0, 255);
        normal[off + i * 4 + 2] = clamp((nz * 0.5 + 0.5) * 255, 0, 255);
        normal[off + i * 4 + 3] = clamp(t.rough[i] * 255, 0, 255);
      }
    }
    canvases.push(null);
  }
  return { albedo, normal, extra, count, size: s };
}

/** 取出某一层的 ImageData，供 2D 界面（物品图标）使用 */
export function layerToCanvas(albedo, layer, size = TEX_SIZE) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  img.data.set(albedo.subarray(layer * size * size * 4, (layer + 1) * size * size * 4));
  ctx.putImageData(img, 0, 0);
  return c;
}
