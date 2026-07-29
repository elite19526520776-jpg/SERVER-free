// 合成与烧炼配方

import { ITEMS } from './items.js';

const WOODS = ['oak', 'birch', 'spruce', 'jungle', 'acacia', 'dark_oak'];

/** 材料标签：一个符号可以匹配多种物品 */
export const TAGS = {
  planks: WOODS.map((w) => `${w}_planks`),
  logs: WOODS.map((w) => `${w}_log`),
  wool: ['white_wool', 'orange_wool', 'magenta_wool', 'light_blue_wool', 'yellow_wool', 'lime_wool',
    'pink_wool', 'gray_wool', 'light_gray_wool', 'cyan_wool', 'purple_wool', 'blue_wool',
    'brown_wool', 'green_wool', 'red_wool', 'black_wool'],
  coals: ['coal', 'charcoal'],
  mushrooms: ['brown_mushroom', 'red_mushroom'],
  stone_like: ['stone', 'granite', 'diorite', 'andesite', 'deepslate'],
};

export const RECIPES = [];

function expand(x) {
  if (Array.isArray(x)) return x;
  if (typeof x === 'string' && x.startsWith('#')) return TAGS[x.slice(1)];
  return [x];
}

export function shaped(pattern, key, result, count = 1) {
  const rows = pattern.length;
  const cols = Math.max(...pattern.map((r) => r.length));
  const grid = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const ch = pattern[y][x] || ' ';
      grid.push(ch === ' ' ? null : expand(key[ch]));
    }
  }
  RECIPES.push({ type: 'shaped', w: cols, h: rows, grid, result, count });
}

export function shapeless(ingredients, result, count = 1) {
  RECIPES.push({ type: 'shapeless', items: ingredients.map(expand), result, count });
}

// ── 基础 ──
for (const w of WOODS) {
  shapeless([`${w}_log`], `${w}_planks`, 4);
  shaped(['XXX', 'XXX'], { X: `${w}_planks` }, `${w}_slab`, 6);
}
shaped(['X', 'X'], { X: '#planks' }, 'stick', 4);
shaped(['XX', 'XX'], { X: '#planks' }, 'crafting_table', 1);
shaped(['XXX', 'X X', 'XXX'], { X: 'cobblestone' }, 'furnace', 1);
shaped(['XXX', 'X X', 'XXX'], { X: '#planks' }, 'chest', 1);
shaped(['C', 'S'], { C: '#coals', S: 'stick' }, 'torch', 4);
shaped(['XXX', 'XXX'], { X: 'stone' }, 'stone_slab', 6);
shaped(['XXX', 'XXX'], { X: 'cobblestone' }, 'cobblestone_slab', 6);
shaped(['XX', 'XX'], { X: 'stone' }, 'stone_bricks', 4);
shaped(['XX', 'XX'], { X: 'sand' }, 'sandstone', 1);
shaped(['XX', 'XX'], { X: 'red_sand' }, 'red_sandstone', 1);
shaped(['XX', 'XX'], { X: 'brick' }, 'bricks', 1);
shaped(['X X', 'XXX', 'X X'], { X: 'stick' }, 'ladder', 3);
shaped(['XX', 'XX'], { X: 'snowball' }, 'snow_block', 1);
shaped(['GS', 'SG'], { G: 'gunpowder', S: 'sand' }, 'tnt', 1);
shaped(['XXX', 'XXX', 'XXX'], { X: 'wheat' }, 'hay_block', 1);
shaped(['XX', 'XX'], { X: 'string' }, 'white_wool', 1);
shapeless(['sugar_cane'], 'sugar', 1);
shaped(['XXX'], { X: 'sugar_cane' }, 'paper', 3);
shapeless(['paper', 'paper', 'paper', 'leather'], 'book', 1);
shaped(['XXX', 'BBB', 'XXX'], { X: '#planks', B: 'book' }, 'bookshelf', 1);
shaped(['X X', ' X '], { X: '#planks' }, 'bowl', 4);
shaped(['X X', ' X '], { X: 'iron_ingot' }, 'bucket', 1);
shaped(['XXX'], { X: 'wheat' }, 'bread', 1);
shapeless(['wheat', 'wheat', 'sugar'], 'cookie', 8);
shapeless(['pumpkin', 'sugar', 'wheat'], 'pumpkin_pie', 1);
shapeless(['bowl', '#mushrooms', '#mushrooms'], 'mushroom_stew', 1);
shaped(['F', 'S', 'E'], { F: 'flint', S: 'stick', E: 'feather' }, 'arrow', 4);
shapeless(['iron_ingot', 'flint'], 'flint_and_steel', 1);
shaped([' XS', 'X S', ' XS'], { X: 'stick', S: 'string' }, 'bow', 1);
shaped([' X', 'X '], { X: 'iron_ingot' }, 'shears', 1);
shaped(['XXX', 'XXX', 'XXX'], { X: 'melon_slice' }, 'melon', 1);

// 矿物方块 ⇄ 材料
const COMPACT = [
  ['iron_ingot', 'iron_block'], ['gold_ingot', 'gold_block'], ['copper_ingot', 'copper_block'],
  ['diamond', 'diamond_block'], ['emerald', 'emerald_block'], ['lapis_lazuli', 'lapis_block'],
  ['redstone', 'redstone_block'], ['coal', 'coal_block'],
];
for (const [mat, blk] of COMPACT) {
  shaped(['XXX', 'XXX', 'XXX'], { X: mat }, blk, 1);
  shapeless([blk], mat, 9);
}

// ── 工具与盔甲 ──
const TOOL_MATS = {
  wooden: '#planks', stone: 'cobblestone', iron: 'iron_ingot',
  golden: 'gold_ingot', diamond: 'diamond',
};
for (const [mat, ing] of Object.entries(TOOL_MATS)) {
  shaped(['X', 'X', 'S'], { X: ing, S: 'stick' }, `${mat}_sword`, 1);
  shaped(['XXX', ' S ', ' S '], { X: ing, S: 'stick' }, `${mat}_pickaxe`, 1);
  shaped(['XX', 'XS', ' S'], { X: ing, S: 'stick' }, `${mat}_axe`, 1);
  shaped(['X', 'S', 'S'], { X: ing, S: 'stick' }, `${mat}_shovel`, 1);
  shaped(['XX', ' S', ' S'], { X: ing, S: 'stick' }, `${mat}_hoe`, 1);
}
const ARMOR_MATS = { leather: 'leather', golden: 'gold_ingot', iron: 'iron_ingot', diamond: 'diamond' };
for (const [mat, ing] of Object.entries(ARMOR_MATS)) {
  shaped(['XXX', 'X X'], { X: ing }, `${mat}_helmet`, 1);
  shaped(['X X', 'XXX', 'XXX'], { X: ing }, `${mat}_chestplate`, 1);
  shaped(['XXX', 'X X', 'X X'], { X: ing }, `${mat}_leggings`, 1);
  shaped(['X X', 'X X'], { X: ing }, `${mat}_boots`, 1);
}

// ── 烧炼 ──
export const SMELTING = new Map();
function smelt(input, output, count = 1) {
  for (const i of expand(input)) SMELTING.set(i, { result: output, count });
}
smelt('#logs', 'charcoal');
smelt('cobblestone', 'stone');
smelt('deepslate', 'stone');
smelt('sand', 'glass');
smelt('red_sand', 'glass');
smelt('clay_ball', 'brick');
smelt('clay', 'terracotta');
smelt('raw_iron', 'iron_ingot');
smelt('iron_ore', 'iron_ingot');
smelt('raw_gold', 'gold_ingot');
smelt('gold_ore', 'gold_ingot');
smelt('raw_copper', 'copper_ingot');
smelt('copper_ore', 'copper_ingot');
smelt('coal_ore', 'coal');
smelt('diamond_ore', 'diamond');
smelt('emerald_ore', 'emerald');
smelt('lapis_ore', 'lapis_lazuli');
smelt('redstone_ore', 'redstone');
smelt('raw_porkchop', 'cooked_porkchop');
smelt('raw_beef', 'steak');
smelt('raw_mutton', 'cooked_mutton');
smelt('raw_chicken', 'cooked_chicken');
smelt('stone_bricks', 'stone_bricks');
smelt('cactus', 'green_wool');

/** 物品作为燃料能烧多少秒（0 表示不能） */
export function fuelValue(name) {
  const it = ITEMS.get(name);
  return it ? it.fuel : 0;
}

/**
 * 在 w×h 的合成网格里匹配配方。
 * grid: 数组，元素为 {item,count} 或 null，长度 w*h。
 * 返回 { result, count } 或 null。
 */
export function matchRecipe(grid, w, h) {
  const names = grid.map((s) => (s && s.count > 0 ? s.item : null));
  // 计算非空包围盒
  let minX = w, minY = h, maxX = -1, maxY = -1, filled = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (names[y * w + x]) {
        filled++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (filled === 0) return null;
  const bw = maxX - minX + 1, bh = maxY - minY + 1;

  for (const r of RECIPES) {
    if (r.type === 'shaped') {
      if (r.w !== bw || r.h !== bh) continue;
      let ok = true;
      let used = 0;
      for (let y = 0; y < r.h && ok; y++) {
        for (let x = 0; x < r.w; x++) {
          const need = r.grid[y * r.w + x];
          const have = names[(y + minY) * w + (x + minX)];
          if (need === null) {
            if (have !== null) { ok = false; break; }
          } else {
            if (have === null || !need.includes(have)) { ok = false; break; }
            used++;
          }
        }
      }
      if (ok && used === filled) return { result: r.result, count: r.count };
    } else {
      const pool = names.filter(Boolean);
      if (pool.length !== r.items.length) continue;
      const rest = [...pool];
      let ok = true;
      for (const need of r.items) {
        const i = rest.findIndex((n) => need.includes(n));
        if (i < 0) { ok = false; break; }
        rest.splice(i, 1);
      }
      if (ok) return { result: r.result, count: r.count };
    }
  }
  return null;
}
