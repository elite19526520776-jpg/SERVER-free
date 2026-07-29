// 物品注册表：所有方块自动成为物品，另外再注册工具、食物、材料、盔甲。

import { BLOCKS, TIER } from './blocks.js';

export const ITEMS = new Map();

function item(name, opts = {}) {
  const it = {
    name,
    display: opts.display || name,
    stack: opts.stack !== undefined ? opts.stack : 64,
    block: opts.block || null,     // 可放置的方块名
    tool: opts.tool || null,       // { type, tier, speed, damage, durability }
    food: opts.food || null,       // { hunger, saturation, effect }
    armor: opts.armor || null,     // { slot, defense, durability }
    fuel: opts.fuel || 0,          // 作为燃料可烧多少秒
    icon: opts.icon || null,       // 图标绘制描述
    projectile: opts.projectile || null,
    placeAs: opts.placeAs || null,
  };
  ITEMS.set(name, it);
  return it;
}

// 所有方块 → 物品
for (const b of BLOCKS) {
  if (!b || b.id === 0) continue;
  if (b.name === 'furnace_lit') continue;
  item(b.name, {
    display: b.display,
    block: b.name,
    fuel: b.fuel,
    icon: { kind: 'block', block: b.name },
  });
}

// ── 材料 ──
const M = (name, display, color, opts = {}) =>
  item(name, { display, icon: { kind: opts.shape || 'nugget', color, ...opts.icon }, ...opts });

M('stick', '木棍', 0x8a6636, { shape: 'stick', fuel: 5 });
M('coal', '煤炭', 0x1a1a1a, { shape: 'lump', fuel: 80 });
M('charcoal', '木炭', 0x2a2420, { shape: 'lump', fuel: 80 });
M('raw_iron', '粗铁', 0xd8a882, { shape: 'lump' });
M('raw_gold', '粗金', 0xfcdc5f, { shape: 'lump' });
M('raw_copper', '粗铜', 0xd07b4a, { shape: 'lump' });
M('iron_ingot', '铁锭', 0xd8d8d8, { shape: 'ingot' });
M('gold_ingot', '金锭', 0xf9d94a, { shape: 'ingot' });
M('copper_ingot', '铜锭', 0xc3703f, { shape: 'ingot' });
M('diamond', '钻石', 0x62e6de, { shape: 'gem' });
M('emerald', '绿宝石', 0x2fd05a, { shape: 'gem' });
M('lapis_lazuli', '青金石', 0x2350c8, { shape: 'gem' });
M('redstone', '红石粉', 0xd11a1a, { shape: 'dust' });
M('gunpowder', '火药', 0x9a9a9a, { shape: 'dust' });
M('sugar', '糖', 0xf2f2f2, { shape: 'dust' });
M('flint', '燧石', 0x3a3a3a, { shape: 'shard' });
M('clay_ball', '黏土球', 0xa4a8b8, { shape: 'ball' });
M('brick', '红砖', 0x96513a, { shape: 'ingot' });
M('string', '线', 0xe8e8e8, { shape: 'string' });
M('feather', '羽毛', 0xf0f0f0, { shape: 'feather' });
M('bone', '骨头', 0xe8e4d8, { shape: 'bone' });
M('leather', '皮革', 0x9a6a3a, { shape: 'sheet' });
M('paper', '纸', 0xf4f4f0, { shape: 'sheet' });
M('book', '书', 0x8a5a2a, { shape: 'book' });
M('wheat', '小麦', 0xd8bf4a, { shape: 'wheat' });
M('wheat_seeds', '小麦种子', 0x8fb84a, { shape: 'seeds', placeAs: 'wheat' });
M('snowball', '雪球', 0xf0f6ff, { shape: 'ball', stack: 16 });
M('bowl', '碗', 0x8a5a2a, { shape: 'bowl' });
M('bucket', '桶', 0xc8c8c8, { shape: 'bucket', stack: 16 });
M('water_bucket', '水桶', 0x2f7ec4, { shape: 'bucket', stack: 1 });
M('lava_bucket', '岩浆桶', 0xe04a05, { shape: 'bucket', stack: 1, fuel: 1000 });
M('milk_bucket', '牛奶桶', 0xffffff, { shape: 'bucket', stack: 1 });
M('arrow', '箭', 0xb0b0b0, { shape: 'arrow' });
M('rotten_flesh', '腐肉', 0x8a5a3a, { shape: 'meat', food: { hunger: 4, saturation: 0.8, poison: true } });

// ── 食物 ──
const F = (name, display, color, hunger, sat, shape = 'meat') =>
  item(name, { display, food: { hunger, saturation: sat }, icon: { kind: shape, color }, stack: 64 });

F('apple', '苹果', 0xd0342c, 4, 2.4, 'apple');
F('bread', '面包', 0xc89a4a, 5, 6, 'bread');
F('melon_slice', '西瓜片', 0xd44a3a, 2, 1.2, 'melon');
F('cookie', '曲奇', 0xa06a3a, 2, 0.4, 'cookie');
F('pumpkin_pie', '南瓜派', 0xd4941b, 8, 4.8, 'pie');
F('raw_porkchop', '生猪排', 0xf0a0a0, 3, 1.8);
F('cooked_porkchop', '熟猪排', 0xc07a3a, 8, 12.8);
F('raw_beef', '生牛肉', 0xd05a5a, 3, 1.8);
F('steak', '牛排', 0x8a4a24, 8, 12.8);
F('raw_mutton', '生羊肉', 0xe08a8a, 2, 1.2);
F('cooked_mutton', '熟羊肉', 0xa8642c, 6, 9.6);
F('raw_chicken', '生鸡肉', 0xe8b0a0, 2, 1.2, 'meat');
F('cooked_chicken', '熟鸡肉', 0xc08a3a, 6, 7.2, 'meat');
item('mushroom_stew', '蘑菇煲', {
  display: '蘑菇煲', stack: 1, food: { hunger: 6, saturation: 7.2, container: 'bowl' },
  icon: { kind: 'stew', color: 0xa06a3a },
});

// ── 工具 ──
export const TOOL_MATERIALS = {
  wooden: { tier: TIER.WOOD, speed: 2, dur: 59, dmg: 0, color: 0xba8f56, cn: '木' },
  stone: { tier: TIER.STONE, speed: 4, dur: 131, dmg: 1, color: 0x7f7f7f, cn: '石' },
  iron: { tier: TIER.IRON, speed: 6, dur: 250, dmg: 2, color: 0xd8d8d8, cn: '铁' },
  golden: { tier: TIER.WOOD, speed: 12, dur: 32, dmg: 0, color: 0xf9d94a, cn: '金' },
  diamond: { tier: TIER.DIAMOND, speed: 8, dur: 1561, dmg: 3, color: 0x62e6de, cn: '钻石' },
};
const TOOL_KINDS = {
  sword: { cn: '剑', dmg: 4, shape: 'sword' },
  pickaxe: { cn: '镐', dmg: 2, shape: 'pickaxe' },
  axe: { cn: '斧', dmg: 3, shape: 'axe' },
  shovel: { cn: '锹', dmg: 1, shape: 'shovel' },
  hoe: { cn: '锄', dmg: 1, shape: 'hoe' },
};
for (const [mat, mp] of Object.entries(TOOL_MATERIALS)) {
  for (const [kind, kp] of Object.entries(TOOL_KINDS)) {
    item(`${mat}_${kind}`, {
      display: `${mp.cn}${kp.cn}`,
      stack: 1,
      fuel: mat === 'wooden' ? 10 : 0,
      tool: {
        type: kind, tier: mp.tier, speed: mp.speed,
        damage: kp.dmg + mp.dmg, durability: mp.dur,
      },
      icon: { kind: 'tool', shape: kp.shape, color: mp.color, handle: 0x8a6636 },
    });
  }
}
item('shears', {
  display: '剪刀', stack: 1,
  tool: { type: 'shears', tier: TIER.NONE, speed: 5, damage: 1, durability: 238 },
  icon: { kind: 'tool', shape: 'shears', color: 0xd8d8d8, handle: 0x9a9a9a },
});
item('bow', {
  display: '弓', stack: 1,
  tool: { type: 'bow', tier: TIER.NONE, speed: 1, damage: 1, durability: 384 },
  projectile: 'arrow',
  icon: { kind: 'tool', shape: 'bow', color: 0x8a6636, handle: 0xe8e8e8 },
});
item('flint_and_steel', {
  display: '打火石', stack: 1,
  tool: { type: 'igniter', tier: TIER.NONE, speed: 1, damage: 1, durability: 64 },
  icon: { kind: 'tool', shape: 'flint_steel', color: 0xd8d8d8, handle: 0x3a3a3a },
});

// ── 盔甲 ──
const ARMOR_MATERIALS = {
  leather: { color: 0x9a6a3a, cn: '皮革', def: [1, 3, 2, 1], dur: 80 },
  golden: { color: 0xf9d94a, cn: '金', def: [2, 5, 3, 1], dur: 112 },
  iron: { color: 0xd8d8d8, cn: '铁', def: [2, 6, 5, 2], dur: 240 },
  diamond: { color: 0x62e6de, cn: '钻石', def: [3, 8, 6, 3], dur: 528 },
};
const ARMOR_SLOTS = [
  { key: 'helmet', cn: '头盔', slot: 0 },
  { key: 'chestplate', cn: '胸甲', slot: 1 },
  { key: 'leggings', cn: '护腿', slot: 2 },
  { key: 'boots', cn: '靴子', slot: 3 },
];
for (const [mat, mp] of Object.entries(ARMOR_MATERIALS)) {
  ARMOR_SLOTS.forEach((s, i) => {
    item(`${mat}_${s.key}`, {
      display: `${mp.cn}${s.cn}`,
      stack: 1,
      armor: { slot: s.slot, defense: mp.def[i], durability: Math.round(mp.dur * [1.375, 2, 1.875, 1.625][i]) },
      icon: { kind: 'armor', shape: s.key, color: mp.color },
    });
  });
}

export function getItem(name) {
  return ITEMS.get(name) || null;
}

export const ITEM_NAMES = [...ITEMS.keys()];
