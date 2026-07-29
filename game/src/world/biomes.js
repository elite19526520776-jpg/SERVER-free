// 生物群系定义与选择
// 采用「气候参数」方式：大陆度 / 侵蚀度 / 温度 / 湿度 / 高度 共同决定群系。

import { smoothstep, clamp } from '../util/noise.js';

function rgb(h) {
  return [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
}

export const BIOMES = [];
let bid = 0;
function biome(name, opts) {
  const b = {
    id: bid++,
    name,
    display: opts.display,
    surface: opts.surface || 'grass_block',
    filler: opts.filler || 'dirt',
    underwater: opts.underwater || 'gravel',
    fillerDepth: opts.fillerDepth !== undefined ? opts.fillerDepth : 3,
    grass: rgb(opts.grass !== undefined ? opts.grass : 0x79c05a),
    foliage: rgb(opts.foliage !== undefined ? opts.foliage : 0x59ae30),
    water: rgb(opts.water !== undefined ? opts.water : 0x3f76e4),
    fog: rgb(opts.fog !== undefined ? opts.fog : 0xa8c8ff),
    trees: opts.trees || [],          // [{type, weight}]
    treeChance: opts.treeChance || 0,
    grassChance: opts.grassChance || 0,
    flowerChance: opts.flowerChance || 0,
    flowers: opts.flowers || ['dandelion', 'poppy'],
    cactusChance: opts.cactusChance || 0,
    caneChance: opts.caneChance || 0,
    mushroomChance: opts.mushroomChance || 0,
    deadBushChance: opts.deadBushChance || 0,
    pumpkinChance: opts.pumpkinChance || 0,
    snow: !!opts.snow,
    temperature: opts.temperature !== undefined ? opts.temperature : 0.6,
    passiveMobs: opts.passiveMobs || ['pig', 'cow', 'sheep', 'chicken'],
    heightScale: opts.heightScale !== undefined ? opts.heightScale : 1,
  };
  BIOMES.push(b);
  return b;
}

export const OCEAN = biome('ocean', {
  display: '海洋', surface: 'gravel', filler: 'gravel', underwater: 'gravel',
  grass: 0x74b34a, water: 0x3f76e4, fog: 0x9fbfe8, passiveMobs: [],
});
export const DEEP_OCEAN = biome('deep_ocean', {
  display: '深海', surface: 'gravel', filler: 'gravel', grass: 0x74b34a,
  water: 0x2c5fd0, fog: 0x8fb0da, passiveMobs: [],
});
export const RIVER = biome('river', {
  display: '河流', surface: 'sand', filler: 'sand', grass: 0x77c05a,
  water: 0x3f7ee4, passiveMobs: [], caneChance: 0.06,
});
export const BEACH = biome('beach', {
  display: '沙滩', surface: 'sand', filler: 'sand', underwater: 'sand',
  grass: 0x8bc95a, caneChance: 0.02, passiveMobs: [],
});
export const STONY_SHORE = biome('stony_shore', {
  display: '石岸', surface: 'stone', filler: 'stone', underwater: 'gravel',
  grass: 0x8ab689, passiveMobs: [],
});
export const PLAINS = biome('plains', {
  display: '平原', grass: 0x91bd59, foliage: 0x77ab2f,
  trees: [{ type: 'oak', weight: 1 }], treeChance: 0.006,
  grassChance: 0.28, flowerChance: 0.02, caneChance: 0.01, pumpkinChance: 0.0015,
});
export const FLOWER_PLAINS = biome('flower_plains', {
  display: '繁花平原', grass: 0x8ecc4c, foliage: 0x7bbf2f,
  trees: [{ type: 'oak', weight: 1 }], treeChance: 0.004,
  grassChance: 0.3, flowerChance: 0.2,
  flowers: ['dandelion', 'poppy', 'allium', 'cornflower', 'oxeye_daisy', 'blue_orchid'],
});
export const FOREST = biome('forest', {
  display: '森林', grass: 0x79c05a, foliage: 0x59ae30,
  trees: [{ type: 'oak', weight: 4 }, { type: 'birch', weight: 1 }, { type: 'big_oak', weight: 1 }],
  treeChance: 0.09, grassChance: 0.22, flowerChance: 0.03, mushroomChance: 0.004,
});
export const FLOWER_FOREST = biome('flower_forest', {
  display: '繁花森林', grass: 0x79c05a, foliage: 0x59ae30,
  trees: [{ type: 'oak', weight: 3 }, { type: 'birch', weight: 2 }],
  treeChance: 0.05, grassChance: 0.2, flowerChance: 0.28,
  flowers: ['dandelion', 'poppy', 'allium', 'cornflower', 'oxeye_daisy', 'blue_orchid'],
});
export const BIRCH_FOREST = biome('birch_forest', {
  display: '白桦森林', grass: 0x88bb67, foliage: 0x6ba941,
  trees: [{ type: 'birch', weight: 1 }, { type: 'tall_birch', weight: 1 }],
  treeChance: 0.1, grassChance: 0.2, flowerChance: 0.02, mushroomChance: 0.004,
});
export const DARK_FOREST = biome('dark_forest', {
  display: '黑森林', grass: 0x507a32, foliage: 0x3f6b22,
  trees: [{ type: 'dark_oak', weight: 5 }, { type: 'oak', weight: 1 }],
  treeChance: 0.16, grassChance: 0.14, mushroomChance: 0.02, flowerChance: 0.01,
});
export const TAIGA = biome('taiga', {
  display: '针叶林', grass: 0x68a464, foliage: 0x5c9a5c, temperature: 0.25,
  trees: [{ type: 'spruce', weight: 3 }, { type: 'tall_spruce', weight: 1 }],
  treeChance: 0.1, grassChance: 0.18, mushroomChance: 0.006, flowers: ['poppy'],
  passiveMobs: ['wolf_placeholder', 'sheep', 'cow', 'chicken'],
});
export const SNOWY_TAIGA = biome('snowy_taiga', {
  display: '雪原针叶林', grass: 0x60a17b, foliage: 0x5c9a6c, temperature: -0.4, snow: true,
  trees: [{ type: 'spruce', weight: 1 }], treeChance: 0.08, grassChance: 0.06,
  water: 0x3d57d6, fog: 0xc8d8f0, passiveMobs: ['rabbit_placeholder', 'sheep'],
});
export const SNOWY_PLAINS = biome('snowy_plains', {
  display: '雪原', grass: 0x80b497, foliage: 0x60a17b, temperature: -0.5, snow: true,
  treeChance: 0.002, trees: [{ type: 'spruce', weight: 1 }], grassChance: 0.02,
  water: 0x3d57d6, fog: 0xd0e0f5, passiveMobs: ['sheep'],
});
export const ICE_SPIKES = biome('ice_spikes', {
  display: '冰刺之地', surface: 'snow_block', filler: 'dirt', grass: 0x80b497,
  temperature: -0.7, snow: true, water: 0x3938c9, fog: 0xd8e8ff, passiveMobs: [],
});
export const MOUNTAINS = biome('mountains', {
  display: '山地', grass: 0x8ab689, foliage: 0x6da36b, temperature: 0.2,
  trees: [{ type: 'spruce', weight: 2 }, { type: 'oak', weight: 1 }],
  treeChance: 0.02, grassChance: 0.1, flowerChance: 0.01, heightScale: 1,
  passiveMobs: ['sheep', 'goat_placeholder'],
});
export const SNOWY_MOUNTAINS = biome('snowy_mountains', {
  display: '雪山', surface: 'snow_block', filler: 'stone', grass: 0x80b497,
  temperature: -0.6, snow: true, treeChance: 0.004, trees: [{ type: 'spruce', weight: 1 }],
  fog: 0xdce8f8, passiveMobs: [],
});
export const DESERT = biome('desert', {
  display: '沙漠', surface: 'sand', filler: 'sand', underwater: 'sand', fillerDepth: 5,
  grass: 0xbfb755, foliage: 0xaea42a, temperature: 1.2, water: 0x32a598, fog: 0xe8dcb0,
  cactusChance: 0.012, deadBushChance: 0.02, caneChance: 0.01, passiveMobs: [],
});
export const SAVANNA = biome('savanna', {
  display: '热带草原', grass: 0xbfb755, foliage: 0xaea42a, temperature: 1.1,
  trees: [{ type: 'acacia', weight: 1 }], treeChance: 0.012,
  grassChance: 0.4, deadBushChance: 0.004, fog: 0xd8dcb0,
  passiveMobs: ['cow', 'sheep', 'horse_placeholder'],
});
export const JUNGLE = biome('jungle', {
  display: '丛林', grass: 0x59c93c, foliage: 0x30bb0b, temperature: 0.95,
  trees: [{ type: 'jungle', weight: 4 }, { type: 'big_jungle', weight: 1 }],
  treeChance: 0.14, grassChance: 0.45, flowerChance: 0.02, mushroomChance: 0.01,
  caneChance: 0.03, melonChance: 0.004, fog: 0xa8d8b0,
  passiveMobs: ['pig', 'chicken', 'parrot_placeholder'],
});
export const SWAMP = biome('swamp', {
  display: '沼泽', grass: 0x6a7039, foliage: 0x6a7039, temperature: 0.8,
  surface: 'grass_block', trees: [{ type: 'swamp_oak', weight: 1 }], treeChance: 0.03,
  grassChance: 0.25, mushroomChance: 0.03, water: 0x617b64, fog: 0x9fb08a,
  flowers: ['blue_orchid'], flowerChance: 0.02, caneChance: 0.04,
  passiveMobs: ['slime_placeholder', 'cow'],
});
export const BADLANDS = biome('badlands', {
  display: '恶地', surface: 'red_sand', filler: 'terracotta', underwater: 'red_sand',
  fillerDepth: 4, grass: 0x90814d, foliage: 0x9e814d, temperature: 1.2,
  deadBushChance: 0.02, cactusChance: 0.004, fog: 0xe0bc90, passiveMobs: [],
});
export const MUSHROOM_FIELDS = biome('mushroom_fields', {
  display: '蘑菇岛', surface: 'mycelium', filler: 'dirt', grass: 0x6a9b58,
  mushroomChance: 0.12, temperature: 0.9, fog: 0xc8b8d0, passiveMobs: ['mooshroom_placeholder'],
});

export const BIOME_BY_NAME = {};
for (const b of BIOMES) BIOME_BY_NAME[b.name] = b;

/**
 * 根据气候参数挑选群系。
 * cont: 大陆度(-1 深海 → 1 内陆), ero: 侵蚀(高=平坦), temp/humid: -1..1
 * height: 地表高度, seaLevel
 */
export function pickBiome(cont, ero, temp, humid, height, seaLevel, weird) {
  // 水域
  if (height < seaLevel - 1) {
    if (height < seaLevel - 16) return DEEP_OCEAN;
    return OCEAN;
  }
  const mountainH = seaLevel + 42;
  const hillH = seaLevel + 24;

  // 高山
  if (height > mountainH) {
    return temp < -0.15 || height > mountainH + 18 ? SNOWY_MOUNTAINS : MOUNTAINS;
  }
  // 海岸
  if (height <= seaLevel + 2) {
    if (temp < -0.35) return SNOWY_PLAINS;
    if (cont < 0.08 || ero > 0.35) return BEACH;
    if (weird > 0.55) return STONY_SHORE;
    return BEACH;
  }

  // 陆地：按温度 / 湿度分区
  if (temp < -0.45) {
    if (weird > 0.75 && humid < -0.2) return ICE_SPIKES;
    return humid > 0.1 ? SNOWY_TAIGA : SNOWY_PLAINS;
  }
  if (temp < -0.05) {
    if (height > hillH) return MOUNTAINS;
    return humid > 0 ? TAIGA : SNOWY_PLAINS;
  }
  if (temp < 0.35) {
    if (humid > 0.45) return DARK_FOREST;
    if (humid > 0.05) return FOREST;
    if (humid > -0.25) return weird > 0.5 ? BIRCH_FOREST : PLAINS;
    return PLAINS;
  }
  if (temp < 0.75) {
    if (humid > 0.6) return SWAMP;
    if (humid > 0.25) return weird > 0.4 ? BIRCH_FOREST : FOREST;
    if (humid > -0.15) return weird > 0.6 ? FLOWER_FOREST : PLAINS;
    return weird > 0.7 ? FLOWER_PLAINS : PLAINS;
  }
  // 炎热
  if (humid > 0.4) return JUNGLE;
  if (humid > -0.1) return SAVANNA;
  if (weird > 0.55) return BADLANDS;
  return DESERT;
}

export function biomeById(id) {
  return BIOMES[id] || PLAINS;
}

export { clamp, smoothstep };
