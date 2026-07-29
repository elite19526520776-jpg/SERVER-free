// 世界管理器：区块加载、光照传播、流体模拟、射线检测、存档

import { Chunk, CHUNK_X, CHUNK_Y, CHUNK_Z, SEA_LEVEL, idx } from './chunk.js';
import { WorldGen } from './worldgen.js';
import { ID, getBlock, BLOCKS, RT, collisionBoxes } from './blocks.js';
import { biomeById, PLAINS } from './biomes.js';

const A = 0;
// 区块键：cx * 2^26 + cz。在 |cz| < 2^25（约 5.4 亿格）内保证唯一，
// 且乘积始终落在 float64 的安全整数范围内。
export const chunkKey = (cx, cz) => cx * 67108864 + cz;
const key = chunkKey;

export class World {
  constructor(seed = 1337) {
    this.seed = seed;
    this.gen = new WorldGen(seed);
    this.chunks = new Map();
    this.pendingDecor = new Map();     // 尚未加载的区块收到的跨界写入
    this.skyQueue = [];
    this.blockQueue = [];
    this.fluidTicks = new Map();       // "x,y,z" → 剩余 tick
    this.time = 6000;                  // 0-24000，6000 = 正午
    this.dayLength = 24000;
    this.tickCount = 0;
    this.genBudget = 2;
    this.onChunkDirty = null;
  }

  // ── 区块访问 ──
  getChunk(cx, cz) {
    return this.chunks.get(key(cx, cz)) || null;
  }

  chunkAt(x, z) {
    return this.getChunk(Math.floor(x / CHUNK_X), Math.floor(z / CHUNK_Z));
  }

  ensureChunk(cx, cz) {
    let c = this.chunks.get(key(cx, cz));
    if (c) return c;
    c = new Chunk(cx, cz);
    this.chunks.set(key(cx, cz), c);
    this.gen.generate(c);
    // 应用之前邻居写进来的方块
    const pend = this.pendingDecor.get(key(cx, cz));
    if (pend) {
      for (const [i, id] of pend) {
        if (id.onlyAir && c.blocks[i] !== A) continue;
        c.blocks[i] = id.id;
      }
      this.pendingDecor.delete(key(cx, cz));
      c.recalcHeightMap();
    }
    return c;
  }

  getBlock(x, y, z) {
    if (y < 0 || y >= CHUNK_Y) return A;
    const cx = x >> 4, cz = z >> 4;
    const c = this.chunks.get(key(cx, cz));
    if (!c) return A;
    return c.blocks[idx(x - cx * 16, y, z - cz * 16)];
  }

  getMeta(x, y, z) {
    if (y < 0 || y >= CHUNK_Y) return 0;
    const cx = x >> 4, cz = z >> 4;
    const c = this.chunks.get(key(cx, cz));
    if (!c) return 0;
    return c.meta[idx(x - cx * 16, y, z - cz * 16)];
  }

  setMeta(x, y, z, v) {
    const cx = x >> 4, cz = z >> 4;
    const c = this.chunks.get(key(cx, cz));
    if (!c) return;
    c.meta[idx(x - cx * 16, y, z - cz * 16)] = v;
  }

  getBiomeAt(x, z) {
    const cx = x >> 4, cz = z >> 4;
    const c = this.chunks.get(key(cx, cz));
    if (!c) return PLAINS;
    return biomeById(c.biome[(z - cz * 16) * CHUNK_X + (x - cx * 16)]);
  }

  getSky(x, y, z) {
    if (y >= CHUNK_Y) return 15;
    if (y < 0) return 0;
    const cx = x >> 4, cz = z >> 4;
    const c = this.chunks.get(key(cx, cz));
    if (!c) return 15;
    return c.light[idx(x - cx * 16, y, z - cz * 16)] >> 4;
  }

  setSky(x, y, z, v) {
    if (y < 0 || y >= CHUNK_Y) return;
    const cx = x >> 4, cz = z >> 4;
    const c = this.chunks.get(key(cx, cz));
    if (!c) return;
    const i = idx(x - cx * 16, y, z - cz * 16);
    c.light[i] = (c.light[i] & 0x0f) | (v << 4);
  }

  getBlockLight(x, y, z) {
    if (y < 0 || y >= CHUNK_Y) return 0;
    const cx = x >> 4, cz = z >> 4;
    const c = this.chunks.get(key(cx, cz));
    if (!c) return 0;
    return c.light[idx(x - cx * 16, y, z - cz * 16)] & 0x0f;
  }

  setBlockLight(x, y, z, v) {
    if (y < 0 || y >= CHUNK_Y) return;
    const cx = x >> 4, cz = z >> 4;
    const c = this.chunks.get(key(cx, cz));
    if (!c) return;
    const i = idx(x - cx * 16, y, z - cz * 16);
    c.light[i] = (c.light[i] & 0xf0) | v;
  }

  // ── 修改方块 ──
  setBlock(x, y, z, id, opts = {}) {
    if (y < 0 || y >= CHUNK_Y) return;
    const cx = x >> 4, cz = z >> 4;
    const c = this.chunks.get(key(cx, cz));
    if (!c) return;
    const li = idx(x - cx * 16, y, z - cz * 16);
    const old = c.blocks[li];
    if (old === id && !opts.force) return;
    c.blocks[li] = id;
    c.meta[li] = opts.meta || 0;
    c.modified = true;
    if (id === A) c.tileEntities.delete(li);

    const hmi = (z - cz * 16) * CHUNK_X + (x - cx * 16);
    if (id !== A && y + 1 > c.heightMap[hmi]) c.heightMap[hmi] = y + 1;
    else if (id === A && y + 1 === c.heightMap[hmi]) {
      let h = 0;
      for (let yy = y; yy >= 0; yy--) {
        if (c.blocks[idx(x - cx * 16, yy, z - cz * 16)] !== A) { h = yy + 1; break; }
      }
      c.heightMap[hmi] = h;
    }

    this.updateLightAt(x, y, z, old, id);
    this.markDirty(x, y, z);
    if (!opts.noFluid) this.scheduleFluidAround(x, y, z);
    // 支撑检查：上方需要依附的方块要掉
    if (!opts.noSupport) this.checkSupport(x, y + 1, z);
  }

  checkSupport(x, y, z) {
    const b = getBlock(this.getBlock(x, y, z));
    if (b.needsSupport) {
      const below = this.getBlock(x, y - 1, z);
      const bb = getBlock(below);
      if (below === A || (!bb.solid && !bb.needsSupport)) {
        this.setBlock(x, y, z, A);
      }
    }
  }

  markDirty(x, y, z) {
    const cx = x >> 4, cz = z >> 4;
    const lx = x - cx * 16, lz = z - cz * 16;
    const mark = (a, b) => {
      const c = this.chunks.get(key(a, b));
      if (c) { c.dirty = true; if (this.onChunkDirty) this.onChunkDirty(c); }
    };
    mark(cx, cz);
    if (lx === 0) mark(cx - 1, cz);
    if (lx === 15) mark(cx + 1, cz);
    if (lz === 0) mark(cx, cz - 1);
    if (lz === 15) mark(cx, cz + 1);
    if (lx === 0 && lz === 0) mark(cx - 1, cz - 1);
    if (lx === 15 && lz === 15) mark(cx + 1, cz + 1);
    if (lx === 0 && lz === 15) mark(cx - 1, cz + 1);
    if (lx === 15 && lz === 0) mark(cx + 1, cz - 1);
  }

  // ── 光照 ──
  initChunkLight(c) {
    const wx0 = c.cx * 16, wz0 = c.cz * 16;
    // 天空光：从顶部向下灌注
    for (let z = 0; z < CHUNK_Z; z++) {
      for (let x = 0; x < CHUNK_X; x++) {
        let level = 15;
        for (let y = CHUNK_Y - 1; y >= 0; y--) {
          const i = idx(x, y, z);
          const b = BLOCKS[c.blocks[i]];
          const filter = b ? b.filter : 15;
          if (filter >= 15) { level = 0; }
          else if (filter > 0) level = Math.max(0, level - filter);
          c.light[i] = (c.light[i] & 0x0f) | (level << 4);
          if (level > 0) this.skyQueue.push(wx0 + x, y, wz0 + z);
          if (level === 0 && filter >= 15) {
            // 下面全黑，跳过剩余
            for (let yy = y - 1; yy >= 0; yy--) {
              const ii = idx(x, yy, z);
              c.light[ii] = c.light[ii] & 0x0f;
            }
            break;
          }
        }
      }
    }
    // 方块光源
    for (let y = 0; y < CHUNK_Y; y++) {
      for (let z = 0; z < CHUNK_Z; z++) {
        for (let x = 0; x < CHUNK_X; x++) {
          const i = idx(x, y, z);
          const b = BLOCKS[c.blocks[i]];
          if (b && b.light > 0) {
            c.light[i] = (c.light[i] & 0xf0) | b.light;
            this.blockQueue.push(wx0 + x, y, wz0 + z);
          }
        }
      }
    }
    // 让邻居的光重新流进来
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = this.getChunk(c.cx + dx, c.cz + dz);
      if (!n || !n.lit) continue;
      for (let y = 0; y < CHUNK_Y; y++) {
        for (let t = 0; t < 16; t++) {
          const nx = dx === 1 ? 0 : dx === -1 ? 15 : t;
          const nz = dz === 1 ? 0 : dz === -1 ? 15 : t;
          const wx = n.cx * 16 + nx, wz = n.cz * 16 + nz;
          const i = idx(nx, y, nz);
          if (n.light[i] >> 4) this.skyQueue.push(wx, y, wz);
          if (n.light[i] & 0x0f) this.blockQueue.push(wx, y, wz);
        }
      }
    }
    c.lit = true;
    c.dirty = true;
  }

  propagateLight(maxSteps = 200000) {
    let steps = 0;
    // 天空光
    while (this.skyQueue.length && steps < maxSteps) {
      const z = this.skyQueue.pop(), y = this.skyQueue.pop(), x = this.skyQueue.pop();
      const level = this.getSky(x, y, z);
      if (level <= 0) continue;
      steps++;
      for (let d = 0; d < 6; d++) {
        const nx = x + DX[d], ny = y + DY[d], nz = z + DZ[d];
        if (ny < 0 || ny >= CHUNK_Y) continue;
        const nb = BLOCKS[this.getBlock(nx, ny, nz)];
        if (!nb || nb.filter >= 15) continue;
        const cost = Math.max(1, nb.filter);
        const next = d === 3 && level === 15 && nb.filter === 0 ? 15 : level - cost;
        if (next <= 0) continue;
        if (this.getSky(nx, ny, nz) < next) {
          this.setSky(nx, ny, nz, next);
          this.markDirty(nx, ny, nz);
          this.skyQueue.push(nx, ny, nz);
        }
      }
    }
    // 方块光
    while (this.blockQueue.length && steps < maxSteps) {
      const z = this.blockQueue.pop(), y = this.blockQueue.pop(), x = this.blockQueue.pop();
      const level = this.getBlockLight(x, y, z);
      if (level <= 0) continue;
      steps++;
      for (let d = 0; d < 6; d++) {
        const nx = x + DX[d], ny = y + DY[d], nz = z + DZ[d];
        if (ny < 0 || ny >= CHUNK_Y) continue;
        const nb = BLOCKS[this.getBlock(nx, ny, nz)];
        if (!nb || nb.filter >= 15) continue;
        const next = level - Math.max(1, nb.filter);
        if (next <= 0) continue;
        if (this.getBlockLight(nx, ny, nz) < next) {
          this.setBlockLight(nx, ny, nz, next);
          this.markDirty(nx, ny, nz);
          this.blockQueue.push(nx, ny, nz);
        }
      }
    }
  }

  /** 方块变化后的局部重新照明 */
  updateLightAt(x, y, z, oldId, newId) {
    const ob = getBlock(oldId), nb = getBlock(newId);
    if (ob.light > 0 && nb.light < ob.light) this.removeBlockLight(x, y, z);
    if (nb.filter >= 15 && ob.filter < 15) {
      this.removeSkyLight(x, y, z);
    }
    if (nb.light > 0) {
      this.setBlockLight(x, y, z, nb.light);
      this.blockQueue.push(x, y, z);
    }
    if (nb.filter < 15) {
      // 让四周的光重新灌进来
      for (let d = 0; d < 6; d++) {
        const nx = x + DX[d], ny = y + DY[d], nz = z + DZ[d];
        if (ny < 0 || ny >= CHUNK_Y) continue;
        if (this.getSky(nx, ny, nz) > 0) this.skyQueue.push(nx, ny, nz);
        if (this.getBlockLight(nx, ny, nz) > 0) this.blockQueue.push(nx, ny, nz);
      }
      if (this.getSky(x, y + 1, z) === 15 && nb.filter === 0) {
        this.setSky(x, y, z, 15);
        this.skyQueue.push(x, y, z);
      }
    }
    this.propagateLight(60000);
  }

  removeBlockLight(x, y, z) {
    const stack = [x, y, z, this.getBlockLight(x, y, z)];
    this.setBlockLight(x, y, z, 0);
    while (stack.length) {
      const lvl = stack.pop(), cz = stack.pop(), cy = stack.pop(), cx = stack.pop();
      for (let d = 0; d < 6; d++) {
        const nx = cx + DX[d], ny = cy + DY[d], nz = cz + DZ[d];
        if (ny < 0 || ny >= CHUNK_Y) continue;
        const nl = this.getBlockLight(nx, ny, nz);
        if (nl === 0) continue;
        if (nl < lvl) {
          this.setBlockLight(nx, ny, nz, 0);
          this.markDirty(nx, ny, nz);
          stack.push(nx, ny, nz, nl);
        } else {
          this.blockQueue.push(nx, ny, nz);
        }
      }
    }
    this.markDirty(x, y, z);
  }

  removeSkyLight(x, y, z) {
    const stack = [x, y, z, this.getSky(x, y, z)];
    this.setSky(x, y, z, 0);
    while (stack.length) {
      const lvl = stack.pop(), cz = stack.pop(), cy = stack.pop(), cx = stack.pop();
      for (let d = 0; d < 6; d++) {
        const nx = cx + DX[d], ny = cy + DY[d], nz = cz + DZ[d];
        if (ny < 0 || ny >= CHUNK_Y) continue;
        const nl = this.getSky(nx, ny, nz);
        if (nl === 0) continue;
        if (nl < lvl || (d === 3 && lvl === 15 && nl === 15)) {
          this.setSky(nx, ny, nz, 0);
          this.markDirty(nx, ny, nz);
          stack.push(nx, ny, nz, nl);
        } else {
          this.skyQueue.push(nx, ny, nz);
        }
      }
    }
    this.markDirty(x, y, z);
  }

  /** 给网格生成器用的合成光照（0-15 两路） */
  lightAt(x, y, z) {
    return { sky: this.getSky(x, y, z), block: this.getBlockLight(x, y, z) };
  }

  // ── 流体 ──
  scheduleFluid(x, y, z, delay = 5) {
    const k = `${x},${y},${z}`;
    if (!this.fluidTicks.has(k)) this.fluidTicks.set(k, delay);
  }

  scheduleFluidAround(x, y, z) {
    for (let d = 0; d < 6; d++) {
      const nx = x + DX[d], ny = y + DY[d], nz = z + DZ[d];
      const b = this.getBlock(nx, ny, nz);
      if (b === ID.water || b === ID.lava) this.scheduleFluid(nx, ny, nz, b === ID.lava ? 15 : 5);
    }
    const here = this.getBlock(x, y, z);
    if (here === ID.water || here === ID.lava) this.scheduleFluid(x, y, z, here === ID.lava ? 15 : 5);
  }

  tickFluids() {
    if (!this.fluidTicks.size) return;
    const due = [];
    for (const [k, t] of this.fluidTicks) {
      if (t <= 1) due.push(k);
      else this.fluidTicks.set(k, t - 1);
    }
    let budget = 400;
    for (const k of due) {
      this.fluidTicks.delete(k);
      if (budget-- < 0) break;
      const [x, y, z] = k.split(',').map(Number);
      this.updateFluid(x, y, z);
    }
  }

  updateFluid(x, y, z) {
    const id = this.getBlock(x, y, z);
    if (id !== ID.water && id !== ID.lava) return;
    const isLava = id === ID.lava;
    const maxLevel = isLava ? 3 : 7;
    let level = this.getMeta(x, y, z);

    // 源方块（level 0）永远存在；流动方块需要有更高一级的邻居供给
    if (level > 0) {
      let best = 99;
      for (const [dx, dz] of HDIRS) {
        const nb = this.getBlock(x + dx, y, z + dz);
        if (nb === id) best = Math.min(best, this.getMeta(x + dx, y, z + dz));
      }
      const above = this.getBlock(x, y + 1, z);
      if (above === id) best = -1;              // 上方有同种液体 → 视为瀑布补给
      const need = best + 1;
      if (best === 99 || need > maxLevel) {
        this.setBlock(x, y, z, A, { noFluid: true });
        this.scheduleFluidAround(x, y, z);
        return;
      }
      if (need !== level && need > 0) {
        level = need;
        this.setMeta(x, y, z, level);
        this.markDirty(x, y, z);
      }
    }

    // 先向下流
    const belowId = this.getBlock(x, y - 1, z);
    const belowB = getBlock(belowId);
    if (this.canFlowInto(belowId, isLava)) {
      this.mixOrPlace(x, y - 1, z, id, 1, isLava);
      return;
    }
    if (belowB.liquid && belowId === id) return;

    // 再向四周扩散
    if (level >= maxLevel) return;
    for (const [dx, dz] of HDIRS) {
      const nx = x + dx, nz = z + dz;
      const nid = this.getBlock(nx, y, nz);
      if (this.canFlowInto(nid, isLava)) {
        this.mixOrPlace(nx, y, nz, id, level + 1, isLava);
      } else if (nid === id) {
        const nl = this.getMeta(nx, y, nz);
        if (nl > level + 1) {
          this.setMeta(nx, y, nz, level + 1);
          this.markDirty(nx, y, nz);
          this.scheduleFluid(nx, y, nz, isLava ? 15 : 5);
        }
      }
    }
  }

  canFlowInto(id, isLava) {
    if (id === A) return true;
    const b = getBlock(id);
    if (isLava && id === ID.water) return false;
    return b.replaceable && !b.liquid;
  }

  mixOrPlace(x, y, z, id, level, isLava) {
    // 水碰岩浆
    if (isLava) {
      for (let d = 0; d < 6; d++) {
        if (this.getBlock(x + DX[d], y + DY[d], z + DZ[d]) === ID.water) {
          this.setBlock(x, y, z, level <= 1 ? ID.obsidian : ID.cobblestone, { noFluid: true });
          return;
        }
      }
    } else {
      for (let d = 0; d < 6; d++) {
        if (this.getBlock(x + DX[d], y + DY[d], z + DZ[d]) === ID.lava) {
          this.setBlock(x, y, z, ID.stone, { noFluid: true });
          return;
        }
      }
    }
    this.setBlock(x, y, z, id, { meta: Math.min(level, 7), noFluid: true });
    this.scheduleFluid(x, y, z, isLava ? 15 : 5);
    this.scheduleFluidAround(x, y, z);
  }

  // ── 重力方块（沙/砾石）──
  tickGravity(x, y, z) {
    const id = this.getBlock(x, y, z);
    if (!getBlock(id).gravity) return;
    let ny = y;
    while (ny > 1) {
      const under = this.getBlock(x, ny - 1, z);
      const ub = getBlock(under);
      if (under === A || (ub.replaceable && !ub.solid)) ny--;
      else break;
    }
    if (ny !== y) {
      this.setBlock(x, y, z, A);
      this.setBlock(x, ny, z, id);
    }
  }

  // ── 区块流式加载 ──
  update(px, pz, renderDist) {
    const pcx = Math.floor(px / CHUNK_X);
    const pcz = Math.floor(pz / CHUNK_Z);
    let budget = this.genBudget;

    // 由近及远地补齐区块
    outer:
    for (let r = 0; r <= renderDist + 1; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const cx = pcx + dx, cz = pcz + dz;
          let c = this.getChunk(cx, cz);
          if (!c) {
            if (budget <= 0) break outer;
            c = this.ensureChunk(cx, cz);
            budget--;
          }
          if (!c.decorated && this.neighborsGenerated(cx, cz)) {
            if (budget <= 0) break outer;
            this.decorateChunk(c);
            budget--;
          }
          if (c.decorated && !c.lit && this.neighborsDecorated(cx, cz)) {
            this.initChunkLight(c);
          }
        }
      }
    }
    this.propagateLight(80000);

    // 卸载太远的区块
    const maxD = renderDist + 4;
    for (const [k, c] of this.chunks) {
      if (Math.abs(c.cx - pcx) > maxD || Math.abs(c.cz - pcz) > maxD) {
        if (c.mesh && c.mesh.dispose) c.mesh.dispose();
        this.chunks.delete(k);
      }
    }
  }

  neighborsGenerated(cx, cz) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const c = this.getChunk(cx + dx, cz + dz);
        if (!c || !c.generated) return false;
      }
    }
    return true;
  }

  neighborsDecorated(cx, cz) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const c = this.getChunk(cx + dx, cz + dz);
        if (!c || !c.decorated) return false;
      }
    }
    return true;
  }

  decorateChunk(c) {
    const setter = (x, y, z, id, onlyAir) => {
      if (y < 0 || y >= CHUNK_Y) return;
      const cx = x >> 4, cz = z >> 4;
      const target = this.chunks.get(key(cx, cz));
      const li = idx(x - cx * 16, y, z - cz * 16);
      if (target) {
        if (onlyAir && target.blocks[li] !== A) return;
        target.blocks[li] = id;
        target.dirty = true;
        const hmi = (z - cz * 16) * CHUNK_X + (x - cx * 16);
        if (y + 1 > target.heightMap[hmi]) target.heightMap[hmi] = y + 1;
      } else {
        const k = key(cx, cz);
        if (!this.pendingDecor.has(k)) this.pendingDecor.set(k, []);
        const list = this.pendingDecor.get(k);
        if (list.length < 20000) list.push([li, { id, onlyAir }]);
      }
    };
    const getter = (x, y, z) => this.getBlock(x, y, z);
    this.gen.decorate(c, setter, getter);
    c.recalcHeightMap();
  }

  // ── 射线检测（DDA 体素遍历）──
  raycast(ox, oy, oz, dx, dy, dz, maxDist = 6, includeLiquid = false) {
    let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = Math.abs(1 / (dx || 1e-9));
    const tDeltaY = Math.abs(1 / (dy || 1e-9));
    const tDeltaZ = Math.abs(1 / (dz || 1e-9));
    let tMaxX = ((dx > 0 ? x + 1 - ox : ox - x)) * tDeltaX;
    let tMaxY = ((dy > 0 ? y + 1 - oy : oy - y)) * tDeltaY;
    let tMaxZ = ((dz > 0 ? z + 1 - oz : oz - z)) * tDeltaZ;
    let face = [0, 0, 0];
    let t = 0;
    while (t <= maxDist) {
      const id = this.getBlock(x, y, z);
      if (id !== A) {
        const b = getBlock(id);
        const hittable = includeLiquid ? true : (b.solid || b.render === RT.CROSS || b.render === RT.TORCH || b.render === RT.LADDER);
        if (hittable && !(b.liquid && !includeLiquid)) {
          return { x, y, z, id, face, dist: t, hitX: ox + dx * t, hitY: oy + dy * t, hitZ: oz + dz * t };
        }
      }
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        x += stepX; t = tMaxX; tMaxX += tDeltaX; face = [-stepX, 0, 0];
      } else if (tMaxY < tMaxZ) {
        y += stepY; t = tMaxY; tMaxY += tDeltaY; face = [0, -stepY, 0];
      } else {
        z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; face = [0, 0, -stepZ];
      }
      if (y < -1 || y > CHUNK_Y + 1) break;
    }
    return null;
  }

  /** 给定 AABB 是否与世界方块相交 */
  intersects(minX, minY, minZ, maxX, maxY, maxZ) {
    for (let y = Math.floor(minY); y <= Math.floor(maxY); y++) {
      for (let z = Math.floor(minZ); z <= Math.floor(maxZ); z++) {
        for (let x = Math.floor(minX); x <= Math.floor(maxX); x++) {
          const boxes = collisionBoxes(this.getBlock(x, y, z));
          if (!boxes) continue;
          for (const [bx, by, bz, bX, bY, bZ] of boxes) {
            if (maxX > x + bx && minX < x + bX &&
                maxY > y + by && minY < y + bY &&
                maxZ > z + bz && minZ < z + bZ) return true;
          }
        }
      }
    }
    return false;
  }

  /** 收集与 AABB 相交的方块碰撞箱（世界坐标） */
  collectBoxes(minX, minY, minZ, maxX, maxY, maxZ, out) {
    out.length = 0;
    for (let y = Math.floor(minY) - 1; y <= Math.floor(maxY) + 1; y++) {
      for (let z = Math.floor(minZ) - 1; z <= Math.floor(maxZ) + 1; z++) {
        for (let x = Math.floor(minX) - 1; x <= Math.floor(maxX) + 1; x++) {
          const boxes = collisionBoxes(this.getBlock(x, y, z));
          if (!boxes) continue;
          for (const [bx, by, bz, bX, bY, bZ] of boxes) {
            out.push(x + bx, y + by, z + bz, x + bX, y + bY, z + bZ);
          }
        }
      }
    }
    return out;
  }

  // ── 方块实体（箱子/熔炉）──
  getTileEntity(x, y, z, create = null) {
    const cx = x >> 4, cz = z >> 4;
    const c = this.chunks.get(key(cx, cz));
    if (!c) return null;
    const li = idx(x - cx * 16, y, z - cz * 16);
    let te = c.tileEntities.get(li);
    if (!te && create) {
      te = create();
      c.tileEntities.set(li, te);
    }
    return te || null;
  }

  // ── 时间 ──
  tick(dt) {
    this.tickCount++;
    this.time = (this.time + dt * 20) % this.dayLength;
    if (this.tickCount % 3 === 0) this.tickFluids();
  }

  /** 0=午夜 1=正午。time 0=日出，6000=正午，12000=日落，18000=午夜 */
  get dayFactor() {
    const e = Math.sin(this.sunAngle);           // 太阳高度角的正弦
    const t = (e + 0.2) / 0.55;
    const c = t < 0 ? 0 : t > 1 ? 1 : t;
    return c * c * (3 - 2 * c);
  }

  get sunAngle() {
    return (this.time / this.dayLength) * Math.PI * 2;
  }

  isDay() {
    return this.time > 1000 && this.time < 13000;
  }

  /** 找到某列可站立的地面高度 */
  surfaceY(x, z) {
    const cx = x >> 4, cz = z >> 4;
    const c = this.chunks.get(key(cx, cz));
    if (!c) return SEA_LEVEL + 1;
    const lx = x - cx * 16, lz = z - cz * 16;
    for (let y = CHUNK_Y - 1; y > 0; y--) {
      const id = c.blocks[idx(lx, y, lz)];
      if (id !== A && getBlock(id).solid) return y + 1;
    }
    return SEA_LEVEL + 1;
  }
}

export const DX = [1, -1, 0, 0, 0, 0];
export const DY = [0, 0, 1, -1, 0, 0];
export const DZ = [0, 0, 0, 0, 1, -1];
const HDIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export { CHUNK_X, CHUNK_Y, CHUNK_Z, SEA_LEVEL };
