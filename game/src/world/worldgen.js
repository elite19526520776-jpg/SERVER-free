// 地形生成：气候参数 → 高度场 → 洞穴雕刻 → 地表铺装 → 矿脉 → 植被

import { Perlin, hash01, clamp, lerp, smoothstep } from '../util/noise.js';
import { CHUNK_X, CHUNK_Y, CHUNK_Z, SEA_LEVEL, idx } from './chunk.js';
import { ID } from './blocks.js';
import { pickBiome, BIOMES } from './biomes.js';

const A = ID.air;

export class WorldGen {
  constructor(seed = 1337) {
    this.seed = seed | 0;
    this.nCont = new Perlin(seed + 1);
    this.nEro = new Perlin(seed + 2);
    this.nTemp = new Perlin(seed + 3);
    this.nHumid = new Perlin(seed + 4);
    this.nPeak = new Perlin(seed + 5);
    this.nHill = new Perlin(seed + 6);
    this.nRiver = new Perlin(seed + 7);
    this.nCaveA = new Perlin(seed + 8);
    this.nCaveB = new Perlin(seed + 9);
    this.nCheese = new Perlin(seed + 10);
    this.nSurface = new Perlin(seed + 11);
    this.nRock = new Perlin(seed + 12);
    this.heightCache = new Map();
  }

  climate(x, z) {
    const cont = this.nCont.fbm2(x * 0.00085, z * 0.00085, 4);
    const ero = this.nEro.fbm2(x * 0.0016 + 100, z * 0.0016, 3);
    const temp = this.nTemp.fbm2(x * 0.00055 + 300, z * 0.00055, 3);
    const humid = this.nHumid.fbm2(x * 0.0007 + 700, z * 0.0007, 3);
    const weird = this.nPeak.fbm2(x * 0.0021 + 900, z * 0.0021, 2) * 0.5 + 0.5;
    return { cont, ero, temp, humid, weird };
  }

  /** 地表高度（含河流下切） */
  heightAt(x, z) {
    const key = x * 67108864 + z;
    const cached = this.heightCache.get(key);
    if (cached !== undefined) return cached;

    const c = this.climate(x, z);
    const land = smoothstep(-0.12, 0.14, c.cont);
    const oceanDepth = lerp(SEA_LEVEL - 34, SEA_LEVEL - 5, smoothstep(-1, -0.1, c.cont));

    const flatness = clamp(c.ero * 0.5 + 0.5, 0, 1);      // 1 = 平坦
    const hills = this.nHill.fbm2(x * 0.0065, z * 0.0065, 4);
    const detail = this.nHill.fbm2(x * 0.025 + 55, z * 0.025, 3) * 1.6;

    let h = SEA_LEVEL + 3 + hills * lerp(16, 3, flatness) + detail;

    // 山脉：脊状噪声 × 大陆度 × 低侵蚀
    const ridge = this.nPeak.ridged2(x * 0.0032, z * 0.0032, 5) * 0.5 + 0.5;
    const mountainMask = smoothstep(0.2, 0.72, c.cont) * (1 - flatness) * smoothstep(0.42, 0.92, ridge);
    h += mountainMask * 62;

    h = lerp(oceanDepth, h, land);

    // 河流：绝对值接近 0 的地方切出河谷
    const r = Math.abs(this.nRiver.fbm2(x * 0.0011 + 2000, z * 0.0011, 2));
    if (r < 0.055 && h > SEA_LEVEL - 2) {
      const k = 1 - r / 0.055;
      const carve = smoothstep(0, 1, k) * (h - (SEA_LEVEL - 3));
      h -= carve * clamp(1 - mountainMask * 1.4, 0, 1);
    }

    h = clamp(Math.round(h), 3, CHUNK_Y - 12);
    if (this.heightCache.size > 300000) this.heightCache.clear();
    this.heightCache.set(key, h);
    return h;
  }

  biomeAt(x, z) {
    const c = this.climate(x, z);
    const h = this.heightAt(x, z);
    const r = Math.abs(this.nRiver.fbm2(x * 0.0011 + 2000, z * 0.0011, 2));
    if (r < 0.02 && h <= SEA_LEVEL + 1 && h > SEA_LEVEL - 8) {
      return BIOMES.find((b) => b.name === 'river');
    }
    // 蘑菇岛：孤岛且湿热
    if (c.cont > 0.1 && c.cont < 0.28 && c.humid > 0.55 && c.weird > 0.8) {
      return BIOMES.find((b) => b.name === 'mushroom_fields');
    }
    return pickBiome(c.cont, c.ero, c.temp, c.humid, h, SEA_LEVEL, c.weird);
  }

  // ── 洞穴：在稀疏网格上采样再三线性插值，避免逐格算噪声 ──
  buildCaveField(cx, cz) {
    const SX = 5, SZ = 5, SY = 33;   // x/z 步长 4，y 步长 4
    const fieldA = new Float32Array(SX * SY * SZ);
    const fieldB = new Float32Array(SX * SY * SZ);
    const fieldC = new Float32Array(SX * SY * SZ);
    for (let iz = 0; iz < SZ; iz++) {
      for (let ix = 0; ix < SX; ix++) {
        const wx = cx * CHUNK_X + ix * 4;
        const wz = cz * CHUNK_Z + iz * 4;
        for (let iy = 0; iy < SY; iy++) {
          const wy = iy * 4;
          const o = (iy * SZ + iz) * SX + ix;
          fieldA[o] = this.nCaveA.fbm3(wx * 0.019, wy * 0.032, wz * 0.019, 2);
          fieldB[o] = this.nCaveB.fbm3(wx * 0.019 + 40, wy * 0.032, wz * 0.019 + 40, 2);
          fieldC[o] = this.nCheese.fbm3(wx * 0.011, wy * 0.017, wz * 0.011, 3);
        }
      }
    }
    return { fieldA, fieldB, fieldC, SX, SY, SZ };
  }

  sampleField(f, field, x, y, z) {
    const { SX, SZ } = f;
    const gx = x / 4, gy = y / 4, gz = z / 4;
    const x0 = Math.min(Math.floor(gx), f.SX - 2);
    const y0 = Math.min(Math.floor(gy), f.SY - 2);
    const z0 = Math.min(Math.floor(gz), f.SZ - 2);
    const tx = gx - x0, ty = gy - y0, tz = gz - z0;
    const at = (ix, iy, iz) => field[(iy * SZ + iz) * SX + ix];
    const c00 = lerp(at(x0, y0, z0), at(x0 + 1, y0, z0), tx);
    const c10 = lerp(at(x0, y0, z0 + 1), at(x0 + 1, y0, z0 + 1), tx);
    const c01 = lerp(at(x0, y0 + 1, z0), at(x0 + 1, y0 + 1, z0), tx);
    const c11 = lerp(at(x0, y0 + 1, z0 + 1), at(x0 + 1, y0 + 1, z0 + 1), tx);
    return lerp(lerp(c00, c10, tz), lerp(c01, c11, tz), ty);
  }

  /** 生成区块的地形（不含植被） */
  generate(chunk) {
    const cx = chunk.cx, cz = chunk.cz;
    const blocks = chunk.blocks;
    const caves = this.buildCaveField(cx, cz);

    for (let z = 0; z < CHUNK_Z; z++) {
      for (let x = 0; x < CHUNK_X; x++) {
        const wx = cx * CHUNK_X + x;
        const wz = cz * CHUNK_Z + z;
        const h = this.heightAt(wx, wz);
        const biome = this.biomeAt(wx, wz);
        chunk.biome[z * CHUNK_X + x] = biome.id;

        const rockVar = this.nRock.fbm2(wx * 0.045, wz * 0.045, 2);
        const rockVar2 = this.nRock.fbm2(wx * 0.03 + 90, wz * 0.03, 2);

        for (let y = 0; y <= Math.max(h, SEA_LEVEL); y++) {
          let id = A;
          if (y === 0) id = ID.bedrock;
          else if (y <= 2 && hash01(wx, wz, y) < 0.6) id = ID.bedrock;
          else if (y <= h) {
            // 基岩层次
            if (y > 68 && y > h - 24) id = ID.stone;
            else if (y < 24) id = ID.deepslate;
            else id = ID.stone;
            // 花岗岩/闪长岩/安山岩矿脉
            if (id === ID.stone) {
              const v = this.nRock.fbm3(wx * 0.055, y * 0.055, wz * 0.055, 2);
              if (v > 0.42) id = rockVar > 0 ? ID.granite : ID.andesite;
              else if (v < -0.44) id = rockVar2 > 0 ? ID.diorite : ID.andesite;
            }
          } else if (y <= SEA_LEVEL) {
            id = ID.water;
          }
          if (id !== A) blocks[idx(x, y, z)] = id;
        }

        // 洞穴雕刻
        const caveTop = Math.min(h, CHUNK_Y - 1);
        for (let y = 3; y <= caveTop; y++) {
          const i = idx(x, y, z);
          const b = blocks[i];
          if (b === A || b === ID.bedrock || b === ID.water) continue;
          const a = this.sampleField(caves, caves.fieldA, x, y, z);
          const bb = this.sampleField(caves, caves.fieldB, x, y, z);
          const cc = this.sampleField(caves, caves.fieldC, x, y, z);
          const nearSurface = y > h - 4;
          const spaghetti = Math.abs(a) < 0.055 && Math.abs(bb) < 0.055;
          const cheese = cc > 0.52 && y < h - 6;
          if ((spaghetti && !nearSurface) || cheese) {
            blocks[i] = y < 11 ? ID.lava : A;
          }
        }

        // 地表铺装
        let depth = 0;
        let seenAir = y0Air(blocks, x, z, h);
        for (let y = h; y >= Math.max(0, h - 8); y--) {
          const i = idx(x, y, z);
          if (blocks[i] === A || blocks[i] === ID.water || blocks[i] === ID.lava) { depth = 0; continue; }
          if (blocks[i] === ID.bedrock) break;
          depth++;
          const underWater = h < SEA_LEVEL;
          if (depth === 1) {
            let surf = underWater ? biome.underwater : biome.surface;
            if (y < SEA_LEVEL - 1 && !underWater) surf = biome.filler;
            blocks[i] = ID[surf] !== undefined ? ID[surf] : ID.dirt;
            // 恶地的分层陶瓦
            if (biome.name === 'badlands' && y > SEA_LEVEL + 4) {
              blocks[i] = badlandsLayer(y);
            }
          } else if (depth <= biome.fillerDepth + 1) {
            let f = biome.filler;
            if (biome.name === 'badlands' && y > SEA_LEVEL) blocks[i] = badlandsLayer(y);
            else blocks[i] = ID[f] !== undefined ? ID[f] : ID.dirt;
          }
        }

        // 雪盖与冰面
        if (biome.snow) {
          if (h >= SEA_LEVEL && blocks[idx(x, h, z)] !== A) {
            const top = Math.min(h + 1, CHUNK_Y - 1);
            if (blocks[idx(x, top, z)] === A) blocks[idx(x, top, z)] = ID.snow_block;
          }
          if (h < SEA_LEVEL && blocks[idx(x, SEA_LEVEL, z)] === ID.water) {
            blocks[idx(x, SEA_LEVEL, z)] = ID.ice;
          }
        }
        void seenAir;
      }
    }

    this.generateOres(chunk);
    chunk.recalcHeightMap();
    chunk.generated = true;
    chunk.empty = false;
  }

  /** 矿脉：按区块确定性地撒团簇 */
  generateOres(chunk) {
    const cx = chunk.cx, cz = chunk.cz;
    const veins = [
      { id: ID.coal_ore, count: 20, size: 14, minY: 8, maxY: 110 },
      { id: ID.copper_ore, count: 10, size: 9, minY: 12, maxY: 80 },
      { id: ID.iron_ore, count: 14, size: 8, minY: 6, maxY: 72 },
      { id: ID.gold_ore, count: 4, size: 7, minY: 4, maxY: 34 },
      { id: ID.redstone_ore, count: 6, size: 7, minY: 3, maxY: 26 },
      { id: ID.lapis_ore, count: 3, size: 6, minY: 4, maxY: 34 },
      { id: ID.diamond_ore, count: 3, size: 6, minY: 2, maxY: 20 },
      { id: ID.emerald_ore, count: 2, size: 4, minY: 20, maxY: 90 },
      { id: ID.gravel, count: 6, size: 26, minY: 20, maxY: 90 },
      { id: ID.dirt, count: 8, size: 26, minY: 20, maxY: 100 },
    ];
    let salt = 0;
    for (const v of veins) {
      for (let n = 0; n < v.count; n++) {
        const r1 = hash01(cx, cz, salt++);
        const r2 = hash01(cz, cx, salt++);
        const r3 = hash01(cx + n, cz - n, salt++);
        const ox = r1 * CHUNK_X;
        const oz = r2 * CHUNK_Z;
        const oy = v.minY + r3 * (v.maxY - v.minY);
        if (v.id === ID.emerald_ore && r1 > 0.35) continue;
        const size = v.size * (0.6 + hash01(n, salt) * 0.7);
        const radius = Math.cbrt(size) * 1.1;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dz = -radius; dz <= radius; dz++) {
            for (let dx = -radius; dx <= radius; dx++) {
              const d = Math.sqrt(dx * dx + dy * dy * 1.4 + dz * dz);
              if (d > radius) continue;
              const x = Math.floor(ox + dx), y = Math.floor(oy + dy), z = Math.floor(oz + dz);
              if (x < 0 || x >= CHUNK_X || z < 0 || z >= CHUNK_Z || y < 1 || y >= CHUNK_Y) continue;
              const i = idx(x, y, z);
              const cur = chunk.blocks[i];
              if (cur === ID.stone || cur === ID.deepslate || cur === ID.granite ||
                  cur === ID.diorite || cur === ID.andesite) {
                chunk.blocks[i] = v.id;
              }
            }
          }
        }
      }
    }
  }

  /**
   * 植被与结构。需要写入相邻区块时通过 setter 回调，由 World 负责跨区块写入。
   * setter(worldX, y, worldZ, id, replaceOnlyAir)
   */
  decorate(chunk, setter, getter) {
    const cx = chunk.cx, cz = chunk.cz;
    // 遍历包含外扩 8 格的列，保证跨界的树也能长进本区块
    for (let dz = -8; dz < CHUNK_Z + 8; dz++) {
      for (let dx = -8; dx < CHUNK_X + 8; dx++) {
        const wx = cx * CHUNK_X + dx;
        const wz = cz * CHUNK_Z + dz;
        const inside = dx >= 0 && dx < CHUNK_X && dz >= 0 && dz < CHUNK_Z;
        const h = this.heightAt(wx, wz);
        if (h < SEA_LEVEL - 1) {
          if (inside) this.decorateUnderwater(wx, wz, h, setter);
          continue;
        }
        const biome = this.biomeAt(wx, wz);
        const surfaceY = h;
        const rTree = hash01(wx, wz, 101);

        if (biome.treeChance > 0 && rTree < biome.treeChance) {
          const type = pickWeighted(biome.trees, hash01(wx, wz, 102));
          if (type) this.buildTree(wx, surfaceY + 1, wz, type, setter, getter, hash01(wx, wz, 103));
          continue;
        }
        if (!inside) continue;

        // 只有本区块内才放置小型植被
        const ground = getter(wx, surfaceY, wz);
        const canPlant = ground === ID.grass_block || ground === ID.dirt || ground === ID.podzol ||
                         ground === ID.mycelium || ground === ID.coarse_dirt;
        const canSand = ground === ID.sand || ground === ID.red_sand;
        const y = surfaceY + 1;
        if (getter(wx, y, wz) !== A) continue;

        const r = hash01(wx, wz, 201);
        if (canPlant && r < biome.grassChance) {
          setter(wx, y, wz, hash01(wx, wz, 202) < 0.25 && biome.temperature < 0.5 ? ID.fern : ID.tall_grass);
        } else if (canPlant && r < biome.grassChance + biome.flowerChance) {
          const f = biome.flowers[Math.floor(hash01(wx, wz, 203) * biome.flowers.length)];
          setter(wx, y, wz, ID[f]);
        } else if ((canPlant || ground === ID.mycelium) && r < biome.grassChance + biome.flowerChance + biome.mushroomChance) {
          setter(wx, y, wz, hash01(wx, wz, 204) < 0.5 ? ID.brown_mushroom : ID.red_mushroom);
        } else if (canSand && r < biome.cactusChance) {
          const hgt = 1 + Math.floor(hash01(wx, wz, 205) * 3);
          for (let i = 0; i < hgt; i++) setter(wx, y + i, wz, ID.cactus);
        } else if (canSand && r < biome.cactusChance + biome.deadBushChance) {
          setter(wx, y, wz, ID.dead_bush);
        } else if (r < biome.pumpkinChance && canPlant) {
          setter(wx, y, wz, ID.pumpkin);
        }

        // 甘蔗：紧邻水源
        if (biome.caneChance > 0 && hash01(wx, wz, 206) < biome.caneChance &&
            (ground === ID.sand || ground === ID.grass_block || ground === ID.dirt)) {
          if (nearWater(getter, wx, surfaceY, wz)) {
            const hgt = 1 + Math.floor(hash01(wx, wz, 207) * 3);
            for (let i = 0; i < hgt; i++) setter(wx, y + i, wz, ID.sugar_cane);
          }
        }
      }
    }
    chunk.decorated = true;
  }

  decorateUnderwater(wx, wz, h, setter) {
    if (h < SEA_LEVEL - 12) return;
    if (hash01(wx, wz, 301) < 0.02) {
      setter(wx, h, wz, ID.clay);
      setter(wx, h - 1, wz, ID.clay);
    }
  }

  /** 各种树形 */
  buildTree(x, y, z, type, set, get, r) {
    const ground = get(x, y - 1, z);
    if (ground !== ID.grass_block && ground !== ID.dirt && ground !== ID.podzol &&
        ground !== ID.mycelium && ground !== ID.coarse_dirt && ground !== ID.sand) return;
    const rnd = (n) => hash01(x, z, 400 + n);

    const leafBall = (cx, cy, cz, rx, ry, leaf, holes = 0.15) => {
      for (let dy = -ry; dy <= ry; dy++) {
        for (let dz = -rx; dz <= rx; dz++) {
          for (let dx = -rx; dx <= rx; dx++) {
            const d = Math.sqrt(dx * dx + dy * dy * (rx / ry) * (rx / ry) + dz * dz);
            if (d > rx + 0.4) continue;
            if (d > rx - 0.6 && hash01(cx + dx, cz + dz, cy + dy) < holes + 0.35) continue;
            set(cx + dx, cy + dy, cz + dz, leaf, true);
          }
        }
      }
    };

    switch (type) {
      case 'oak':
      case 'swamp_oak': {
        const hgt = 4 + Math.floor(rnd(1) * 3);
        for (let i = 0; i < hgt; i++) set(x, y + i, z, ID.oak_log);
        leafBall(x, y + hgt - 1, z, 2, 2, ID.oak_leaves);
        leafBall(x, y + hgt, z, 1, 1, ID.oak_leaves, 0.05);
        if (type === 'swamp_oak') {
          for (let i = 0; i < 6; i++) {
            const ax = x + Math.floor(rnd(10 + i) * 5) - 2;
            const az = z + Math.floor(rnd(20 + i) * 5) - 2;
            set(ax, y + hgt - 2, az, ID.oak_leaves, true);
          }
        }
        break;
      }
      case 'big_oak': {
        const hgt = 7 + Math.floor(rnd(1) * 4);
        for (let i = 0; i < hgt; i++) {
          set(x, y + i, z, ID.oak_log);
          if (i > 2 && i % 3 === 0) {
            const bx = x + (rnd(i) > 0.5 ? 1 : -1);
            const bz = z + (rnd(i + 5) > 0.5 ? 1 : -1);
            set(bx, y + i, bz, ID.oak_log);
            leafBall(bx, y + i + 1, bz, 2, 2, ID.oak_leaves);
          }
        }
        leafBall(x, y + hgt - 1, z, 3, 3, ID.oak_leaves);
        leafBall(x, y + hgt + 1, z, 2, 1, ID.oak_leaves, 0.05);
        break;
      }
      case 'birch':
      case 'tall_birch': {
        const hgt = (type === 'tall_birch' ? 7 : 5) + Math.floor(rnd(1) * 3);
        for (let i = 0; i < hgt; i++) set(x, y + i, z, ID.birch_log);
        leafBall(x, y + hgt - 1, z, 2, 2, ID.birch_leaves);
        leafBall(x, y + hgt, z, 1, 1, ID.birch_leaves, 0.05);
        break;
      }
      case 'spruce':
      case 'tall_spruce': {
        const hgt = (type === 'tall_spruce' ? 10 : 6) + Math.floor(rnd(1) * 4);
        for (let i = 0; i < hgt; i++) set(x, y + i, z, ID.spruce_log);
        let radius = 0;
        for (let i = hgt - 1; i >= 2; i--) {
          const layer = (hgt - 1 - i) % 4;
          radius = layer === 0 ? 1 : layer === 1 ? 2 : layer === 2 ? 2 : 1;
          if (i > hgt - 3) radius = i === hgt - 1 ? 0 : 1;
          for (let dz = -radius; dz <= radius; dz++) {
            for (let dx = -radius; dx <= radius; dx++) {
              if (Math.abs(dx) === radius && Math.abs(dz) === radius && radius > 1) continue;
              if (dx === 0 && dz === 0 && i < hgt) continue;
              set(x + dx, y + i, z + dz, ID.spruce_leaves, true);
            }
          }
        }
        set(x, y + hgt, z, ID.spruce_leaves, true);
        break;
      }
      case 'jungle':
      case 'big_jungle': {
        const big = type === 'big_jungle';
        const hgt = (big ? 14 : 7) + Math.floor(rnd(1) * 5);
        for (let i = 0; i < hgt; i++) {
          set(x, y + i, z, ID.jungle_log);
          if (big) {
            set(x + 1, y + i, z, ID.jungle_log);
            set(x, y + i, z + 1, ID.jungle_log);
            set(x + 1, y + i, z + 1, ID.jungle_log);
          }
        }
        leafBall(x, y + hgt - 1, z, big ? 4 : 3, big ? 3 : 2, ID.jungle_leaves);
        leafBall(x, y + hgt + 1, z, big ? 3 : 2, 1, ID.jungle_leaves, 0.05);
        if (big) {
          for (let i = 0; i < 4; i++) {
            const bx = x + (i < 2 ? -3 : 3);
            const bz = z + (i % 2 ? -2 : 2);
            leafBall(bx, y + hgt - 4, bz, 2, 2, ID.jungle_leaves);
            set(bx, y + hgt - 5, bz, ID.jungle_log);
          }
        }
        break;
      }
      case 'acacia': {
        const hgt = 5 + Math.floor(rnd(1) * 3);
        for (let i = 0; i < hgt; i++) set(x, y + i, z, ID.acacia_log);
        const dirX = rnd(2) > 0.5 ? 1 : -1;
        const dirZ = rnd(3) > 0.5 ? 1 : -1;
        let bx = x, bz = z;
        for (let i = 0; i < 3; i++) {
          bx += dirX;
          bz += i % 2 ? dirZ : 0;
          set(bx, y + hgt + i - 1, bz, ID.acacia_log);
        }
        // 伞状树冠
        for (let dz = -3; dz <= 3; dz++) {
          for (let dx = -3; dx <= 3; dx++) {
            if (dx * dx + dz * dz > 10) continue;
            set(bx + dx, y + hgt + 2, bz + dz, ID.acacia_leaves, true);
            if (dx * dx + dz * dz < 5) set(bx + dx, y + hgt + 3, bz + dz, ID.acacia_leaves, true);
          }
        }
        break;
      }
      case 'dark_oak': {
        const hgt = 6 + Math.floor(rnd(1) * 3);
        for (let i = 0; i < hgt; i++) {
          for (const [ddx, ddz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
            set(x + ddx, y + i, z + ddz, ID.dark_oak_log);
          }
        }
        leafBall(x, y + hgt, z, 4, 2, ID.dark_oak_leaves);
        leafBall(x + 1, y + hgt + 1, z + 1, 3, 1, ID.dark_oak_leaves, 0.1);
        break;
      }
      default:
        break;
    }
  }
}

function badlandsLayer(y) {
  const bands = [ID.terracotta, ID.orange_terracotta, ID.terracotta, ID.yellow_terracotta,
    ID.brown_terracotta, ID.terracotta, ID.red_terracotta, ID.white_terracotta,
    ID.light_gray_terracotta, ID.terracotta];
  return bands[Math.abs(Math.floor(y / 2 + Math.sin(y * 0.7) * 1.5)) % bands.length];
}

function pickWeighted(list, r) {
  if (!list.length) return null;
  let total = 0;
  for (const e of list) total += e.weight;
  let acc = 0;
  for (const e of list) {
    acc += e.weight / total;
    if (r <= acc) return e.type;
  }
  return list[list.length - 1].type;
}

function nearWater(get, x, y, z) {
  return get(x + 1, y, z) === ID.water || get(x - 1, y, z) === ID.water ||
         get(x, y, z + 1) === ID.water || get(x, y, z - 1) === ID.water;
}

function y0Air() { return false; }

export { SEA_LEVEL };
