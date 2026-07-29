// 玩家：移动物理、挖掘、生命与饥饿、装备

import { Inventory, makeStack, maxStack } from '../world/inventory.js';
import { getBlock, ID, blockDrops, RT, TIER } from '../world/blocks.js';
import { getItem } from '../world/items.js';
import { CHUNK_Y } from '../world/chunk.js';

const WIDTH = 0.6;
const HEIGHT = 1.8;
const EYE = 1.62;
const GRAVITY = 30;
const JUMP_V = 8.6;
const TERMINAL = 60;

export class Player {
  constructor(world) {
    this.world = world;
    this.x = 0.5; this.y = 80; this.z = 0.5;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.yaw = 0; this.pitch = 0;
    this.onGround = false;
    this.inWater = false;
    this.inLava = false;
    this.onLadder = false;
    this.sneaking = false;
    this.sprinting = false;
    this.flying = false;
    this.gamemode = 'survival';

    this.health = 20;
    this.maxHealth = 20;
    this.food = 20;
    this.saturation = 5;
    this.exhaustion = 0;
    this.air = 300;
    this.hurtCooldown = 0;
    this.regenTimer = 0;
    this.dead = false;

    this.inventory = new Inventory(36);      // 0-8 快捷栏，9-35 背包
    this.armor = new Inventory(4);
    this.hotbar = 0;
    this.cursor = null;                      // 鼠标拖着的物品

    this.mining = null;                      // { x,y,z, progress, total }
    this.attackCooldown = 0;
    this.swingTime = 0;
    this.bobPhase = 0;
    this.fallStart = null;
    this.spawnPoint = null;
    this.eatTimer = 0;
    this.tmpBoxes = [];
  }

  get eyeY() {
    return this.y + (this.sneaking ? EYE - 0.15 : EYE);
  }

  get heldItem() {
    return this.inventory.get(this.hotbar);
  }

  get toolTier() {
    const s = this.heldItem;
    if (!s) return TIER.NONE;
    const it = getItem(s.item);
    return it && it.tool ? it.tool.tier : TIER.NONE;
  }

  get toolType() {
    const s = this.heldItem;
    if (!s) return null;
    const it = getItem(s.item);
    return it && it.tool ? it.tool.type : null;
  }

  get armorPoints() {
    let n = 0;
    for (const s of this.armor.slots) {
      if (!s) continue;
      const it = getItem(s.item);
      if (it && it.armor) n += it.armor.defense;
    }
    return n;
  }

  aabb(x = this.x, y = this.y, z = this.z) {
    const h = WIDTH / 2;
    return [x - h, y, z - h, x + h, y + HEIGHT, z + h];
  }

  // ── 输入驱动的移动 ──
  update(dt, input) {
    if (this.dead) return;
    dt = Math.min(dt, 0.06);
    this.hurtCooldown = Math.max(0, this.hurtCooldown - dt);
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    if (this.swingTime > 0) this.swingTime = Math.max(0, this.swingTime - dt * 3.2);

    const feetBlock = this.world.getBlock(Math.floor(this.x), Math.floor(this.y + 0.4), Math.floor(this.z));
    const headBlock = this.world.getBlock(Math.floor(this.x), Math.floor(this.eyeY), Math.floor(this.z));
    this.inWater = feetBlock === ID.water || headBlock === ID.water;
    this.headInWater = headBlock === ID.water;
    this.inLava = feetBlock === ID.lava;
    this.onLadder = this.world.getBlock(Math.floor(this.x), Math.floor(this.y + 0.5), Math.floor(this.z)) === ID.ladder;

    const creative = this.gamemode === 'creative';
    this.sneaking = input.sneak && !this.flying;
    const wantSprint = input.sprint && input.forward > 0 && this.food > 6;
    this.sprinting = wantSprint && !this.sneaking;

    // 水平加速度
    let speed = this.sneaking ? 1.35 : this.sprinting ? 5.7 : 4.35;
    if (this.inWater) speed *= 0.55;
    if (this.flying) speed = this.sprinting ? 22 : 11;

    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let mx = input.strafe * cos - input.forward * sin;
    let mz = -input.strafe * sin - input.forward * cos;
    const len = Math.hypot(mx, mz);
    if (len > 1e-4) { mx /= len; mz /= len; } else { mx = 0; mz = 0; }

    const accel = this.onGround || this.flying ? 34 : 9;
    const targetX = mx * speed, targetZ = mz * speed;
    this.vx += (targetX - this.vx) * Math.min(1, accel * dt);
    this.vz += (targetZ - this.vz) * Math.min(1, accel * dt);

    // 垂直
    if (this.flying) {
      const up = (input.jump ? 1 : 0) - (input.sneak ? 1 : 0);
      this.vy += (up * speed - this.vy) * Math.min(1, 18 * dt);
    } else if (this.inWater || this.inLava) {
      const drag = this.inLava ? 0.5 : 0.8;
      this.vy -= GRAVITY * 0.32 * dt;
      this.vy *= Math.pow(drag, dt * 10);
      if (input.jump) this.vy = Math.min(this.vy + 26 * dt, 3.2);
      if (this.vy < -6) this.vy = -6;
    } else if (this.onLadder) {
      this.vy = input.jump ? 3.2 : input.sneak ? -1.2 : (this.vy < -2.4 ? -2.4 : this.vy - GRAVITY * dt * 0.2);
      if (Math.abs(input.forward) > 0.1 && !input.jump && !input.sneak) this.vy = 2.4;
    } else {
      this.vy -= GRAVITY * dt;
      if (this.vy < -TERMINAL) this.vy = -TERMINAL;
      if (input.jump && this.onGround) {
        this.vy = JUMP_V;
        this.onGround = false;
        if (this.sprinting) this.exhaustion += 0.2;
        else this.exhaustion += 0.05;
      }
    }

    this.move(dt, creative && this.flying);

    // 移动消耗
    const dist = Math.hypot(this.vx, this.vz) * dt;
    if (this.onGround && !creative) {
      this.exhaustion += dist * (this.sprinting ? 0.1 : 0.01);
    }
    this.bobPhase += dist * 3.4;
    this.updateVitals(dt);
  }

  move(dt, noclip) {
    if (noclip) {
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.z += this.vz * dt;
      this.onGround = false;
      return;
    }
    const world = this.world;
    const step = (axis, amount) => {
      if (amount === 0) return;
      const h = WIDTH / 2;
      let nx = this.x, ny = this.y, nz = this.z;
      if (axis === 0) nx += amount;
      else if (axis === 1) ny += amount;
      else nz += amount;
      const box = [nx - h, ny, nz - h, nx + h, ny + HEIGHT, nz + h];
      if (!world.intersects(...box)) {
        if (axis === 0) this.x = nx;
        else if (axis === 1) { this.y = ny; }
        else this.z = nz;
        return;
      }
      // 撞上了：细分逼近
      let lo = 0, hi = amount;
      for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2;
        let tx = this.x, ty = this.y, tz = this.z;
        if (axis === 0) tx += mid;
        else if (axis === 1) ty += mid;
        else tz += mid;
        if (!world.intersects(tx - h, ty, tz - h, tx + h, ty + HEIGHT, tz + h)) lo = mid;
        else hi = mid;
      }
      if (axis === 0) { this.x += lo; this.vx = 0; }
      else if (axis === 1) {
        this.y += lo;
        if (amount < 0) {
          this.onGround = true;
          this.handleFall();
        }
        this.vy = 0;
      } else { this.z += lo; this.vz = 0; }
    };

    const wasGround = this.onGround;
    this.onGround = false;
    step(1, this.vy * dt);

    // 自动上台阶
    const beforeX = this.x, beforeZ = this.z;
    const dx = this.vx * dt, dz = this.vz * dt;
    step(0, dx);
    step(2, dz);
    const movedX = Math.abs(this.x - beforeX), movedZ = Math.abs(this.z - beforeZ);
    if ((wasGround || this.onGround) && !this.flying &&
        (movedX < Math.abs(dx) - 1e-4 || movedZ < Math.abs(dz) - 1e-4)) {
      const saveX = this.x, saveY = this.y, saveZ = this.z;
      const h = WIDTH / 2;
      const upY = this.y + 0.62;
      if (!this.world.intersects(this.x - h, upY, this.z - h, this.x + h, upY + HEIGHT, this.z + h)) {
        this.y = upY;
        const bx = this.x, bz = this.z;
        step(0, dx - (this.x - beforeX));
        step(2, dz - (this.z - beforeZ));
        if (Math.abs(this.x - bx) < 1e-4 && Math.abs(this.z - bz) < 1e-4) {
          this.x = saveX; this.y = saveY; this.z = saveZ;
        } else {
          this.onGround = true;
        }
      }
    }

    if (!this.onGround && this.vy <= 0 && this.fallStart === null && !this.flying) {
      this.fallStart = this.y;
    }
    if (this.onGround) this.fallStart = null;
    if (this.y < -8) this.damage(4, '虚空');
  }

  handleFall() {
    if (this.fallStart === null || this.gamemode === 'creative') { this.fallStart = null; return; }
    const dist = this.fallStart - this.y;
    this.fallStart = null;
    if (this.inWater) return;
    if (dist > 3.5) {
      this.damage(Math.floor(dist - 3), '摔落');
    }
  }

  updateVitals(dt) {
    if (this.gamemode === 'creative') { this.health = this.maxHealth; return; }
    // 饥饿
    if (this.exhaustion >= 4) {
      this.exhaustion -= 4;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else this.food = Math.max(0, this.food - 1);
    }
    // 自然回血
    if (this.food >= 18 && this.health < this.maxHealth) {
      this.regenTimer += dt;
      if (this.regenTimer > 3.5) {
        this.regenTimer = 0;
        this.health = Math.min(this.maxHealth, this.health + 1);
        this.exhaustion += 1.5;
      }
    } else this.regenTimer = 0;
    // 饿死
    if (this.food <= 0) {
      this.starveTimer = (this.starveTimer || 0) + dt;
      if (this.starveTimer > 4) {
        this.starveTimer = 0;
        this.damage(1, '饥饿');
      }
    }
    // 溺水
    if (this.headInWater) {
      this.air -= dt * 60;
      if (this.air <= 0) {
        this.air = 0;
        this.drownTimer = (this.drownTimer || 0) + dt;
        if (this.drownTimer > 1) { this.drownTimer = 0; this.damage(2, '溺水'); }
      }
    } else {
      this.air = Math.min(300, this.air + dt * 180);
    }
    // 岩浆 / 仙人掌
    if (this.inLava) {
      this.lavaTimer = (this.lavaTimer || 0) + dt;
      if (this.lavaTimer > 0.5) { this.lavaTimer = 0; this.damage(4, '岩浆'); }
    }
    const touching = this.touchingBlock(ID.cactus);
    if (touching) {
      this.cactusTimer = (this.cactusTimer || 0) + dt;
      if (this.cactusTimer > 0.5) { this.cactusTimer = 0; this.damage(1, '仙人掌'); }
    }
  }

  touchingBlock(id) {
    const h = WIDTH / 2 + 0.05;
    for (let y = Math.floor(this.y); y <= Math.floor(this.y + HEIGHT); y++) {
      for (let z = Math.floor(this.z - h); z <= Math.floor(this.z + h); z++) {
        for (let x = Math.floor(this.x - h); x <= Math.floor(this.x + h); x++) {
          if (this.world.getBlock(x, y, z) === id) return true;
        }
      }
    }
    return false;
  }

  damage(amount, cause = '') {
    if (this.gamemode === 'creative' || this.dead) return;
    if (this.hurtCooldown > 0) return;
    const reduction = Math.min(0.8, this.armorPoints * 0.04);
    const real = Math.max(0.5, amount * (1 - reduction));
    this.health -= real;
    this.hurtCooldown = 0.5;
    this.damageCause = cause;
    this.damageBlend = 1;
    this.damageArmor(Math.max(1, Math.floor(amount / 4)));
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
    }
  }

  damageArmor(n) {
    for (let i = 0; i < 4; i++) {
      const s = this.armor.get(i);
      if (!s || s.durability === null) continue;
      s.durability -= n;
      if (s.durability <= 0) this.armor.set(i, null);
    }
  }

  heal(n) {
    this.health = Math.min(this.maxHealth, this.health + n);
  }

  eat() {
    const s = this.heldItem;
    if (!s) return false;
    const it = getItem(s.item);
    if (!it || !it.food) return false;
    if (this.food >= 20 && !it.food.poison) return false;
    this.food = Math.min(20, this.food + it.food.hunger);
    this.saturation = Math.min(this.food, this.saturation + it.food.saturation);
    if (it.food.poison) this.damage(1, '食物中毒');
    s.count--;
    if (it.food.container) this.inventory.add(it.food.container, 1);
    if (s.count <= 0) this.inventory.set(this.hotbar, null);
    return true;
  }

  respawn(world) {
    this.dead = false;
    this.health = this.maxHealth;
    this.food = 20;
    this.saturation = 5;
    this.air = 300;
    this.vx = this.vy = this.vz = 0;
    const sp = this.spawnPoint || { x: 0.5, z: 0.5 };
    this.x = sp.x; this.z = sp.z;
    for (let i = 0; i < 8; i++) {
      world.ensureChunk((this.x >> 4) + (i % 3) - 1, (this.z >> 4) + Math.floor(i / 3) - 1);
    }
    this.y = world.surfaceY(Math.floor(this.x), Math.floor(this.z)) + 0.2;
  }

  // ── 挖掘 ──
  breakTime(blockId) {
    const b = getBlock(blockId);
    if (b.hardness < 0) return Infinity;
    if (this.gamemode === 'creative') return 0;
    const s = this.heldItem;
    const it = s ? getItem(s.item) : null;
    let speed = 1;
    if (it && it.tool) {
      if (it.tool.type === b.tool) speed = it.tool.speed;
      else if (it.tool.type === 'shears' && (b.name.endsWith('_leaves') || b.tool === 'shears')) speed = 15;
      else if (it.tool.type === 'sword' && b.render === RT.CROSS) speed = 15;
    }
    const canHarvest = b.tier === 0 || this.toolTier >= b.tier;
    return (b.hardness * (canHarvest ? 1.5 : 5)) / speed;
  }

  /** 消耗工具耐久，返回是否损坏 */
  damageTool(n = 1) {
    if (this.gamemode === 'creative') return false;
    const s = this.heldItem;
    if (!s || s.durability === null) return false;
    s.durability -= n;
    if (s.durability <= 0) {
      this.inventory.set(this.hotbar, null);
      return true;
    }
    return false;
  }

  give(item, count = 1) {
    return this.inventory.add(item, count);
  }
}

export { WIDTH, HEIGHT, EYE, blockDrops, makeStack, maxStack, CHUNK_Y };
