// 噪声库：确定性随机、Perlin/Simplex、FBM、脊状噪声、Voronoi 元胞噪声
// 全部为纯函数式实现，供世界生成与程序化材质共用。

/** 32 位整数哈希（用于确定性随机） */
export function hashInt(x) {
  x |= 0;
  x = (x ^ 61) ^ (x >>> 16);
  x = (x + (x << 3)) | 0;
  x = x ^ (x >>> 4);
  x = Math.imul(x, 0x27d4eb2d);
  x = x ^ (x >>> 15);
  return x >>> 0;
}

/** 由若干整数生成 [0,1) 随机数（确定性，与调用顺序无关） */
export function hash01(...args) {
  let h = 0x9e3779b9;
  for (let i = 0; i < args.length; i++) {
    h = hashInt(h ^ Math.imul(args[i] | 0, 0x85ebca6b));
  }
  return (h >>> 8) / 16777216;
}

/** 可复现的伪随机数发生器（mulberry32） */
export class Rand {
  constructor(seed = 1) {
    this.s = (seed | 0) || 1;
  }
  next() {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) {
    return a + this.next() * (b - a);
  }
  int(n) {
    return Math.floor(this.next() * n);
  }
  pick(arr) {
    return arr[this.int(arr.length)];
  }
  chance(p) {
    return this.next() < p;
  }
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;

/** 经典 Perlin 噪声（2D/3D），带 FBM 与脊状变体 */
export class Perlin {
  constructor(seed = 0) {
    const rand = new Rand(seed ^ 0x1b873593);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = rand.int(i + 1);
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    this.perm = new Uint8Array(512);
    this.permMod12 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
      this.permMod12[i] = this.perm[i] % 12;
    }
  }

  grad2(hash, x, y) {
    switch (hash & 7) {
      case 0: return x + y;
      case 1: return x - y;
      case 2: return -x + y;
      case 3: return -x - y;
      case 4: return x;
      case 5: return -x;
      case 6: return y;
      default: return -y;
    }
  }

  grad3(hash, x, y, z) {
    switch (hash & 15) {
      case 0: return x + y;
      case 1: return -x + y;
      case 2: return x - y;
      case 3: return -x - y;
      case 4: return x + z;
      case 5: return -x + z;
      case 6: return x - z;
      case 7: return -x - z;
      case 8: return y + z;
      case 9: return -y + z;
      case 10: return y - z;
      case 11: return -y - z;
      case 12: return x + y;
      case 13: return -y + z;
      case 14: return -x + y;
      default: return -y - z;
    }
  }

  /** 返回值域约 [-1,1] */
  noise2(x, y) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);
    const p = this.perm;
    const aa = p[p[X] + Y];
    const ab = p[p[X] + Y + 1];
    const ba = p[p[X + 1] + Y];
    const bb = p[p[X + 1] + Y + 1];
    const x1 = lerp(this.grad2(aa, xf, yf), this.grad2(ba, xf - 1, yf), u);
    const x2 = lerp(this.grad2(ab, xf, yf - 1), this.grad2(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v) * 0.72;
  }

  noise3(x, y, z) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const zf = z - Math.floor(z);
    const u = fade(xf);
    const v = fade(yf);
    const w = fade(zf);
    const p = this.perm;
    const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z;
    const B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
    const x1 = lerp(this.grad3(p[AA], xf, yf, zf), this.grad3(p[BA], xf - 1, yf, zf), u);
    const x2 = lerp(this.grad3(p[AB], xf, yf - 1, zf), this.grad3(p[BB], xf - 1, yf - 1, zf), u);
    const y1 = lerp(x1, x2, v);
    const x3 = lerp(this.grad3(p[AA + 1], xf, yf, zf - 1), this.grad3(p[BA + 1], xf - 1, yf, zf - 1), u);
    const x4 = lerp(this.grad3(p[AB + 1], xf, yf - 1, zf - 1), this.grad3(p[BB + 1], xf - 1, yf - 1, zf - 1), u);
    const y2 = lerp(x3, x4, v);
    return lerp(y1, y2, w) * 0.86;
  }

  fbm2(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.noise2(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  fbm3(x, y, z, octaves = 4, lacunarity = 2, gain = 0.5) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.noise3(x * freq, y * freq, z * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  /** 脊状噪声：适合生成山脊 */
  ridged2(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      const n = 1 - Math.abs(this.noise2(x * freq, y * freq));
      sum += amp * n * n;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return (sum / norm) * 2 - 1;
  }

  /** 可平铺的 2D FBM（材质用，保证纹理左右上下无缝） */
  tileFbm2(x, y, period, octaves = 4, gain = 0.5) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.tileNoise2(x * freq, y * freq, period * freq);
      norm += amp;
      amp *= gain;
      freq *= 2;
    }
    return sum / norm;
  }

  /** 各向异性的可平铺噪声：x/y 方向可以有不同的重复周期（用于木纹、纤维） */
  tileNoise2xy(x, y, px, py) {
    const ax = ((x % px) + px) % px;
    const ay = ((y % py) + py) % py;
    const fx = ax / px, fy = ay / py;
    const a = this.noise2(ax, ay);
    const b = this.noise2(ax - px, ay);
    const c = this.noise2(ax, ay - py);
    const d = this.noise2(ax - px, ay - py);
    return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
  }

  /** 各向异性可平铺 FBM */
  tileFbm2xy(x, y, px, py, octaves = 4, gain = 0.5) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.tileNoise2xy(x * freq, y * freq, px * freq, py * freq);
      norm += amp;
      amp *= gain;
      freq *= 2;
    }
    return sum / norm;
  }

  /** 通过 4 点混合实现的周期性噪声 */
  tileNoise2(x, y, period) {
    const px = x % period, py = y % period;
    const fx = px / period, fy = py / period;
    const a = this.noise2(px, py);
    const b = this.noise2(px - period, py);
    const c = this.noise2(px, py - period);
    const d = this.noise2(px - period, py - period);
    return lerp(lerp(a, b, fx), lerp(c, d, fx), fy) * (1 + 0.35 * (fx * (1 - fx) + fy * (1 - fy)));
  }
}

/**
 * 可平铺的 Voronoi/元胞噪声，返回 { f1, f2, id }
 * 用于石头颗粒、圆石块面、砂砾等材质。
 */
export function voronoiTile(x, y, cells, seed) {
  const cx = Math.floor(x * cells);
  const cy = Math.floor(y * cells);
  let f1 = 1e9, f2 = 1e9, id = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const gx = cx + dx, gy = cy + dy;
      const wx = ((gx % cells) + cells) % cells;
      const wy = ((gy % cells) + cells) % cells;
      const px = (gx + hash01(wx, wy, seed)) / cells;
      const py = (gy + hash01(wy, wx, seed + 17)) / cells;
      const ddx = px - x, ddy = py - y;
      const d = ddx * ddx + ddy * ddy;
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = hashInt(wx * 73856093 ^ wy * 19349663 ^ seed);
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  return { f1: Math.sqrt(f1), f2: Math.sqrt(f2), id };
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const smoothstep = (a, b, t) => {
  const x = clamp((t - a) / (b - a), 0, 1);
  return x * x * (3 - 2 * x);
};
export { lerp };
