// 区块：16×128×16 的方块与光照存储

export const CHUNK_X = 16;
export const CHUNK_Z = 16;
export const CHUNK_Y = 128;
export const SEA_LEVEL = 62;
const AREA = CHUNK_X * CHUNK_Z;
const VOLUME = AREA * CHUNK_Y;

export function idx(x, y, z) {
  return (y * CHUNK_Z + z) * CHUNK_X + x;
}

export class Chunk {
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.blocks = new Uint8Array(VOLUME);
    this.meta = new Uint8Array(VOLUME);      // 方块附加数据（液体高度、朝向等）
    this.light = new Uint8Array(VOLUME);     // 高 4 位天空光，低 4 位方块光
    this.biome = new Uint8Array(AREA);
    this.heightMap = new Uint8Array(AREA);   // 每列最高的非空气方块 +1
    this.generated = false;
    this.decorated = false;
    this.lit = false;
    this.dirty = true;                        // 需要重建网格
    this.mesh = null;
    this.tileEntities = new Map();            // key = 局部索引 → { type, items, ... }
    this.empty = true;
  }

  get(x, y, z) {
    if (y < 0 || y >= CHUNK_Y) return 0;
    return this.blocks[idx(x, y, z)];
  }
  set(x, y, z, id) {
    if (y < 0 || y >= CHUNK_Y) return;
    this.blocks[idx(x, y, z)] = id;
    if (id !== 0) this.empty = false;
  }
  getSky(x, y, z) {
    if (y < 0) return 0;
    if (y >= CHUNK_Y) return 15;
    return this.light[idx(x, y, z)] >> 4;
  }
  setSky(x, y, z, v) {
    if (y < 0 || y >= CHUNK_Y) return;
    const i = idx(x, y, z);
    this.light[i] = (this.light[i] & 0x0f) | (v << 4);
  }
  getBlockLight(x, y, z) {
    if (y < 0 || y >= CHUNK_Y) return 0;
    return this.light[idx(x, y, z)] & 0x0f;
  }
  setBlockLight(x, y, z, v) {
    if (y < 0 || y >= CHUNK_Y) return;
    const i = idx(x, y, z);
    this.light[i] = (this.light[i] & 0xf0) | v;
  }
  getBiome(x, z) {
    return this.biome[z * CHUNK_X + x];
  }

  /** 重新计算高度图 */
  recalcHeightMap() {
    for (let z = 0; z < CHUNK_Z; z++) {
      for (let x = 0; x < CHUNK_X; x++) {
        let h = 0;
        for (let y = CHUNK_Y - 1; y >= 0; y--) {
          if (this.blocks[idx(x, y, z)] !== 0) { h = y + 1; break; }
        }
        this.heightMap[z * CHUNK_X + x] = h;
      }
    }
  }

  /** 序列化（存档用），采用行程编码压缩 */
  serialize() {
    const rle = [];
    let prev = this.blocks[0], run = 1;
    for (let i = 1; i < VOLUME; i++) {
      const v = this.blocks[i];
      if (v === prev && run < 65535) run++;
      else { rle.push(prev, run); prev = v; run = 1; }
    }
    rle.push(prev, run);
    const meta = [];
    for (let i = 0; i < VOLUME; i++) if (this.meta[i]) meta.push(i, this.meta[i]);
    const te = [];
    for (const [k, v] of this.tileEntities) te.push([k, v]);
    return { cx: this.cx, cz: this.cz, rle, meta, biome: Array.from(this.biome), te };
  }

  static deserialize(data) {
    const c = new Chunk(data.cx, data.cz);
    let i = 0;
    for (let k = 0; k < data.rle.length; k += 2) {
      const v = data.rle[k], n = data.rle[k + 1];
      for (let j = 0; j < n && i < VOLUME; j++) c.blocks[i++] = v;
    }
    for (let k = 0; k < (data.meta || []).length; k += 2) c.meta[data.meta[k]] = data.meta[k + 1];
    c.biome.set(data.biome);
    for (const [k, v] of data.te || []) c.tileEntities.set(Number(k), v);
    c.generated = true;
    c.decorated = true;
    c.empty = !c.blocks.some((b) => b !== 0);
    c.recalcHeightMap();
    return c;
  }
}

export { AREA, VOLUME };
