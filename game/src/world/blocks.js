// 方块注册表
// 面序：0=+X(东) 1=-X(西) 2=+Y(上) 3=-Y(下) 4=+Z(南) 5=-Z(北)

import { TEX_INDEX } from '../render/textures.js';

export const FACE_DIRS = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

/** 渲染类型 */
export const RT = {
  CUBE: 0,     // 普通立方体
  CROSS: 1,    // 十字草木
  LIQUID: 2,   // 液体
  TORCH: 3,    // 火把（细柱）
  SLAB: 4,     // 下半砖
  CACTUS: 5,   // 内缩立方体（仙人掌）
  LADDER: 6,   // 贴墙平面
  NONE: 7,     // 不渲染（空气）
};

/** 工具等级：0 徒手 1 木/金 2 石 3 铁 4 钻石 */
export const TIER = { NONE: 0, WOOD: 1, STONE: 2, IRON: 3, DIAMOND: 4 };

export const BLOCKS = [];
export const BLOCK_BY_NAME = new Map();

function tex(spec) {
  // 展开成 6 个面的贴图层号
  const layers = new Array(6);
  const pick = (k, fallback) => (spec[k] !== undefined ? spec[k] : fallback);
  const all = spec.all;
  const side = pick('side', all);
  layers[0] = TEX_INDEX[pick('east', side)];
  layers[1] = TEX_INDEX[pick('west', side)];
  layers[2] = TEX_INDEX[pick('top', all)];
  layers[3] = TEX_INDEX[pick('bottom', pick('top', all))];
  layers[4] = TEX_INDEX[pick('south', side)];
  layers[5] = TEX_INDEX[pick('north', side)];
  for (let i = 0; i < 6; i++) {
    if (layers[i] === undefined) throw new Error('缺少贴图：' + JSON.stringify(spec));
  }
  return layers;
}

let nextId = 1;
function block(name, opts) {
  const b = {
    id: opts.id !== undefined ? opts.id : nextId++,
    name,
    display: opts.display || name,
    render: opts.render !== undefined ? opts.render : RT.CUBE,
    texLayers: opts.tex ? tex(opts.tex) : [0, 0, 0, 0, 0, 0],
    solid: opts.solid !== undefined ? opts.solid : true,           // 是否有碰撞箱
    opaque: opts.opaque !== undefined ? opts.opaque : true,        // 是否完全遮挡光线与相邻面
    transparent: !!opts.transparent,                                // 是否走半透明渲染批次
    light: opts.light || 0,                                        // 自发光等级 0-15
    filter: opts.filter !== undefined ? opts.filter : (opts.opaque === false ? 0 : 15), // 光衰减
    hardness: opts.hardness !== undefined ? opts.hardness : 1,
    tool: opts.tool || null,                                       // 'pickaxe'|'axe'|'shovel'|'hoe'|'shears'
    tier: opts.tier || TIER.NONE,                                  // 需要的最低工具等级才有掉落
    drops: opts.drops !== undefined ? opts.drops : name,           // 掉落物（名字/数组/null/函数）
    tint: opts.tint || null,                                       // 'grass'|'foliage'|'water'
    tintFaces: opts.tintFaces || null,                             // 只有这些面染色（默认全部）
    overlay: opts.overlay ? { ...opts.overlay, layer: TEX_INDEX[opts.overlay.tex] } : null,
    interactive: !!opts.interactive,
    climbable: !!opts.climbable,
    damage: opts.damage || 0,
    dropsTable: opts.dropsTable || null,
    gravity: !!opts.gravity,
    liquid: !!opts.liquid,
    flammable: !!opts.flammable,
    needsSupport: !!opts.needsSupport,
    replaceable: !!opts.replaceable,                               // 可被直接覆盖（草、雪、水）
    fuel: opts.fuel || 0,                                          // 作为燃料的烧炼秒数
    slipperiness: opts.slipperiness || 0,
    boxes: opts.boxes || null,                                     // 自定义碰撞箱
    stack: opts.stack || 64,
  };
  BLOCKS[b.id] = b;
  BLOCK_BY_NAME.set(name, b);
  return b;
}

// ── 空气 ──
block('air', {
  id: 0, display: '空气', render: RT.NONE, solid: false, opaque: false, filter: 0,
  drops: null, replaceable: true, hardness: 0,
});

// ── 石质 ──
block('stone', { display: '石头', tex: { all: 'stone' }, hardness: 1.5, tool: 'pickaxe', tier: TIER.WOOD, drops: 'cobblestone' });
block('granite', { display: '花岗岩', tex: { all: 'granite' }, hardness: 1.5, tool: 'pickaxe', tier: TIER.WOOD });
block('diorite', { display: '闪长岩', tex: { all: 'diorite' }, hardness: 1.5, tool: 'pickaxe', tier: TIER.WOOD });
block('andesite', { display: '安山岩', tex: { all: 'andesite' }, hardness: 1.5, tool: 'pickaxe', tier: TIER.WOOD });
block('deepslate', { display: '深板岩', tex: { all: 'deepslate' }, hardness: 3, tool: 'pickaxe', tier: TIER.WOOD, drops: 'cobblestone' });
block('cobblestone', { display: '圆石', tex: { all: 'cobblestone' }, hardness: 2, tool: 'pickaxe', tier: TIER.WOOD });
block('mossy_cobblestone', { display: '苔石', tex: { all: 'mossy_cobblestone' }, hardness: 2, tool: 'pickaxe', tier: TIER.WOOD });
block('stone_bricks', { display: '石砖', tex: { all: 'stone_bricks' }, hardness: 1.5, tool: 'pickaxe', tier: TIER.WOOD });
block('mossy_stone_bricks', { display: '苔石砖', tex: { all: 'mossy_stone_bricks' }, hardness: 1.5, tool: 'pickaxe', tier: TIER.WOOD });
block('bricks', { display: '红砖块', tex: { all: 'bricks' }, hardness: 2, tool: 'pickaxe', tier: TIER.WOOD });
block('obsidian', { display: '黑曜石', tex: { all: 'obsidian' }, hardness: 50, tool: 'pickaxe', tier: TIER.DIAMOND });
block('bedrock', { display: '基岩', tex: { all: 'bedrock' }, hardness: -1, drops: null });

// ── 土壤 ──
block('dirt', { display: '泥土', tex: { all: 'dirt' }, hardness: 0.5, tool: 'shovel' });
block('coarse_dirt', { display: '砂土', tex: { all: 'coarse_dirt' }, hardness: 0.5, tool: 'shovel' });
block('grass_block', {
  display: '草方块', tex: { top: 'grass_top', bottom: 'dirt', side: 'grass_side' },
  hardness: 0.6, tool: 'shovel', drops: 'dirt', tint: 'grass',
  tintFaces: [2],                       // 只有顶面直接染色
  overlay: { tex: 'grass_side_overlay', faces: [0, 1, 4, 5], tint: 'grass' },
});
block('dirt_path', { display: '土径', tex: { top: 'dirt_path_top', bottom: 'dirt', side: 'dirt' }, hardness: 0.6, tool: 'shovel', drops: 'dirt' });
block('podzol', { display: '灰化土', tex: { top: 'podzol_top', bottom: 'dirt', side: 'podzol_side' }, hardness: 0.5, tool: 'shovel', drops: 'dirt' });
block('mycelium', { display: '菌丝', tex: { top: 'mycelium_top', bottom: 'dirt', side: 'mycelium_side' }, hardness: 0.6, tool: 'shovel', drops: 'dirt' });
block('farmland', { display: '耕地', tex: { top: 'farmland', bottom: 'dirt', side: 'dirt' }, hardness: 0.6, tool: 'shovel', drops: 'dirt' });
block('sand', { display: '沙子', tex: { all: 'sand' }, hardness: 0.5, tool: 'shovel', gravity: true });
block('red_sand', { display: '红沙', tex: { all: 'red_sand' }, hardness: 0.5, tool: 'shovel', gravity: true });
block('gravel', { display: '砂砾', tex: { all: 'gravel' }, hardness: 0.6, tool: 'shovel', gravity: true, drops: 'gravel' });
block('clay', { display: '黏土', tex: { all: 'clay' }, hardness: 0.6, tool: 'shovel', drops: ['clay_ball', 4] });
block('sandstone', { display: '砂岩', tex: { top: 'sandstone_top', bottom: 'sandstone_top', side: 'sandstone_side' }, hardness: 0.8, tool: 'pickaxe', tier: TIER.WOOD });
block('red_sandstone', { display: '红砂岩', tex: { top: 'red_sandstone_top', bottom: 'red_sandstone_top', side: 'red_sandstone_side' }, hardness: 0.8, tool: 'pickaxe', tier: TIER.WOOD });

// ── 矿石 ──
block('coal_ore', { display: '煤矿石', tex: { all: 'coal_ore' }, hardness: 3, tool: 'pickaxe', tier: TIER.WOOD, drops: 'coal' });
block('iron_ore', { display: '铁矿石', tex: { all: 'iron_ore' }, hardness: 3, tool: 'pickaxe', tier: TIER.STONE, drops: 'raw_iron' });
block('copper_ore', { display: '铜矿石', tex: { all: 'copper_ore' }, hardness: 3, tool: 'pickaxe', tier: TIER.STONE, drops: ['raw_copper', 3] });
block('gold_ore', { display: '金矿石', tex: { all: 'gold_ore' }, hardness: 3, tool: 'pickaxe', tier: TIER.IRON, drops: 'raw_gold' });
block('redstone_ore', { display: '红石矿石', tex: { all: 'redstone_ore' }, hardness: 3, tool: 'pickaxe', tier: TIER.IRON, drops: ['redstone', 5] });
block('lapis_ore', { display: '青金石矿石', tex: { all: 'lapis_ore' }, hardness: 3, tool: 'pickaxe', tier: TIER.STONE, drops: ['lapis_lazuli', 6] });
block('diamond_ore', { display: '钻石矿石', tex: { all: 'diamond_ore' }, hardness: 3, tool: 'pickaxe', tier: TIER.IRON, drops: 'diamond' });
block('emerald_ore', { display: '绿宝石矿石', tex: { all: 'emerald_ore' }, hardness: 3, tool: 'pickaxe', tier: TIER.IRON, drops: 'emerald' });

// ── 木头 ──
const WOOD_TYPES = ['oak', 'birch', 'spruce', 'jungle', 'acacia', 'dark_oak'];
const WOOD_CN = { oak: '橡木', birch: '白桦木', spruce: '云杉木', jungle: '丛林木', acacia: '金合欢木', dark_oak: '深色橡木' };
for (const w of WOOD_TYPES) {
  block(`${w}_log`, {
    display: `${WOOD_CN[w]}原木`,
    tex: { top: `${w}_log_top`, bottom: `${w}_log_top`, side: `${w}_log_side` },
    hardness: 2, tool: 'axe', flammable: true, fuel: 15,
  });
  block(`${w}_planks`, {
    display: `${WOOD_CN[w]}木板`, tex: { all: `${w}_planks` },
    hardness: 2, tool: 'axe', flammable: true, fuel: 15,
  });
  block(`${w}_leaves`, {
    display: `${WOOD_CN[w]}树叶`, tex: { all: `${w}_leaves` },
    hardness: 0.2, tool: 'shears', opaque: false, filter: 1, transparent: false,
    tint: w === 'spruce' || w === 'birch' ? null : 'foliage',
    drops: null, dropsTable: [{ item: `${w}_sapling`, chance: 0.06 }, { item: 'stick', chance: 0.05, count: 2 }],
    flammable: true,
  });
  block(`${w}_sapling`, {
    display: `${WOOD_CN[w]}树苗`, tex: { all: `${w}_sapling` }, render: RT.CROSS,
    solid: false, opaque: false, filter: 0, hardness: 0, needsSupport: true, replaceable: false, transparent: true,
  });
  block(`${w}_slab`, {
    display: `${WOOD_CN[w]}台阶`, tex: { all: `${w}_planks` }, render: RT.SLAB,
    hardness: 2, tool: 'axe', opaque: false, filter: 0, flammable: true,
    boxes: [[0, 0, 0, 1, 0.5, 1]],
  });
}
block('stone_slab', { display: '石头台阶', tex: { all: 'stone' }, render: RT.SLAB, hardness: 2, tool: 'pickaxe', tier: TIER.WOOD, opaque: false, filter: 0, boxes: [[0, 0, 0, 1, 0.5, 1]] });
block('cobblestone_slab', { display: '圆石台阶', tex: { all: 'cobblestone' }, render: RT.SLAB, hardness: 2, tool: 'pickaxe', tier: TIER.WOOD, opaque: false, filter: 0, boxes: [[0, 0, 0, 1, 0.5, 1]] });

// ── 液体 ──
block('water', {
  display: '水', tex: { all: 'water' }, render: RT.LIQUID, liquid: true, solid: false,
  opaque: false, filter: 2, transparent: true, tint: 'water', hardness: -1, drops: null, replaceable: true,
});
block('lava', {
  display: '岩浆', tex: { all: 'lava' }, render: RT.LIQUID, liquid: true, solid: false,
  opaque: false, filter: 0, light: 15, hardness: -1, drops: null, replaceable: true,
});

// ── 冰雪玻璃 ──
block('snow_block', { display: '雪块', tex: { all: 'snow' }, hardness: 0.2, tool: 'shovel', drops: ['snowball', 4] });
block('ice', { display: '冰', tex: { all: 'ice' }, hardness: 0.5, tool: 'pickaxe', opaque: false, filter: 3, transparent: true, drops: null, slipperiness: 0.98 });
block('packed_ice', { display: '浮冰', tex: { all: 'packed_ice' }, hardness: 0.5, tool: 'pickaxe', drops: null, slipperiness: 0.98 });
block('glass', { display: '玻璃', tex: { all: 'glass' }, hardness: 0.3, opaque: false, filter: 0, transparent: true, drops: null });

// ── 光源与装饰 ──
block('torch', {
  display: '火把', tex: { all: 'torch' }, render: RT.TORCH, solid: false, opaque: false,
  filter: 0, light: 14, hardness: 0, needsSupport: true, transparent: true,
});
block('glowstone', { display: '萤石', tex: { all: 'glowstone' }, hardness: 0.3, light: 15 });
block('sea_lantern', { display: '海晶灯', tex: { all: 'sea_lantern' }, hardness: 0.3, light: 15 });
block('bookshelf', { display: '书架', tex: { top: 'oak_planks', bottom: 'oak_planks', side: 'bookshelf' }, hardness: 1.5, tool: 'axe', drops: ['book', 3], flammable: true, fuel: 15 });
block('crafting_table', {
  display: '工作台',
  tex: { top: 'crafting_table_top', bottom: 'oak_planks', side: 'crafting_table_side', north: 'crafting_table_front', south: 'crafting_table_front' },
  hardness: 2.5, tool: 'axe', flammable: true, fuel: 15, interactive: true,
});
block('furnace', {
  display: '熔炉',
  tex: { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side', north: 'furnace_front', south: 'furnace_side' },
  hardness: 3.5, tool: 'pickaxe', tier: TIER.WOOD,
});
block('furnace_lit', {
  display: '熔炉', tex: { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side', north: 'furnace_front_lit', south: 'furnace_side' },
  hardness: 3.5, tool: 'pickaxe', tier: TIER.WOOD, light: 13, drops: 'furnace',
});
block('chest', {
  display: '箱子',
  tex: { top: 'chest_top', bottom: 'chest_top', side: 'chest_side', north: 'chest_front', south: 'chest_side' },
  hardness: 2.5, tool: 'axe', flammable: true, fuel: 15, opaque: false, filter: 0,
});
block('tnt', { display: 'TNT', tex: { top: 'tnt_top', bottom: 'tnt_bottom', side: 'tnt_side' }, hardness: 0 });
block('sponge', { display: '海绵', tex: { all: 'sponge' }, hardness: 0.6 });
block('hay_block', { display: '干草捆', tex: { top: 'hay_top', bottom: 'hay_top', side: 'hay_side' }, hardness: 0.5, flammable: true, fuel: 12 });
block('ladder', {
  display: '梯子', tex: { all: 'ladder' }, render: RT.LADDER, solid: false, opaque: false,
  filter: 0, hardness: 0.4, tool: 'axe', needsSupport: true, transparent: true, climbable: true,
});

// ── 矿物方块 ──
block('iron_block', { display: '铁块', tex: { all: 'iron_block' }, hardness: 5, tool: 'pickaxe', tier: TIER.STONE });
block('gold_block', { display: '金块', tex: { all: 'gold_block' }, hardness: 3, tool: 'pickaxe', tier: TIER.IRON });
block('copper_block', { display: '铜块', tex: { all: 'copper_block' }, hardness: 3, tool: 'pickaxe', tier: TIER.STONE });
block('diamond_block', { display: '钻石块', tex: { all: 'diamond_block' }, hardness: 5, tool: 'pickaxe', tier: TIER.IRON });
block('emerald_block', { display: '绿宝石块', tex: { all: 'emerald_block' }, hardness: 5, tool: 'pickaxe', tier: TIER.IRON });
block('lapis_block', { display: '青金石块', tex: { all: 'lapis_block' }, hardness: 3, tool: 'pickaxe', tier: TIER.STONE });
block('redstone_block', { display: '红石块', tex: { all: 'redstone_block' }, hardness: 5, tool: 'pickaxe', tier: TIER.STONE });
block('coal_block', { display: '煤炭块', tex: { all: 'coal_block' }, hardness: 5, tool: 'pickaxe', tier: TIER.WOOD, fuel: 80 });

// ── 羊毛（16 色）──
const WOOL_CN = {
  white: '白色', orange: '橙色', magenta: '品红色', light_blue: '淡蓝色', yellow: '黄色',
  lime: '黄绿色', pink: '粉红色', gray: '灰色', light_gray: '淡灰色', cyan: '青色',
  purple: '紫色', blue: '蓝色', brown: '棕色', green: '绿色', red: '红色', black: '黑色',
};
for (const [c, cn] of Object.entries(WOOL_CN)) {
  block(`${c}_wool`, { display: `${cn}羊毛`, tex: { all: `${c}_wool` }, hardness: 0.8, tool: 'shears', flammable: true });
}

// ── 陶瓦 ──
const TERRA_CN = {
  terracotta: '陶瓦', white_terracotta: '白色陶瓦', orange_terracotta: '橙色陶瓦',
  yellow_terracotta: '黄色陶瓦', red_terracotta: '红色陶瓦', brown_terracotta: '棕色陶瓦',
  light_gray_terracotta: '淡灰色陶瓦',
};
for (const [n, cn] of Object.entries(TERRA_CN)) {
  block(n, { display: cn, tex: { all: n }, hardness: 1.25, tool: 'pickaxe', tier: TIER.WOOD });
}

// ── 植物 ──
const plantOpts = {
  render: RT.CROSS, solid: false, opaque: false, filter: 0, hardness: 0,
  needsSupport: true, transparent: true, flammable: true,
};
block('tall_grass', { ...plantOpts, display: '草', tex: { all: 'tall_grass' }, tint: 'grass', replaceable: true, drops: null, dropsTable: [{ item: 'wheat_seeds', chance: 0.125 }] });
block('fern', { ...plantOpts, display: '蕨', tex: { all: 'fern' }, tint: 'grass', replaceable: true, drops: null, dropsTable: [{ item: 'wheat_seeds', chance: 0.125 }] });
block('dead_bush', { ...plantOpts, display: '枯萎的灌木', tex: { all: 'dead_bush' }, replaceable: true, drops: null, dropsTable: [{ item: 'stick', chance: 0.5, count: 2 }] });
block('dandelion', { ...plantOpts, display: '蒲公英', tex: { all: 'dandelion' } });
block('poppy', { ...plantOpts, display: '虞美人', tex: { all: 'poppy' } });
block('blue_orchid', { ...plantOpts, display: '兰花', tex: { all: 'blue_orchid' } });
block('allium', { ...plantOpts, display: '绒球葱', tex: { all: 'allium' } });
block('cornflower', { ...plantOpts, display: '矢车菊', tex: { all: 'cornflower' } });
block('oxeye_daisy', { ...plantOpts, display: '滨菊', tex: { all: 'oxeye_daisy' } });
block('brown_mushroom', { ...plantOpts, display: '棕色蘑菇', tex: { all: 'brown_mushroom' }, light: 1, flammable: false });
block('red_mushroom', { ...plantOpts, display: '红色蘑菇', tex: { all: 'red_mushroom' }, flammable: false });
block('sugar_cane', { ...plantOpts, display: '甘蔗', tex: { all: 'sugar_cane' }, drops: 'sugar_cane' });
block('wheat', { ...plantOpts, display: '小麦', tex: { all: 'wheat' }, drops: null, dropsTable: [{ item: 'wheat', chance: 1 }, { item: 'wheat_seeds', chance: 0.8, count: 2 }] });
block('cactus', {
  display: '仙人掌', tex: { top: 'cactus_top', bottom: 'cactus_top', side: 'cactus_side' },
  render: RT.CACTUS, hardness: 0.4, opaque: false, filter: 0, damage: 1,
  boxes: [[0.0625, 0, 0.0625, 0.9375, 1, 0.9375]],
});
block('pumpkin', { display: '南瓜', tex: { top: 'pumpkin_top', bottom: 'pumpkin_top', side: 'pumpkin_side', north: 'pumpkin_face' }, hardness: 1, tool: 'axe' });
block('melon', { display: '西瓜', tex: { top: 'melon_top', bottom: 'melon_top', side: 'melon_side' }, hardness: 1, tool: 'axe', drops: null, dropsTable: [{ item: 'melon_slice', chance: 1, count: 5 }] });

export const AIR = 0;
export const B = (name) => BLOCK_BY_NAME.get(name).id;

/** 常用 id 快查表 */
export const ID = {};
for (const b of BLOCKS) if (b) ID[b.name] = b.id;

export function getBlock(id) {
  return BLOCKS[id] || BLOCKS[0];
}

/** 该方块被破坏时掉落什么（考虑工具） */
export function blockDrops(id, toolTier, toolType, rand) {
  const b = getBlock(id);
  if (b.tier > 0 && toolTier < b.tier) return [];
  if (b.name.endsWith('_leaves') && toolType === 'shears') return [{ item: b.name, count: 1 }];
  if (b.name === 'tall_grass' || b.name === 'fern') {
    if (toolType === 'shears') return [{ item: b.name, count: 1 }];
  }
  if (b.dropsTable) {
    const out = [];
    for (const d of b.dropsTable) {
      if (rand() < d.chance) out.push({ item: d.item, count: d.count || 1 });
    }
    return out;
  }
  if (b.drops === null) return [];
  if (Array.isArray(b.drops)) return [{ item: b.drops[0], count: b.drops[1] }];
  return [{ item: b.drops, count: 1 }];
}

/** 光线是否被该方块完全阻挡 */
export function isOpaque(id) {
  return BLOCKS[id] ? BLOCKS[id].opaque : false;
}

/** 相邻面剔除判断：from 面朝向 to 时是否需要绘制 */
export function shouldRenderFace(fromId, toId) {
  const a = getBlock(fromId);
  const b = getBlock(toId);
  if (b.id === 0) return true;
  if (b.render === RT.NONE) return true;
  if (a.liquid && b.liquid) return false;
  if (b.opaque && b.render === RT.CUBE) return false;
  if (a.id === b.id && (a.render === RT.CUBE) && !a.opaque) return false; // 玻璃/树叶同类不画内面
  return true;
}

/** 该方块的碰撞箱列表（单位方块局部坐标） */
export function collisionBoxes(id) {
  const b = getBlock(id);
  if (!b.solid) return null;
  if (b.boxes) return b.boxes;
  return FULL_BOX;
}
const FULL_BOX = [[0, 0, 0, 1, 1, 1]];

export const MAX_BLOCK_ID = BLOCKS.length;
