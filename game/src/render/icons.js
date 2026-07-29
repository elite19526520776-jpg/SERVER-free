// 物品图标：方块画成等距立方体，其余物品用程序化矢量绘制

import { layerToCanvas, TEX_SIZE } from './textures.js';
import { BLOCK_BY_NAME, RT } from '../world/blocks.js';
import { ITEMS } from '../world/items.js';

const SZ = 64;

const DEFAULT_TINT = {
  grass: '#79c05a',
  foliage: '#59ae30',
  water: '#3f76e4',
};

function newCanvas(size = SZ) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

/** 用仿射变换把方形贴图贴到平行四边形上 */
function drawFace(ctx, tex, o, u, v, brightness, tint) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(o[0], o[1]);
  ctx.lineTo(o[0] + u[0], o[1] + u[1]);
  ctx.lineTo(o[0] + u[0] + v[0], o[1] + u[1] + v[1]);
  ctx.lineTo(o[0] + v[0], o[1] + v[1]);
  ctx.closePath();
  ctx.clip();
  ctx.setTransform(u[0] / TEX_SIZE, u[1] / TEX_SIZE, v[0] / TEX_SIZE, v[1] / TEX_SIZE, o[0], o[1]);
  ctx.drawImage(tex, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (tint) {
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, SZ, SZ);
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.fillStyle = brightness > 0 ? `rgba(255,255,255,${brightness})` : `rgba(0,0,0,${-brightness})`;
  ctx.fillRect(0, 0, SZ, SZ);
  ctx.restore();
}

function blockIcon(block, texLayer) {
  const c = newCanvas();
  const ctx = c.getContext('2d');
  const tint = block.tint ? DEFAULT_TINT[block.tint] : null;

  if (block.render === RT.CROSS || block.render === RT.LADDER || block.render === RT.TORCH) {
    const tex = texLayer(block.texLayers[0]);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(tex, 2, 2, SZ - 4, SZ - 4);
    if (tint) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = tint;
      ctx.fillRect(0, 0, SZ, SZ);
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(tex, 2, 2, SZ - 4, SZ - 4);
      ctx.globalCompositeOperation = 'source-over';
    }
    return c;
  }

  const half = block.render === RT.SLAB;
  const yTop = half ? 20 : 4;
  const bodyH = half ? 12 : 24;
  const T = [32, yTop], L = [4, yTop + 16], R = [60, yTop + 16], Bm = [32, yTop + 32];
  // 顶面
  drawFace(ctx, texLayer(block.texLayers[2]), L, [T[0] - L[0], T[1] - L[1]], [Bm[0] - L[0], Bm[1] - L[1]], 0.1, tint && block.tintFaces !== null ? tint : tint);
  // 左面（-X）
  drawFace(ctx, texLayer(block.texLayers[1]), L, [Bm[0] - L[0], Bm[1] - L[1]], [0, bodyH], -0.22,
    block.overlay ? null : (block.tintFaces ? null : tint));
  // 右面（+Z）
  drawFace(ctx, texLayer(block.texLayers[4]), Bm, [R[0] - Bm[0], R[1] - Bm[1]], [0, bodyH], -0.05,
    block.overlay ? null : (block.tintFaces ? null : tint));
  // 草方块侧面的染色覆盖层
  if (block.overlay) {
    const ov = texLayer(block.overlay.layer);
    const oTint = DEFAULT_TINT[block.overlay.tint];
    drawFace(ctx, ov, L, [Bm[0] - L[0], Bm[1] - L[1]], [0, bodyH], -0.22, oTint);
    drawFace(ctx, ov, Bm, [R[0] - Bm[0], R[1] - Bm[1]], [0, bodyH], -0.05, oTint);
  }
  return c;
}

// ── 物品矢量绘制 ───────────────────────────────────────────
function hexOf(n) {
  return '#' + n.toString(16).padStart(6, '0');
}
function shade(n, f) {
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
  const b = Math.min(255, Math.round((n & 255) * f));
  return `rgb(${r},${g},${b})`;
}

function poly(ctx, pts, fill, stroke) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
}

function drawHandle(ctx, color) {
  ctx.strokeStyle = shade(color, 0.75);
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(16, 52);
  ctx.lineTo(42, 22);
  ctx.stroke();
  ctx.strokeStyle = shade(color, 1.12);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(17, 50);
  ctx.lineTo(41, 23);
  ctx.stroke();
}

function itemIcon(icon) {
  const c = newCanvas();
  const ctx = c.getContext('2d');
  const col = icon.color || 0xffffff;
  const main = hexOf(col);
  const dark = shade(col, 0.62);
  const light = shade(col, 1.28);

  const kind = icon.kind;
  switch (kind) {
    case 'tool': {
      drawHandle(ctx, icon.handle || 0x8a6636);
      const s = icon.shape;
      if (s === 'pickaxe') {
        poly(ctx, [[14, 20], [32, 10], [50, 20], [46, 26], [32, 19], [18, 26]], main, dark);
      } else if (s === 'axe') {
        poly(ctx, [[38, 10], [52, 16], [52, 34], [38, 30], [34, 20]], main, dark);
      } else if (s === 'shovel') {
        poly(ctx, [[36, 10], [50, 14], [50, 28], [38, 30], [32, 20]], main, dark);
      } else if (s === 'hoe') {
        poly(ctx, [[34, 12], [54, 12], [54, 20], [42, 20], [40, 26]], main, dark);
      } else if (s === 'sword') {
        ctx.strokeStyle = shade(0x8a6636, 0.8);
        ctx.lineWidth = 6;
        ctx.beginPath(); ctx.moveTo(14, 52); ctx.lineTo(22, 44); ctx.stroke();
        poly(ctx, [[14, 44], [30, 28], [26, 24], [42, 24], [42, 40], [38, 36], [22, 52]], main, dark);
        poly(ctx, [[22, 40], [38, 24], [40, 26], [24, 42]], light, null);
      } else if (s === 'shears') {
        poly(ctx, [[16, 48], [34, 24], [40, 28], [22, 52]], main, dark);
        poly(ctx, [[24, 48], [42, 24], [48, 28], [30, 52]], light, dark);
      } else if (s === 'bow') {
        ctx.strokeStyle = shade(0x8a6636, 0.9);
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(22, 32, 22, -Math.PI / 2.4, Math.PI / 2.4);
        ctx.stroke();
        ctx.strokeStyle = '#eee';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(30, 10); ctx.lineTo(30, 54); ctx.stroke();
      } else if (s === 'flint_steel') {
        poly(ctx, [[16, 40], [34, 30], [42, 40], [24, 50]], main, dark);
        poly(ctx, [[34, 16], [48, 20], [44, 32], [32, 28]], shade(0x3a3a3a, 1), '#222');
      }
      break;
    }
    case 'armor': {
      const s = icon.shape;
      if (s === 'helmet') poly(ctx, [[16, 40], [16, 22], [32, 12], [48, 22], [48, 40], [40, 40], [40, 30], [24, 30], [24, 40]], main, dark);
      else if (s === 'chestplate') poly(ctx, [[14, 18], [24, 14], [40, 14], [50, 18], [46, 30], [46, 52], [18, 52], [18, 30]], main, dark);
      else if (s === 'leggings') poly(ctx, [[18, 14], [46, 14], [46, 52], [36, 52], [32, 30], [28, 52], [18, 52]], main, dark);
      else poly(ctx, [[18, 30], [46, 30], [46, 46], [50, 52], [16, 52], [18, 44]], main, dark);
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = light;
      ctx.fillRect(20, 18, 6, 28);
      ctx.globalAlpha = 1;
      break;
    }
    case 'stick':
      ctx.strokeStyle = dark; ctx.lineWidth = 8; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(18, 48); ctx.lineTo(46, 18); ctx.stroke();
      ctx.strokeStyle = light; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(20, 46); ctx.lineTo(44, 20); ctx.stroke();
      break;
    case 'lump':
      poly(ctx, [[18, 26], [30, 16], [46, 22], [50, 40], [36, 50], [20, 44]], main, dark);
      poly(ctx, [[24, 28], [32, 22], [40, 28], [34, 36]], light, null);
      break;
    case 'ingot':
      poly(ctx, [[14, 40], [22, 26], [48, 26], [54, 40], [14, 40]], main, dark);
      poly(ctx, [[20, 30], [46, 30], [48, 34], [18, 34]], light, null);
      break;
    case 'gem':
      poly(ctx, [[32, 10], [50, 26], [32, 54], [14, 26]], main, dark);
      poly(ctx, [[32, 14], [44, 26], [32, 32], [20, 26]], light, null);
      break;
    case 'dust':
      for (let i = 0; i < 22; i++) {
        const a = (i / 22) * Math.PI * 2;
        const r = 8 + (i % 4) * 5;
        ctx.fillStyle = i % 3 ? main : light;
        ctx.fillRect(32 + Math.cos(a) * r - 2, 34 + Math.sin(a) * r - 2, 5, 5);
      }
      break;
    case 'ball':
      ctx.fillStyle = main;
      ctx.beginPath(); ctx.arc(32, 34, 18, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = light;
      ctx.beginPath(); ctx.arc(26, 28, 7, 0, Math.PI * 2); ctx.fill();
      break;
    case 'shard':
      poly(ctx, [[20, 44], [26, 20], [44, 28], [40, 48]], main, dark);
      break;
    case 'sheet':
      poly(ctx, [[14, 16], [50, 16], [50, 48], [14, 48]], main, dark);
      poly(ctx, [[18, 20], [46, 20], [46, 26], [18, 26]], light, null);
      break;
    case 'book':
      poly(ctx, [[14, 14], [46, 14], [46, 50], [14, 50]], main, dark);
      poly(ctx, [[46, 14], [52, 18], [52, 50], [46, 50]], shade(col, 0.75), null);
      poly(ctx, [[18, 18], [42, 18], [42, 46], [18, 46]], '#f2ead6', null);
      break;
    case 'string':
      ctx.strokeStyle = main; ctx.lineWidth = 4;
      ctx.beginPath();
      for (let i = 0; i <= 40; i++) ctx.lineTo(14 + i, 34 + Math.sin(i * 0.5) * 12);
      ctx.stroke();
      break;
    case 'feather':
      ctx.strokeStyle = shade(0xcccccc, 0.7); ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(20, 52); ctx.lineTo(44, 14); ctx.stroke();
      ctx.fillStyle = main;
      ctx.beginPath();
      ctx.ellipse(33, 30, 9, 20, -Math.PI / 5, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'bone':
      ctx.strokeStyle = main; ctx.lineWidth = 9; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(20, 46); ctx.lineTo(44, 22); ctx.stroke();
      ctx.fillStyle = light;
      for (const [x, y] of [[16, 44], [22, 50], [42, 18], [48, 24]]) {
        ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
      }
      break;
    case 'wheat':
      ctx.strokeStyle = shade(col, 0.8); ctx.lineWidth = 3;
      for (const dx of [-8, 0, 8]) {
        ctx.beginPath(); ctx.moveTo(32 + dx, 54); ctx.lineTo(32 + dx * 0.6, 16); ctx.stroke();
        ctx.fillStyle = main;
        for (let i = 0; i < 5; i++) {
          ctx.fillRect(30 + dx * 0.7 - 3, 18 + i * 6, 7, 5);
        }
      }
      break;
    case 'seeds':
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        ctx.fillStyle = i % 2 ? main : light;
        ctx.beginPath();
        ctx.ellipse(32 + Math.cos(a) * 12, 34 + Math.sin(a) * 12, 5, 3, a, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'bowl':
      poly(ctx, [[12, 30], [52, 30], [44, 50], [20, 50]], main, dark);
      poly(ctx, [[12, 30], [52, 30], [50, 35], [14, 35]], light, null);
      break;
    case 'bucket':
      poly(ctx, [[16, 22], [48, 22], [42, 52], [22, 52]], icon.color === 0xc8c8c8 ? '#b8b8b8' : main, '#777');
      if (icon.color !== 0xc8c8c8) {
        poly(ctx, [[18, 26], [46, 26], [44, 34], [20, 34]], light, null);
      }
      ctx.strokeStyle = '#999'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(32, 22, 15, Math.PI, 0); ctx.stroke();
      break;
    case 'arrow':
      ctx.strokeStyle = '#9a7a4a'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(16, 50); ctx.lineTo(46, 20); ctx.stroke();
      poly(ctx, [[44, 12], [54, 14], [52, 24]], '#d8d8d8', '#888');
      poly(ctx, [[12, 44], [22, 54], [12, 56], [10, 46]], '#e8e8e8', '#aaa');
      break;
    case 'meat':
      ctx.fillStyle = main;
      ctx.beginPath(); ctx.ellipse(32, 36, 20, 15, 0.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = shade(col, 0.75);
      ctx.beginPath(); ctx.ellipse(32, 36, 12, 8, 0.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f0efe6';
      ctx.beginPath(); ctx.ellipse(48, 26, 7, 5, 0.4, 0, Math.PI * 2); ctx.fill();
      break;
    case 'apple':
      ctx.fillStyle = main;
      ctx.beginPath(); ctx.arc(32, 36, 18, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = light;
      ctx.beginPath(); ctx.ellipse(25, 28, 6, 8, -0.4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#6b4a22'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(32, 20); ctx.lineTo(34, 12); ctx.stroke();
      ctx.fillStyle = '#4a9a2a';
      ctx.beginPath(); ctx.ellipse(41, 13, 7, 4, -0.5, 0, Math.PI * 2); ctx.fill();
      break;
    case 'bread':
      ctx.fillStyle = main;
      ctx.beginPath(); ctx.ellipse(32, 36, 22, 13, -0.15, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = shade(col, 0.7); ctx.lineWidth = 3;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath(); ctx.moveTo(26 + i * 10, 28); ctx.lineTo(30 + i * 10, 42); ctx.stroke();
      }
      break;
    case 'melon':
      poly(ctx, [[12, 46], [52, 46], [32, 16]], '#d8402c', '#2f6b1f');
      ctx.fillStyle = '#3f8a24';
      ctx.fillRect(12, 44, 40, 6);
      ctx.fillStyle = '#1f1f1f';
      for (const [x, y] of [[26, 38], [36, 38], [31, 30]]) ctx.fillRect(x, y, 3, 4);
      break;
    case 'cookie':
      ctx.fillStyle = main;
      ctx.beginPath(); ctx.arc(32, 34, 18, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#4a2c14';
      for (const [x, y] of [[26, 28], [38, 30], [30, 40], [40, 40]]) {
        ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();
      }
      break;
    case 'pie':
      ctx.fillStyle = shade(0xc8a058, 1);
      ctx.beginPath(); ctx.arc(32, 36, 20, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = main;
      ctx.beginPath(); ctx.arc(32, 34, 15, 0, Math.PI * 2); ctx.fill();
      break;
    case 'stew':
      poly(ctx, [[12, 30], [52, 30], [44, 52], [20, 52]], '#8a5a2a', '#5a3a18');
      ctx.fillStyle = main;
      ctx.beginPath(); ctx.ellipse(32, 32, 19, 5, 0, 0, Math.PI * 2); ctx.fill();
      break;
    default:
      poly(ctx, [[20, 22], [44, 22], [44, 46], [20, 46]], main, dark);
      break;
  }
  return c;
}

/**
 * 生成全部物品图标，并打包成一张图集（供 3D 掉落物使用）
 * 返回 { icons: Map(name→canvas), atlas: canvas, index: Map(name→i), cols }
 */
export function buildIcons(textureData) {
  const layerCache = new Map();
  const texLayer = (layer) => {
    let c = layerCache.get(layer);
    if (!c) {
      c = layerToCanvas(textureData.albedo, layer);
      layerCache.set(layer, c);
    }
    return c;
  };

  const icons = new Map();
  for (const [name, it] of ITEMS) {
    let canvas;
    if (it.block) {
      const b = BLOCK_BY_NAME.get(it.block);
      canvas = b ? blockIcon(b, texLayer) : newCanvas();
    } else {
      canvas = itemIcon(it.icon || { kind: 'default', color: 0xcccccc });
    }
    icons.set(name, canvas);
  }

  const cols = 16;
  const rows = Math.ceil(icons.size / cols);
  const atlas = newCanvas();
  atlas.width = cols * SZ;
  atlas.height = Math.max(cols, rows) * SZ;
  const actx = atlas.getContext('2d');
  const index = new Map();
  let i = 0;
  for (const [name, canvas] of icons) {
    const x = (i % cols) * SZ;
    const y = Math.floor(i / cols) * SZ;
    actx.drawImage(canvas, x, y);
    index.set(name, i);
    i++;
  }
  // 图集必须是正方形，行数按列数补齐，保证 UV 计算简单
  return { icons, atlas, index, cols, rowsUsed: rows };
}
