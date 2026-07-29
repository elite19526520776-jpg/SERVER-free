// 游戏主循环：输入、交互、区块网格调度、渲染、存档

import { Renderer } from './render/renderer.js';
import { EntityRenderer, MODELS } from './render/entities.js';
import { buildIcons } from './render/icons.js';
import { buildChunkMesh } from './render/mesher.js';
import * as m4 from './util/mat4.js';
import { World, chunkKey } from './world/world.js';
import { CHUNK_X, CHUNK_Y, CHUNK_Z, SEA_LEVEL } from './world/chunk.js';
import { ID, BLOCKS, BLOCK_BY_NAME, getBlock, blockDrops, collisionBoxes, RT, TIER } from './world/blocks.js';
import { getItem } from './world/items.js';
import { Inventory, makeStack } from './world/inventory.js';
import { SMELTING, fuelValue } from './world/recipes.js';
import { Player } from './entity/player.js';
import { Entities, Arrow, MOB_TYPES } from './entity/mobs.js';
import { UI } from './ui/ui.js';
import { Sound, soundMaterial } from './ui/sound.js';
import { Rand } from './util/noise.js';

const SAVE_KEY = 'voxelcraft.save.v1';

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.renderer = new Renderer(this.canvas);
    this.sound = new Sound();
    this.input = {
      forward: 0, strafe: 0, jump: false, sneak: false, sprint: false,
      mining: false, using: false,
    };
    this.keys = new Set();
    this.paused = false;
    this.renderDistance = 10;
    this.lastTime = performance.now();
    this.meshQueue = [];
    this.activeFurnaces = new Map();
    this.tickAccum = 0;
    this.frameTimes = [];
    this.pickTimer = 0;
    this.lastPlaceTime = 0;
    this.rand = new Rand(12345);
  }

  async boot(status) {
    status('正在编译着色器…');
    this.renderer.init();
    this.renderer.renderDistance = this.renderDistance;

    status('正在生成物品图标…');
    await frame();
    const iconData = buildIcons(this.renderer.textureData);
    this.iconData = iconData;

    status('正在准备实体…');
    this.entityRenderer = new EntityRenderer(this.renderer);
    this.entityRenderer.init(iconData.atlas);
    this.atlasCols = iconData.cols;

    status('正在生成世界…');
    await frame();
    const save = this.loadSave();
    this.world = new World(save ? save.seed : (Math.random() * 1e9) | 0);
    this.world.onChunkDirty = (c) => this.queueMesh(c);
    this.player = new Player(this.world);
    this.entities = new Entities(this.world);
    this.entities.onPickup = () => this.sound.play('pickup');

    this.ui = new UI(this, iconData.icons);

    if (save) this.applySave(save);
    else this.spawnPlayer();

    // 预加载出生点周围
    status('正在加载区块…');
    for (let i = 0; i < 3; i++) {
      this.world.genBudget = 64;
      this.world.update(this.player.x, this.player.z, 3);
      await frame();
    }
    this.world.genBudget = 2;
    this.buildInitialMeshes();

    this.bindInput();
    this.ui.refresh();
    this.ui.showToast('按 F1 查看操作说明', 4000);
    requestAnimationFrame(() => this.loop());
  }

  spawnPlayer() {
    const w = this.world;
    // 螺旋向外搜索一块高于海平面的陆地
    let x = 0, z = 0, found = false;
    for (let ring = 0; ring < 120 && !found; ring++) {
      const r = ring * 24;
      const samples = ring === 0 ? 1 : Math.min(48, 6 + ring * 3);
      for (let i = 0; i < samples; i++) {
        const a = (i / samples) * Math.PI * 2 + ring * 0.7;
        const tx = Math.round(Math.cos(a) * r);
        const tz = Math.round(Math.sin(a) * r);
        const h = w.gen.heightAt(tx, tz);
        if (h > SEA_LEVEL + 2 && h < SEA_LEVEL + 40) {
          const b = w.gen.biomeAt(tx, tz);
          if (b.name !== 'ocean' && b.name !== 'deep_ocean' && b.name !== 'river') {
            x = tx; z = tz; found = true;
            break;
          }
        }
      }
    }
    for (let cx = -2; cx <= 2; cx++) {
      for (let cz = -2; cz <= 2; cz++) w.ensureChunk((x >> 4) + cx, (z >> 4) + cz);
    }
    this.player.x = x + 0.5;
    this.player.z = z + 0.5;
    this.player.y = w.surfaceY(x, z) + 0.5;
    this.player.spawnPoint = { x: this.player.x, z: this.player.z };
    this.player.give('wooden_pickaxe', 1);
    this.player.give('wooden_axe', 1);
    this.player.give('torch', 16);
    this.player.give('bread', 4);
  }

  buildInitialMeshes() {
    for (const c of this.world.chunks.values()) {
      if (c.lit) this.queueMesh(c);
    }
    this.processMeshQueue(200);
  }

  queueMesh(chunk) {
    if (!chunk.queued) {
      chunk.queued = true;
      this.meshQueue.push(chunk);
    }
  }

  processMeshQueue(budget = 3) {
    const w = this.world;
    let done = 0;
    // 优先处理离玩家近的
    if (this.meshQueue.length > 6) {
      const px = this.player.x, pz = this.player.z;
      this.meshQueue.sort((a, b) => {
        const da = (a.cx * 16 - px) ** 2 + (a.cz * 16 - pz) ** 2;
        const db = (b.cx * 16 - px) ** 2 + (b.cz * 16 - pz) ** 2;
        return da - db;
      });
    }
    while (this.meshQueue.length && done < budget) {
      const c = this.meshQueue.shift();
      c.queued = false;
      if (!w.chunks.has(chunkKey(c.cx, c.cz))) continue;
      if (!c.lit) { continue; }
      const mesh = buildChunkMesh(w, c);
      this.renderer.uploadChunk(c, mesh);
      c.dirty = false;
      done++;
    }
  }

  // ── 输入 ──
  bindInput() {
    const canvas = this.canvas;
    canvas.addEventListener('click', () => {
      if (!this.ui.screen && !this.player.dead) {
        canvas.requestPointerLock();
        this.sound.resume();
      }
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      document.body.classList.toggle('locked', this.locked);
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      const s = 0.0022;
      this.player.yaw -= e.movementX * s;
      this.player.pitch -= e.movementY * s;
      const lim = Math.PI / 2 - 0.001;
      this.player.pitch = Math.max(-lim, Math.min(lim, this.player.pitch));
    });
    document.addEventListener('mousedown', (e) => {
      if (this.ui.screen || !this.locked) return;
      if (e.button === 0) { this.input.mining = true; this.onAttack(); }
      if (e.button === 2) { this.input.using = true; this.onUse(); }
      if (e.button === 1) { this.pickBlock(); e.preventDefault(); }
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) { this.input.mining = false; this.player.mining = null; }
      if (e.button === 2) this.input.using = false;
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('wheel', (e) => {
      if (this.ui.screen) return;
      const d = Math.sign(e.deltaY);
      this.player.hotbar = (this.player.hotbar + d + 9) % 9;
      this.onHotbarChange();
    }, { passive: true });

    document.addEventListener('keydown', (e) => this.onKey(e, true));
    document.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('beforeunload', () => this.save());
  }

  onKey(e, down) {
    const code = e.code;
    if (down) this.keys.add(code); else this.keys.delete(code);
    const p = this.player;

    if (down) {
      if (code === 'Escape') {
        if (this.ui.screen) { this.ui.close(); }
        return;
      }
      if (code.startsWith('Digit')) {
        const n = parseInt(code.slice(5), 10);
        if (n >= 1 && n <= 9) { p.hotbar = n - 1; this.onHotbarChange(); }
      }
      if (this.ui.screen) {
        if (code === 'KeyE') this.ui.close();
        return;
      }
      switch (code) {
        case 'KeyE': this.ui.open('inventory'); break;
        case 'F3': this.ui.toggleDebug(); e.preventDefault(); break;
        case 'F1': this.showHelp(); e.preventDefault(); break;
        case 'F5': this.thirdPerson = !this.thirdPerson; e.preventDefault(); break;
        case 'KeyQ': this.dropHeld(e.shiftKey); break;
        case 'KeyF': this.toggleGamemode(); break;
        case 'KeyG': if (p.gamemode === 'creative') this.ui.open('creative'); break;
        case 'KeyT': this.cycleTime(); break;
        case 'KeyR': this.save(); this.ui.showToast('已保存到本地'); break;
        case 'Minus':
        case 'NumpadSubtract':
          this.setRenderDistance(this.renderDistance - 1); break;
        case 'Equal':
        case 'NumpadAdd':
          this.setRenderDistance(this.renderDistance + 1); break;
        default: break;
      }
      if (code === 'Space' && p.gamemode === 'creative') {
        const now = performance.now();
        if (this.lastSpace && now - this.lastSpace < 300) {
          p.flying = !p.flying;
          p.vy = 0;
          this.ui.showToast(p.flying ? '飞行：开' : '飞行：关');
        }
        this.lastSpace = now;
      }
    }

    this.input.forward = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    this.input.strafe = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    this.input.jump = this.keys.has('Space');
    this.input.sneak = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    this.input.sprint = this.keys.has('ControlLeft') || this.keys.has('KeyR') === false && this.keys.has('ShiftLeft') === false && this.keys.has('ControlLeft');
    this.input.sprint = this.keys.has('ControlLeft') || this.keys.has('ControlRight');
  }

  setRenderDistance(d) {
    this.renderDistance = Math.max(3, Math.min(16, d));
    this.renderer.renderDistance = this.renderDistance;
    this.ui.showToast(`视距：${this.renderDistance} 区块`);
  }

  onHotbarChange() {
    const s = this.player.heldItem;
    if (s) {
      const d = getItem(s.item);
      this.ui.setItemName(d ? d.display : s.item);
    } else this.ui.setItemName('');
    this.ui.refresh();
  }

  toggleGamemode() {
    const p = this.player;
    p.gamemode = p.gamemode === 'survival' ? 'creative' : 'survival';
    if (p.gamemode === 'survival') p.flying = false;
    this.ui.showToast(`游戏模式：${p.gamemode === 'creative' ? '创造' : '生存'}`);
    this.ui.refresh();
  }

  cycleTime() {
    const t = this.world.time;
    this.world.time = t > 3000 && t < 15000 ? 18000 : 6000;
    this.ui.showToast(this.world.isDay() ? '时间：白天' : '时间：夜晚');
  }

  showHelp() {
    this.ui.showToast(
      'WASD 移动 · 空格跳跃 · Shift 潜行 · Ctrl 疾跑 · 左键挖掘/攻击 · 右键放置/使用 · ' +
      'E 背包 · Q 丢弃 · 1-9 快捷栏 · F 切换生存/创造 · G 创造物品栏 · T 昼夜 · ' +
      '+/- 视距 · F3 调试 · F5 视角 · R 保存',
      9000,
    );
  }

  // ── 交互 ──
  targetBlock(maxDist = 5) {
    const p = this.player;
    const dir = this.lookDir();
    return this.world.raycast(p.x, p.eyeY, p.z, dir[0], dir[1], dir[2], maxDist);
  }

  lookDir() {
    const p = this.player;
    const cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
    return [-Math.sin(p.yaw) * cp, sp, -Math.cos(p.yaw) * cp];
  }

  /** 视线内最近的生物 */
  targetMob(maxDist = 4) {
    const p = this.player;
    const [dx, dy, dz] = this.lookDir();
    let best = null, bestT = maxDist;
    for (const m of this.entities.mobs) {
      if (m.dead) continue;
      const [x0, y0, z0, x1, y1, z1] = m.aabb();
      const t = rayAABB(p.x, p.eyeY, p.z, dx, dy, dz, x0, y0, z0, x1, y1, z1);
      if (t !== null && t < bestT) { bestT = t; best = m; }
    }
    return best;
  }

  onAttack() {
    const p = this.player;
    p.swingTime = 1;
    const mob = this.targetMob(3.6);
    const hit = this.targetBlock();
    if (mob && (!hit || hit.dist > 3.4)) {
      const item = p.heldItem ? getItem(p.heldItem.item) : null;
      const dmg = item && item.tool ? item.tool.damage : 1;
      const dx = mob.x - p.x, dz = mob.z - p.z;
      const l = Math.hypot(dx, dz) || 1;
      mob.hurt(dmg, this.world, this.entities, [dx / l * 5, dz / l * 5]);
      if (item && item.tool) p.damageTool(1);
      p.exhaustion += 0.1;
      this.sound.play('mobhurt');
      return;
    }
  }

  onUse() {
    const p = this.player;
    p.swingTime = 1;
    const held = p.heldItem;
    const def = held ? getItem(held.item) : null;

    // 弓
    if (def && def.projectile) {
      if (p.gamemode === 'creative' || p.inventory.count('arrow') > 0) {
        if (p.gamemode !== 'creative') p.inventory.remove('arrow', 1);
        const a = new Arrow(p.x, p.eyeY - 0.1, p.z);
        const d = this.lookDir();
        const sp = 42;
        a.vx = d[0] * sp; a.vy = d[1] * sp; a.vz = d[2] * sp;
        a.owner = 'player';
        this.entities.arrows.push(a);
        p.damageTool(1);
        this.sound.play('bow');
      }
      return;
    }

    const hit = this.targetBlock();

    // 与方块交互
    if (hit && !p.sneaking) {
      const b = getBlock(hit.id);
      if (b.name === 'crafting_table') { this.ui.open('crafting_table'); this.sound.play('door'); return; }
      if (b.name === 'furnace' || b.name === 'furnace_lit') { this.openFurnace(hit.x, hit.y, hit.z); return; }
      if (b.name === 'chest') { this.openChest(hit.x, hit.y, hit.z); return; }
      if (b.name === 'tnt' && def && def.tool && def.tool.type === 'igniter') {
        this.world.setBlock(hit.x, hit.y, hit.z, 0);
        setTimeout(() => this.entities.explode(this.world, hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, 4, p), 1500);
        this.sound.play('fuse');
        p.damageTool(1);
        return;
      }
    }

    if (!held) return;

    // 食物
    if (def && def.food) {
      if (p.eat()) { this.sound.play('eat'); this.ui.refresh(); }
      return;
    }
    // 水桶
    if (held.item === 'bucket') {
      const liquidHit = this.world.raycast(p.x, p.eyeY, p.z, ...this.lookDir(), 5, true);
      if (liquidHit && (liquidHit.id === ID.water || liquidHit.id === ID.lava)) {
        if (this.world.getMeta(liquidHit.x, liquidHit.y, liquidHit.z) === 0) {
          this.world.setBlock(liquidHit.x, liquidHit.y, liquidHit.z, 0);
          held.count--;
          if (held.count <= 0) p.inventory.set(p.hotbar, null);
          p.give(liquidHit.id === ID.water ? 'water_bucket' : 'lava_bucket', 1);
          this.sound.play('splash');
          this.ui.refresh();
        }
      }
      return;
    }
    if (held.item === 'water_bucket' || held.item === 'lava_bucket') {
      if (!hit) return;
      const [px, py, pz] = [hit.x + hit.face[0], hit.y + hit.face[1], hit.z + hit.face[2]];
      this.world.setBlock(px, py, pz, held.item === 'water_bucket' ? ID.water : ID.lava, { meta: 0 });
      this.world.scheduleFluid(px, py, pz, 2);
      if (p.gamemode !== 'creative') {
        p.inventory.set(p.hotbar, makeStack('bucket', 1));
      }
      this.sound.play('splash');
      this.ui.refresh();
      return;
    }
    // 锄头
    if (def && def.tool && def.tool.type === 'hoe' && hit) {
      const b = getBlock(hit.id);
      if ((b.name === 'grass_block' || b.name === 'dirt' || b.name === 'coarse_dirt') &&
          this.world.getBlock(hit.x, hit.y + 1, hit.z) === 0) {
        this.world.setBlock(hit.x, hit.y, hit.z, ID.farmland);
        p.damageTool(1);
        this.sound.play('dig', 'dirt');
        return;
      }
    }
    // 种子
    if (def && def.placeAs && hit) {
      const ground = getBlock(hit.id);
      if (ground.name === 'farmland' && this.world.getBlock(hit.x, hit.y + 1, hit.z) === 0) {
        this.world.setBlock(hit.x, hit.y + 1, hit.z, ID[def.placeAs]);
        if (p.gamemode !== 'creative') {
          held.count--;
          if (held.count <= 0) p.inventory.set(p.hotbar, null);
        }
        this.sound.play('place');
        this.ui.refresh();
        return;
      }
    }
    // 放置方块
    if (def && def.block && hit) {
      this.placeBlock(hit, def.block);
    }
  }

  placeBlock(hit, blockName) {
    const p = this.player;
    const now = performance.now();
    if (now - this.lastPlaceTime < 160) return;
    const b = BLOCK_BY_NAME.get(blockName);
    if (!b) return;
    const target = getBlock(hit.id);
    let x = hit.x, y = hit.y, z = hit.z;
    if (!target.replaceable) {
      x += hit.face[0]; y += hit.face[1]; z += hit.face[2];
    }
    if (y < 0 || y >= CHUNK_Y) return;
    const existing = getBlock(this.world.getBlock(x, y, z));
    if (!existing.replaceable && existing.id !== 0) return;

    // 不能卡在玩家身体里
    const boxes = collisionBoxes(b.id);
    if (boxes) {
      const pb = p.aabb();
      for (const [bx, by, bz, bX, bY, bZ] of boxes) {
        if (pb[3] > x + bx && pb[0] < x + bX &&
            pb[4] > y + by && pb[1] < y + bY &&
            pb[5] > z + bz && pb[2] < z + bZ) return;
      }
    }
    // 需要支撑
    if (b.needsSupport) {
      const below = getBlock(this.world.getBlock(x, y - 1, z));
      const wallOk = b.render === RT.LADDER || b.render === RT.TORCH;
      if (!below.solid && !wallOk) return;
      if (b.render === RT.LADDER) {
        const face = faceIndexOf(hit.face);
        if (face === 2 || face === 3) return;
        this.world.setBlock(x, y, z, b.id, { meta: face });
        this.finishPlace(b);
        return;
      }
      if (b.render === RT.TORCH && !below.solid) {
        // 火把要贴在实心方块上
        const support = getBlock(this.world.getBlock(hit.x, hit.y, hit.z));
        if (!support.solid) return;
      }
    }

    this.world.setBlock(x, y, z, b.id);
    if (b.name === 'furnace' || b.name === 'chest') {
      this.world.getTileEntity(x, y, z, () => this.newTile(b.name));
      if (b.name === 'furnace') this.activeFurnaces.set(`${x},${y},${z}`, { x, y, z });
    }
    this.finishPlace(b);
  }

  finishPlace(b) {
    const p = this.player;
    this.lastPlaceTime = performance.now();
    if (p.gamemode !== 'creative') {
      const held = p.heldItem;
      if (held) {
        held.count--;
        if (held.count <= 0) p.inventory.set(p.hotbar, null);
      }
    }
    this.sound.play('place', soundMaterial(b.name));
    this.ui.refresh();
  }

  newTile(kind) {
    if (kind === 'furnace') {
      return { type: 'furnace', items: [null, null, null], burn: 0, burnTotal: 0, cook: 0 };
    }
    return { type: 'chest', items: new Array(27).fill(null) };
  }

  openChest(x, y, z) {
    const te = this.world.getTileEntity(x, y, z, () => this.newTile('chest'));
    const inv = new Inventory(27);
    inv.load(te.items);
    this.openTile = { te, inv, x, y, z };
    this.ui.open('chest', { inv });
    this.sound.play('door');
  }

  openFurnace(x, y, z) {
    const te = this.world.getTileEntity(x, y, z, () => this.newTile('furnace'));
    const inv = new Inventory(3);
    inv.load(te.items);
    this.openTile = { te, inv, x, y, z };
    this.activeFurnaces.set(`${x},${y},${z}`, { x, y, z });
    this.ui.open('furnace', { inv, tile: te });
    this.sound.play('door');
  }

  syncOpenTile() {
    if (!this.openTile) return;
    this.openTile.te.items = this.openTile.inv.serialize();
  }

  pickBlock() {
    const hit = this.targetBlock();
    if (!hit) return;
    const b = getBlock(hit.id);
    const name = b.name === 'furnace_lit' ? 'furnace' : b.name;
    const p = this.player;
    for (let i = 0; i < 9; i++) {
      const s = p.inventory.get(i);
      if (s && s.item === name) { p.hotbar = i; this.onHotbarChange(); return; }
    }
    if (p.gamemode === 'creative') {
      p.inventory.set(p.hotbar, makeStack(name, 1));
      this.onHotbarChange();
    }
  }

  dropHeld(all) {
    const p = this.player;
    const s = p.heldItem;
    if (!s) return;
    const n = all ? s.count : 1;
    this.dropItem(s.item, n);
    s.count -= n;
    if (s.count <= 0) p.inventory.set(p.hotbar, null);
    this.ui.refresh();
  }

  dropItem(item, count) {
    const p = this.player;
    const d = this.lookDir();
    this.entities.spawnItem(p.x + d[0] * 0.6, p.eyeY - 0.3, p.z + d[2] * 0.6, item, count);
    const it = this.entities.items[this.entities.items.length - 1];
    if (it) {
      it.vx = d[0] * 6; it.vy = d[1] * 6 + 1.5; it.vz = d[2] * 6;
      it.pickupDelay = 1;
    }
  }

  // ── 挖掘 ──
  updateMining(dt) {
    const p = this.player;
    if (!this.input.mining || this.ui.screen || p.dead) { p.mining = null; return; }
    const hit = this.targetBlock();
    if (!hit) { p.mining = null; return; }
    const mob = this.targetMob(3.6);
    if (mob && hit.dist > 3.4) { p.mining = null; return; }

    if (!p.mining || p.mining.x !== hit.x || p.mining.y !== hit.y || p.mining.z !== hit.z) {
      p.mining = { x: hit.x, y: hit.y, z: hit.z, progress: 0, total: p.breakTime(hit.id), id: hit.id };
    }
    const b = getBlock(hit.id);
    if (p.mining.total === Infinity) return;
    p.mining.progress += dt;
    p.swingTime = Math.max(p.swingTime, 0.4);

    this.digSoundTimer = (this.digSoundTimer || 0) - dt;
    if (this.digSoundTimer <= 0) {
      this.digSoundTimer = 0.22;
      this.sound.play('dig', soundMaterial(b.name));
    }

    if (p.mining.progress >= p.mining.total) {
      this.breakBlock(hit.x, hit.y, hit.z, hit.id);
      p.mining = null;
    }
  }

  breakBlock(x, y, z, id) {
    const p = this.player;
    const b = getBlock(id);
    if (p.gamemode !== 'creative') {
      const drops = blockDrops(id, p.toolTier, p.toolType, () => this.rand.next());
      for (const d of drops) {
        this.entities.spawnItem(x + 0.5, y + 0.5, z + 0.5, d.item, d.count);
      }
      if (b.tool && p.toolType) p.damageTool(1);
      p.exhaustion += 0.005;
    }
    if (b.name === 'furnace' || b.name === 'furnace_lit' || b.name === 'chest') {
      const te = this.world.getTileEntity(x, y, z);
      if (te && te.items) {
        for (const s of te.items) {
          if (s) this.entities.spawnItem(x + 0.5, y + 0.7, z + 0.5, s[0], s[1]);
        }
      }
      this.activeFurnaces.delete(`${x},${y},${z}`);
    }
    this.world.setBlock(x, y, z, 0);
    this.sound.play('break', soundMaterial(b.name));
    this.entities.addParticles(x + 0.5, y + 0.5, z + 0.5, 6);
    // 上方的重力方块要塌
    for (let dy = 1; dy < 6; dy++) {
      const above = this.world.getBlock(x, y + dy, z);
      if (above === 0) break;
      if (getBlock(above).gravity) this.world.tickGravity(x, y + dy, z);
      else break;
    }
    this.ui.refresh();
  }

  // ── 熔炉 ──
  tickFurnaces(dt) {
    for (const [key, pos] of this.activeFurnaces) {
      const chunk = this.world.chunkAt(pos.x, pos.z);
      if (!chunk) { this.activeFurnaces.delete(key); continue; }
      const te = this.world.getTileEntity(pos.x, pos.y, pos.z);
      if (!te || te.type !== 'furnace') { this.activeFurnaces.delete(key); continue; }

      const open = this.openTile && this.openTile.te === te;
      const inv = open ? this.openTile.inv : (() => {
        const i = new Inventory(3);
        i.load(te.items);
        return i;
      })();

      const input = inv.get(0);
      const fuel = inv.get(1);
      const out = inv.get(2);
      const recipe = input ? SMELTING.get(input.item) : null;
      const canOutput = recipe && (!out || (out.item === recipe.result && out.count < 64));

      if (te.burn > 0) te.burn -= dt;
      if (te.burn <= 0 && canOutput && fuel) {
        const fv = fuelValue(fuel.item);
        if (fv > 0) {
          te.burn = fv / 10;
          te.burnTotal = te.burn;
          fuel.count--;
          const container = fuel.item === 'lava_bucket' ? 'bucket' : null;
          if (fuel.count <= 0) inv.set(1, container ? makeStack(container, 1) : null);
        }
      }
      if (te.burn > 0 && canOutput) {
        te.cook += dt;
        if (te.cook >= 10) {
          te.cook = 0;
          if (out) out.count += recipe.count;
          else inv.set(2, makeStack(recipe.result, recipe.count));
          input.count--;
          if (input.count <= 0) inv.set(0, null);
        }
      } else {
        te.cook = Math.max(0, te.cook - dt * 2);
      }
      if (!open) te.items = inv.serialize();

      // 亮/灭状态切换
      const cur = this.world.getBlock(pos.x, pos.y, pos.z);
      const want = te.burn > 0 ? ID.furnace_lit : ID.furnace;
      if (cur === ID.furnace || cur === ID.furnace_lit) {
        if (cur !== want) this.world.setBlock(pos.x, pos.y, pos.z, want, { noSupport: true });
      }
      if (te.burn <= 0 && !canOutput && !open) this.activeFurnaces.delete(key);
    }
    // 刷新熔炉界面进度条
    if (this.ui.screen === 'furnace' && this.openTile) {
      const te = this.openTile.te;
      if (this.ui.smeltArrow) this.ui.smeltArrow.style.width = `${Math.min(100, (te.cook / 10) * 100)}%`;
      if (this.ui.fireEl) {
        this.ui.fireEl.style.opacity = te.burn > 0 ? 1 : 0.15;
        this.ui.fireEl.style.setProperty('--fill', `${te.burnTotal ? (te.burn / te.burnTotal) * 100 : 0}%`);
      }
      this.ui.refresh();
    }
  }

  // ── 存档 ──
  save() {
    try {
      const chunks = [];
      for (const c of this.world.chunks.values()) {
        if (c.modified) chunks.push(c.serialize());
      }
      const data = {
        seed: this.world.seed,
        time: this.world.time,
        player: {
          x: this.player.x, y: this.player.y, z: this.player.z,
          yaw: this.player.yaw, pitch: this.player.pitch,
          health: this.player.health, food: this.player.food,
          gamemode: this.player.gamemode,
          inventory: this.player.inventory.serialize(),
          armor: this.player.armor.serialize(),
          spawn: this.player.spawnPoint,
        },
        chunks,
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      return true;
    } catch (err) {
      console.warn('保存失败', err);
      this.ui && this.ui.showToast('保存失败：存储空间不足');
      return false;
    }
  }

  loadSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  applySave(save) {
    const p = this.player;
    const s = save.player;
    this.world.time = save.time || 6000;
    p.x = s.x; p.y = s.y; p.z = s.z;
    p.yaw = s.yaw; p.pitch = s.pitch;
    p.health = s.health; p.food = s.food;
    p.gamemode = s.gamemode || 'survival';
    p.inventory.load(s.inventory);
    p.armor.load(s.armor);
    p.spawnPoint = s.spawn || { x: p.x, z: p.z };
    for (const cd of save.chunks || []) {
      const c = ChunkFromSave(cd);
      this.world.chunks.set(chunkKey(cd.cx, cd.cz), c);
      c.modified = true;
      for (const [li, te] of c.tileEntities) {
        if (te.type === 'furnace') {
          const y = Math.floor(li / (CHUNK_X * CHUNK_Z));
          const rest = li % (CHUNK_X * CHUNK_Z);
          const z = Math.floor(rest / CHUNK_X);
          const x = rest % CHUNK_X;
          this.activeFurnaces.set(`${cd.cx * 16 + x},${y},${cd.cz * 16 + z}`,
            { x: cd.cx * 16 + x, y, z: cd.cz * 16 + z });
        }
      }
    }
  }

  respawn() {
    this.player.respawn(this.world);
    this.ui.hideDeath();
    this.ui.refresh();
  }

  // ── 主循环 ──
  loop() {
    const now = performance.now();
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (dt > 0.25) dt = 0.25;

    this.update(dt);
    this.render(dt);

    this.frameTimes.push(dt);
    if (this.frameTimes.length > 60) this.frameTimes.shift();
    requestAnimationFrame(() => this.loop());
  }

  update(dt) {
    const p = this.player;
    const w = this.world;

    if (!this.ui.screen && !p.dead) {
      p.update(dt, this.input);
    } else {
      p.update(dt, { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false });
    }
    if (p.dead && !this.deathShown) {
      this.deathShown = true;
      this.ui.showDeath(p.damageCause);
      this.sound.play('hurt');
    }
    if (!p.dead) this.deathShown = false;

    // 走路脚步声
    if (p.onGround && Math.hypot(p.vx, p.vz) > 1.2) {
      this.stepTimer = (this.stepTimer || 0) - dt;
      if (this.stepTimer <= 0) {
        this.stepTimer = p.sprinting ? 0.28 : 0.42;
        const under = w.getBlock(Math.floor(p.x), Math.floor(p.y - 0.2), Math.floor(p.z));
        this.sound.play('step', soundMaterial(getBlock(under).name));
      }
    }

    w.tick(dt);
    w.update(p.x, p.z, this.renderDistance);
    this.entities.update(dt, p);
    this.updateMining(dt);
    this.tickFurnaces(dt);
    this.syncOpenTile();
    this.processMeshQueue(this.meshQueue.length > 40 ? 6 : 3);

    // 标记被修改过的区块（存档用）
    if (p.mining === null && this.lastSetBlock !== w.tickCount) {
      // setBlock 已经把 dirty 置位，这里顺带标记 modified
    }

    // 界面刷新节流
    this.uiTimer = (this.uiTimer || 0) + dt;
    if (this.uiTimer > 0.2) {
      this.uiTimer = 0;
      this.ui.updateStats();
    }

    // 受伤 / 水下滤镜
    if (p.hurtCooldown > 0) this.ui.setFx('hurt', p.hurtCooldown / 0.5);
    else if (p.inLava) this.ui.setFx('lava', 1);
    else if (p.headInWater) this.ui.setFx('water', 1);
    else this.ui.setFx('none', 0);

    // 自动保存
    this.saveTimer = (this.saveTimer || 0) + dt;
    if (this.saveTimer > 60) { this.saveTimer = 0; this.save(); }
  }

  render(dt) {
    const r = this.renderer;
    const p = this.player;
    r.resize();
    const aspect = this.canvas.width / this.canvas.height;

    // 相机
    let camX = p.x, camY = p.eyeY, camZ = p.z;
    const bob = p.onGround ? Math.sin(p.bobPhase) * 0.035 : 0;
    camY += bob;
    camX += Math.cos(p.bobPhase) * 0.012;
    if (this.thirdPerson) {
      const d = this.lookDir();
      const back = 4;
      const hit = this.world.raycast(camX, camY, camZ, -d[0], -d[1], -d[2], back);
      const dist = hit ? Math.max(0.4, hit.dist - 0.3) : back;
      camX -= d[0] * dist; camY -= d[1] * dist; camZ -= d[2] * dist;
    }
    const camPos = [camX, camY, camZ];

    const fovScale = p.sprinting ? 1.08 : 1;
    r.beginFrame(camPos, p.yaw, p.pitch, aspect, fovScale);

    const biome = this.world.getBiomeAt(Math.floor(p.x), Math.floor(p.z));
    const env = r.environment(this.world, camPos, biome);
    const headBlock = this.world.getBlock(Math.floor(camX), Math.floor(camY), Math.floor(camZ));
    const underwater = headBlock === ID.water;

    r.clear();
    r.drawSky(env, camPos, underwater);
    r.drawChunks(this.world, env, camPos, underwater, this.world.chunks.values());

    // 实体
    this.entityRenderer.beginEntities(env, camPos);
    for (const m of this.entities.mobs) {
      const light = this.lightAtEntity(m.x, m.y + 1, m.z);
      this.entityRenderer.drawMob(m, performance.now() / 1000, light);
    }
    for (const it of this.entities.items) {
      const def = getItem(it.item);
      const light = this.lightAtEntity(it.x, it.y, it.z);
      const t = performance.now() / 1000;
      const yy = it.y + 0.25 + Math.sin(t * 2 + it.age * 3) * 0.06;
      if (def && def.block) {
        const mat = m4.fromTranslation(it.x, yy, it.z);
        m4.rotateY(mat, t * 1.4, mat);
        m4.scale(mat, 0.32, 0.32, 0.32, mat);
        this.entityRenderer.drawBlockCube(def.block, mat, env, camPos, Math.round(light * 15));
        this.entityRenderer.beginEntities(env, camPos);
      } else {
        const idx = this.iconData.index.get(it.item);
        if (idx !== undefined) {
          this.entityRenderer.drawItemBillboard(it.x, yy, it.z, idx, this.atlasCols, p.yaw, 0.42, light);
        }
      }
    }
    for (const a of this.entities.arrows) {
      const mat = m4.fromTranslation(a.x, a.y, a.z);
      m4.scale(mat, 0.12, 0.12, 0.12, mat);
      this.entityRenderer.drawBlockCube('oak_planks', mat, env, camPos, 12);
      this.entityRenderer.beginEntities(env, camPos);
    }

    // 选中框
    if (!this.ui.screen) {
      const hit = this.targetBlock();
      if (hit) {
        const boxes = collisionBoxes(hit.id) || [[0, 0, 0, 1, 1, 1]];
        r.drawSelection(hit.x, hit.y, hit.z, boxes);
        if (p.mining && p.mining.total !== Infinity) {
          const f = Math.min(1, p.mining.progress / p.mining.total);
          this.drawCrack(hit, f, env, camPos);
        }
      }
    }

    // 手持物品
    if (!this.thirdPerson) this.drawHeldItem(env, camPos, aspect);

    this.updateDebug(env, biome);
  }

  lightAtEntity(x, y, z) {
    const sky = this.world.getSky(Math.floor(x), Math.floor(y), Math.floor(z)) / 15;
    const blk = this.world.getBlockLight(Math.floor(x), Math.floor(y), Math.floor(z)) / 15;
    const day = this.world.dayFactor;
    return Math.max(0.12, Math.max(sky * (0.16 + day * 0.84), blk));
  }

  drawCrack(hit, f, env, camPos) {
    // 用一个略大的半透明黑框表示破坏进度
    const gl = this.renderer.gl;
    const p = this.renderer.line;
    gl.useProgram(p.program);
    gl.uniformMatrix4fv(p.u.uProj, false, this.renderer.proj);
    gl.uniformMatrix4fv(p.u.uView, false, this.renderer.view);
    const s = 1.004;
    const mat = m4.fromTranslation(hit.x - (s - 1) / 2, hit.y - (s - 1) / 2, hit.z - (s - 1) / 2);
    m4.scale(mat, s, s, s, mat);
    gl.uniformMatrix4fv(p.u.uModel, false, mat);
    gl.uniform4f(p.u.uColor, 0, 0, 0, 0.15 + f * 0.55);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.renderer.boxVAO);
    gl.lineWidth(1);
    gl.drawArrays(gl.LINES, 0, this.renderer.boxLineCount);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
    void env; void camPos;
  }

  drawHeldItem(env, camPos, aspect) {
    const p = this.player;
    const held = p.heldItem;
    if (!held) return;
    const def = getItem(held.item);
    const gl = this.renderer.gl;
    gl.clear(gl.DEPTH_BUFFER_BIT);

    const swing = Math.sin(p.swingTime * Math.PI) * 0.55;
    const bobX = Math.cos(p.bobPhase) * 0.02;
    const bobY = Math.abs(Math.sin(p.bobPhase)) * 0.02;

    // 把物品放在相机右下角
    const camDir = this.lookDir();
    const right = [Math.cos(p.yaw), 0, -Math.sin(p.yaw)];
    const up = [
      right[1] * camDir[2] - right[2] * camDir[1],
      right[2] * camDir[0] - right[0] * camDir[2],
      right[0] * camDir[1] - right[1] * camDir[0],
    ];
    const fx = 0.46 - swing * 0.1 + bobX;
    const fy = -0.38 - swing * 0.22 - bobY;
    const fz = 0.95;
    const px = camPos[0] + right[0] * fx + up[0] * fy + camDir[0] * fz;
    const py = camPos[1] + right[1] * fx + up[1] * fy + camDir[1] * fz;
    const pz = camPos[2] + right[2] * fx + up[2] * fy + camDir[2] * fz;

    const mat = m4.fromTranslation(px, py, pz);
    m4.rotateY(mat, p.yaw - 0.55, mat);
    m4.rotateX(mat, -p.pitch + swing * 1.1 - 0.25, mat);
    m4.rotateZ(mat, 0.2, mat);
    const light = Math.round(this.lightAtEntity(p.x, p.eyeY, p.z) * 15);

    if (def && def.block) {
      m4.scale(mat, 0.24, 0.24, 0.24, mat);
      this.entityRenderer.drawBlockCube(def.block, mat, env, camPos, light);
    } else {
      const idx = this.iconData.index.get(held.item);
      if (idx === undefined) return;
      this.entityRenderer.beginEntities(env, camPos);
      m4.scale(mat, 0.32, 0.32, 0.32, mat);
      const gl2 = this.renderer.gl;
      const prog = this.renderer.entity;
      gl2.uniform1f(prog.u.uLight, this.lightAtEntity(p.x, p.eyeY, p.z));
      gl2.uniform4f(prog.u.uOverlay, 0, 0, 0, 0);
      gl2.bindTexture(gl2.TEXTURE_2D, this.entityRenderer.itemAtlas);
      gl2.uniformMatrix4fv(prog.u.uModel, false, mat);
      const q = this.entityRenderer['icon_' + idx] || (() => {
        this.entityRenderer.drawItemBillboard(0, -999, 0, idx, this.atlasCols, 0, 0.001, 1);
        return this.entityRenderer['icon_' + idx];
      })();
      if (q) {
        gl2.uniformMatrix4fv(prog.u.uModel, false, mat);
        gl2.disable(gl2.CULL_FACE);
        gl2.bindVertexArray(q.vao);
        gl2.drawElements(gl2.TRIANGLES, q.count, gl2.UNSIGNED_SHORT, 0);
        gl2.enable(gl2.CULL_FACE);
        gl2.bindVertexArray(null);
      }
    }
    void aspect;
  }

  updateDebug(env, biome) {
    if (this.ui.debug.classList.contains('hidden')) return;
    const p = this.player;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / Math.max(1, this.frameTimes.length);
    const t = Math.floor(this.world.time);
    const hh = String(Math.floor(((t / 1000) + 6) % 24)).padStart(2, '0');
    const mm = String(Math.floor(((t % 1000) / 1000) * 60)).padStart(2, '0');
    this.ui.setDebug([
      `FPS ${(1 / avg).toFixed(0)}  (${(avg * 1000).toFixed(1)} ms)`,
      `坐标 ${p.x.toFixed(2)} / ${p.y.toFixed(2)} / ${p.z.toFixed(2)}`,
      `区块 ${Math.floor(p.x / 16)}, ${Math.floor(p.z / 16)}   朝向 ${((-p.yaw * 180 / Math.PI) % 360).toFixed(0)}°`,
      `生物群系 ${biome.display}`,
      `时间 ${hh}:${mm}  日照 ${(env.day * 100).toFixed(0)}%`,
      `光照 天空 ${this.world.getSky(Math.floor(p.x), Math.floor(p.y + 1), Math.floor(p.z))} / 方块 ${this.world.getBlockLight(Math.floor(p.x), Math.floor(p.y + 1), Math.floor(p.z))}`,
      `已加载区块 ${this.world.chunks.size}  绘制 ${this.renderer.stats.chunks}  三角面 ${(this.renderer.stats.tris / 1000).toFixed(1)}k`,
      `实体 生物 ${this.entities.mobs.length} / 掉落物 ${this.entities.items.length}`,
      `模式 ${p.gamemode === 'creative' ? '创造' : '生存'}${p.flying ? ' (飞行)' : ''}`,
    ]);
  }
}

function faceIndexOf(face) {
  if (face[0] === 1) return 0;
  if (face[0] === -1) return 1;
  if (face[1] === 1) return 2;
  if (face[1] === -1) return 3;
  if (face[2] === 1) return 4;
  return 5;
}

function rayAABB(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
  let tmin = 0, tmax = Infinity;
  const test = (o, d, lo, hi) => {
    if (Math.abs(d) < 1e-8) return o >= lo && o <= hi;
    const t1 = (lo - o) / d, t2 = (hi - o) / d;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
    return tmax >= tmin;
  };
  if (!test(ox, dx, x0, x1)) return null;
  if (!test(oy, dy, y0, y1)) return null;
  if (!test(oz, dz, z0, z1)) return null;
  return tmin;
}

function frame() {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

// 存档反序列化需要 Chunk 类
import { Chunk } from './world/chunk.js';
function ChunkFromSave(data) {
  const c = Chunk.deserialize(data);
  c.lit = false;
  c.dirty = true;
  return c;
}

// ── 启动 ──
const loading = document.getElementById('loading');
const status = (t) => {
  const s = document.getElementById('loading-status');
  if (s) s.textContent = t;
};

async function start() {
  const game = new Game();
  window.game = game;
  try {
    status('正在生成程序化材质…');
    await frame();
    await game.boot(status);
    loading.classList.add('hidden');
  } catch (err) {
    console.error(err);
    status('启动失败：' + err.message);
    loading.querySelector('.spinner')?.classList.add('hidden');
  }
}

// 单文件打包版是通过动态 import 加载的，那时 DOMContentLoaded 可能已经触发过了
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', start);
} else {
  start();
}

export { Game, MODELS, MOB_TYPES, TIER, BLOCKS, CHUNK_Z };
