// 实体系统：生物 AI、掉落物、箭矢、爆炸

import { ID, getBlock, BLOCKS } from '../world/blocks.js';
import { getItem } from '../world/items.js';
import { Rand, clamp } from '../util/noise.js';
import { MODELS } from '../render/entities.js';
import { CHUNK_Y } from '../world/chunk.js';

export const MOB_TYPES = {
  pig: {
    display: '猪', hostile: false, health: 10, speed: 1.5, width: 0.9, height: 0.9,
    drops: [{ item: 'raw_porkchop', min: 1, max: 3 }], spawnOn: ['grass_block'], group: [2, 4],
  },
  cow: {
    display: '牛', hostile: false, health: 10, speed: 1.4, width: 0.9, height: 1.4,
    drops: [{ item: 'raw_beef', min: 1, max: 3 }, { item: 'leather', min: 0, max: 2 }],
    spawnOn: ['grass_block'], group: [2, 4],
  },
  sheep: {
    display: '羊', hostile: false, health: 8, speed: 1.4, width: 0.9, height: 1.3,
    drops: [{ item: 'raw_mutton', min: 1, max: 2 }, { item: 'white_wool', min: 1, max: 1 }],
    spawnOn: ['grass_block'], group: [2, 5],
  },
  chicken: {
    display: '鸡', hostile: false, health: 4, speed: 1.3, width: 0.4, height: 0.7,
    drops: [{ item: 'raw_chicken', min: 1, max: 1 }, { item: 'feather', min: 0, max: 2 }],
    spawnOn: ['grass_block'], group: [2, 4],
  },
  zombie: {
    display: '僵尸', hostile: true, health: 20, speed: 2.2, width: 0.6, height: 1.95,
    damage: 3, drops: [{ item: 'rotten_flesh', min: 0, max: 2 }], burnsInDay: true, group: [1, 3],
  },
  skeleton: {
    display: '骷髅', hostile: true, health: 20, speed: 2.3, width: 0.6, height: 1.95,
    damage: 2, ranged: true, drops: [{ item: 'bone', min: 0, max: 2 }, { item: 'arrow', min: 0, max: 2 }],
    burnsInDay: true, group: [1, 2],
  },
  creeper: {
    display: '苦力怕', hostile: true, health: 20, speed: 2.0, width: 0.6, height: 1.7,
    explodes: true, drops: [{ item: 'gunpowder', min: 0, max: 2 }], group: [1, 2],
  },
  spider: {
    display: '蜘蛛', hostile: true, health: 16, speed: 2.9, width: 1.4, height: 0.9,
    damage: 2, climbs: true, drops: [{ item: 'string', min: 0, max: 2 }], group: [1, 3],
  },
};

const GRAVITY = 26;

export class Mob {
  constructor(type, x, y, z) {
    const t = MOB_TYPES[type];
    this.type = type;
    this.def = t;
    this.x = x; this.y = y; this.z = z;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.yaw = Math.random() * Math.PI * 2;
    this.headYaw = this.yaw;
    this.headPitch = 0;
    this.health = t.health;
    this.maxHealth = t.health;
    this.onGround = false;
    this.walkPhase = 0;
    this.walkAmount = 0;
    this.target = null;
    this.wanderTimer = 0;
    this.wanderDir = [0, 0];
    this.attackCooldown = 0;
    this.hurtTime = 0;
    this.fuse = -1;
    this.dead = false;
    this.age = 0;
    this.inWater = false;
    this.jumpCooldown = 0;
    this.burning = 0;
  }

  get width() { return this.def.width; }
  get height() { return this.def.height; }

  aabb() {
    const h = this.width / 2;
    return [this.x - h, this.y, this.z - h, this.x + h, this.y + this.height, this.z + h];
  }

  update(dt, world, player, entities) {
    this.age += dt;
    this.hurtTime = Math.max(0, this.hurtTime - dt);
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);

    const feet = world.getBlock(Math.floor(this.x), Math.floor(this.y + 0.2), Math.floor(this.z));
    this.inWater = feet === ID.water;
    if (feet === ID.lava) this.hurt(4 * dt * 2, world, entities);

    // 白天燃烧
    if (this.def.burnsInDay && world.isDay()) {
      const sky = world.getSky(Math.floor(this.x), Math.floor(this.y + this.height), Math.floor(this.z));
      if (sky >= 14) {
        this.burning += dt;
        if (this.burning > 1) { this.burning = 0; this.hurt(1, world, entities); }
      }
    }

    this.think(dt, world, player, entities);

    // 物理
    if (!this.inWater) this.vy -= GRAVITY * dt;
    else this.vy = clamp(this.vy + 6 * dt, -1.4, 1.6);
    if (this.vy < -40) this.vy = -40;

    this.moveAxis(world, 0, this.vx * dt);
    const beforeY = this.y;
    this.onGround = false;
    this.moveAxis(world, 1, this.vy * dt);
    this.moveAxis(world, 2, this.vz * dt);
    void beforeY;

    const hspeed = Math.hypot(this.vx, this.vz);
    this.walkAmount = Math.min(0.85, hspeed * 0.32);
    this.walkPhase += hspeed * dt * 5.5;
    if (this.onGround) {
      const drag = Math.pow(0.02, dt);
      this.vx *= drag;
      this.vz *= drag;
    }

    if (this.y < -6) this.dead = true;
  }

  moveAxis(world, axis, amount) {
    if (amount === 0) return;
    const h = this.width / 2;
    let nx = this.x, ny = this.y, nz = this.z;
    if (axis === 0) nx += amount;
    else if (axis === 1) ny += amount;
    else nz += amount;
    if (!world.intersects(nx - h, ny, nz - h, nx + h, ny + this.height, nz + h)) {
      if (axis === 0) this.x = nx;
      else if (axis === 1) this.y = ny;
      else this.z = nz;
      return;
    }
    if (axis === 1) {
      if (amount < 0) this.onGround = true;
      this.vy = 0;
      return;
    }
    // 被挡住 → 尝试跳过一格
    if (this.onGround && this.jumpCooldown <= 0) {
      const upY = this.y + 1.05;
      if (!world.intersects(nx - h, upY, nz - h, nx + h, upY + this.height, nz + h)) {
        this.vy = 7.6;
        this.jumpCooldown = 0.35;
      }
    }
    if (this.def.climbs) this.vy = Math.max(this.vy, 3.4);
    if (axis === 0) this.vx = 0; else this.vz = 0;
  }

  think(dt, world, player, entities) {
    const dx = player.x - this.x, dz = player.z - this.z, dy = player.y - this.y;
    const dist = Math.hypot(dx, dy, dz);
    const t = this.def;

    if (t.hostile && !player.dead && player.gamemode !== 'creative' && dist < 18) {
      this.target = player;
    } else if (dist > 26) {
      this.target = null;
    }

    if (this.target) {
      const speed = t.speed * (this.hurtTime > 0 ? 1.3 : 1);
      const len = Math.hypot(dx, dz) || 1;
      this.yaw = Math.atan2(-dx, -dz);
      this.headYaw = this.yaw;
      this.headPitch = Math.atan2(dy + 1, len);

      if (t.explodes) {
        if (dist < 3.2) {
          this.fuse = this.fuse < 0 ? 1.5 : this.fuse - dt;
          this.vx *= 0.6; this.vz *= 0.6;
          if (this.fuse <= 0) {
            this.explode(world, player, entities);
            return;
          }
        } else {
          this.fuse = -1;
          this.vx = (dx / len) * speed;
          this.vz = (dz / len) * speed;
        }
      } else if (t.ranged) {
        if (dist > 5) {
          this.vx = (dx / len) * speed;
          this.vz = (dz / len) * speed;
        } else if (dist < 3.5) {
          this.vx = -(dx / len) * speed * 0.6;
          this.vz = -(dz / len) * speed * 0.6;
        } else { this.vx *= 0.4; this.vz *= 0.4; }
        if (this.attackCooldown <= 0 && dist < 16 && this.canSee(world, player)) {
          this.attackCooldown = 2;
          const a = new Arrow(this.x, this.y + this.height * 0.8, this.z);
          const tx = player.x - this.x, ty = (player.y + 1.2) - (this.y + this.height * 0.8), tz = player.z - this.z;
          const l = Math.hypot(tx, ty, tz) || 1;
          const sp = 24;
          a.vx = (tx / l) * sp; a.vy = (ty / l) * sp + l * 0.06; a.vz = (tz / l) * sp;
          a.owner = 'mob';
          entities.arrows.push(a);
        }
      } else {
        this.vx = (dx / len) * speed;
        this.vz = (dz / len) * speed;
        if (dist < 1.6 && this.attackCooldown <= 0) {
          this.attackCooldown = 1;
          player.damage(t.damage || 2, t.display);
          const kb = 5;
          player.vx += (dx / len) * kb;
          player.vz += (dz / len) * kb;
          player.vy += 3;
        }
      }
      return;
    }

    // 闲逛
    this.wanderTimer -= dt;
    if (this.wanderTimer <= 0) {
      this.wanderTimer = 2 + Math.random() * 4;
      if (Math.random() < 0.45) {
        this.wanderDir = [0, 0];
      } else {
        const a = Math.random() * Math.PI * 2;
        this.wanderDir = [Math.cos(a), Math.sin(a)];
        this.yaw = Math.atan2(-this.wanderDir[0], -this.wanderDir[1]);
      }
    }
    const ws = t.speed * 0.42;
    this.vx = this.wanderDir[0] * ws;
    this.vz = this.wanderDir[1] * ws;
    this.headYaw = this.yaw;
    this.headPitch *= 0.9;
    // 被打后逃跑
    if (this.hurtTime > 0 && !t.hostile) {
      this.vx *= 3.4;
      this.vz *= 3.4;
    }
  }

  canSee(world, player) {
    const dx = player.x - this.x;
    const dy = (player.y + 1.2) - (this.y + this.height * 0.8);
    const dz = player.z - this.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    const hit = world.raycast(this.x, this.y + this.height * 0.8, this.z, dx / l, dy / l, dz / l, l);
    return !hit;
  }

  hurt(amount, world, entities, knockback = null) {
    if (this.dead) return;
    this.health -= amount;
    this.hurtTime = 0.35;
    if (knockback) {
      this.vx += knockback[0];
      this.vy = Math.max(this.vy, 5);
      this.vz += knockback[1];
    }
    if (this.health <= 0) {
      this.dead = true;
      this.dropLoot(entities);
    }
  }

  dropLoot(entities) {
    const rand = new Rand((this.x * 73856093) ^ (this.z * 19349663) ^ Math.floor(this.age * 1000));
    for (const d of this.def.drops || []) {
      const n = d.min + rand.int(d.max - d.min + 1);
      if (n > 0) {
        entities.spawnItem(this.x, this.y + this.height * 0.5, this.z, d.item, n);
      }
    }
  }

  explode(world, player, entities) {
    this.dead = true;
    entities.explode(world, this.x, this.y + 0.6, this.z, 3.0, player);
  }
}

export class ItemEntity {
  constructor(x, y, z, item, count) {
    this.x = x; this.y = y; this.z = z;
    this.vx = (Math.random() - 0.5) * 2;
    this.vy = 2.4 + Math.random();
    this.vz = (Math.random() - 0.5) * 2;
    this.item = item;
    this.count = count;
    this.age = 0;
    this.pickupDelay = 0.5;
    this.dead = false;
    this.onGround = false;
  }
  update(dt, world) {
    this.age += dt;
    this.pickupDelay = Math.max(0, this.pickupDelay - dt);
    if (this.age > 300) { this.dead = true; return; }
    this.vy -= 22 * dt;
    const inWater = world.getBlock(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z)) === ID.water;
    if (inWater) this.vy = clamp(this.vy + 30 * dt, -1, 1.2);
    const r = 0.14;
    const tryMove = (ax, amt) => {
      let nx = this.x, ny = this.y, nz = this.z;
      if (ax === 0) nx += amt; else if (ax === 1) ny += amt; else nz += amt;
      if (!world.intersects(nx - r, ny, nz - r, nx + r, ny + r * 2, nz + r)) {
        if (ax === 0) this.x = nx; else if (ax === 1) this.y = ny; else this.z = nz;
      } else {
        if (ax === 1) { if (amt < 0) this.onGround = true; this.vy = 0; }
        else if (ax === 0) this.vx = 0;
        else this.vz = 0;
      }
    };
    this.onGround = false;
    tryMove(1, this.vy * dt);
    tryMove(0, this.vx * dt);
    tryMove(2, this.vz * dt);
    const drag = Math.pow(this.onGround ? 0.008 : 0.6, dt);
    this.vx *= drag;
    this.vz *= drag;
    if (this.y < -6) this.dead = true;
  }
}

export class Arrow {
  constructor(x, y, z) {
    this.x = x; this.y = y; this.z = z;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.age = 0;
    this.dead = false;
    this.stuck = false;
    this.owner = 'player';
    this.damage = 5;
  }
  update(dt, world, player, entities) {
    this.age += dt;
    if (this.age > 60 || this.stuck && this.age > 12) { this.dead = true; return; }
    if (this.stuck) return;
    this.vy -= 20 * dt;
    const nx = this.x + this.vx * dt;
    const ny = this.y + this.vy * dt;
    const nz = this.z + this.vz * dt;
    const dx = nx - this.x, dy = ny - this.y, dz = nz - this.z;
    const len = Math.hypot(dx, dy, dz);
    if (len > 0) {
      const hit = world.raycast(this.x, this.y, this.z, dx / len, dy / len, dz / len, len);
      if (hit) { this.stuck = true; this.age = 0; return; }
    }
    this.x = nx; this.y = ny; this.z = nz;

    if (this.owner === 'player') {
      for (const m of entities.mobs) {
        if (m.dead) continue;
        const [x0, y0, z0, x1, y1, z1] = m.aabb();
        if (this.x > x0 - 0.1 && this.x < x1 + 0.1 && this.y > y0 - 0.1 &&
            this.y < y1 + 0.1 && this.z > z0 - 0.1 && this.z < z1 + 0.1) {
          const l = Math.hypot(this.vx, this.vz) || 1;
          m.hurt(this.damage, world, entities, [this.vx / l * 3, this.vz / l * 3]);
          this.dead = true;
          return;
        }
      }
    } else {
      const [x0, y0, z0, x1, y1, z1] = [player.x - 0.3, player.y, player.z - 0.3, player.x + 0.3, player.y + 1.8, player.z + 0.3];
      if (this.x > x0 && this.x < x1 && this.y > y0 && this.y < y1 && this.z > z0 && this.z < z1) {
        player.damage(this.damage, '骷髅');
        this.dead = true;
      }
    }
  }
}

/** 实体管理器 */
export class Entities {
  constructor(world) {
    this.world = world;
    this.mobs = [];
    this.items = [];
    this.arrows = [];
    this.particles = [];
    this.spawnTimer = 0;
    this.maxMobs = 40;
  }

  spawnItem(x, y, z, item, count) {
    if (!getItem(item)) return;
    const max = getItem(item).stack;
    while (count > 0) {
      const n = Math.min(max, count);
      this.items.push(new ItemEntity(x, y, z, item, n));
      count -= n;
    }
  }

  update(dt, player) {
    const world = this.world;
    for (const m of this.mobs) m.update(dt, world, player, this);
    for (const it of this.items) it.update(dt, world);
    for (const a of this.arrows) a.update(dt, world, player, this);

    // 拾取
    for (const it of this.items) {
      if (it.dead || it.pickupDelay > 0) continue;
      const dx = player.x - it.x, dy = (player.y + 0.9) - it.y, dz = player.z - it.z;
      const d = Math.hypot(dx, dy, dz);
      if (d < 1.6) {
        if (d > 0.4) {
          it.vx += (dx / d) * 12 * dt;
          it.vy += (dy / d) * 12 * dt;
          it.vz += (dz / d) * 12 * dt;
        }
        if (d < 1.0 && player.inventory.canFit(it.item, it.count)) {
          const left = player.give(it.item, it.count);
          if (left === 0) { it.dead = true; this.onPickup && this.onPickup(it.item, it.count); }
          else it.count = left;
        }
      }
    }
    // 合并掉落物
    for (let i = 0; i < this.items.length; i++) {
      const a = this.items[i];
      if (a.dead) continue;
      for (let j = i + 1; j < this.items.length; j++) {
        const b = this.items[j];
        if (b.dead || b.item !== a.item) continue;
        if (Math.abs(a.x - b.x) < 0.6 && Math.abs(a.y - b.y) < 0.6 && Math.abs(a.z - b.z) < 0.6) {
          const max = getItem(a.item).stack;
          const move = Math.min(max - a.count, b.count);
          if (move > 0) { a.count += move; b.count -= move; if (b.count <= 0) b.dead = true; }
        }
      }
    }

    this.mobs = this.mobs.filter((m) => !m.dead && Math.hypot(m.x - player.x, m.z - player.z) < 110);
    this.items = this.items.filter((i) => !i.dead);
    this.arrows = this.arrows.filter((a) => !a.dead);

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 2.5;
      this.trySpawn(player);
    }
  }

  trySpawn(player) {
    const world = this.world;
    if (this.mobs.length >= this.maxMobs) return;
    const night = !world.isDay();
    for (let attempt = 0; attempt < 12; attempt++) {
      const ang = Math.random() * Math.PI * 2;
      const r = 26 + Math.random() * 34;
      const x = Math.floor(player.x + Math.cos(ang) * r);
      const z = Math.floor(player.z + Math.sin(ang) * r);
      if (!world.chunkAt(x, z)) continue;
      const y = world.surfaceY(x, z);
      if (y <= 1 || y >= CHUNK_Y - 2) continue;
      const ground = world.getBlock(x, y - 1, z);
      const gb = getBlock(ground);
      if (!gb.solid || ground === ID.water) continue;
      if (world.getBlock(x, y, z) !== 0 || world.getBlock(x, y + 1, z) !== 0) continue;

      const sky = world.getSky(x, y, z);
      const blockLight = world.getBlockLight(x, y, z);
      const biome = world.getBiomeAt(x, z);
      const light = Math.max(night ? 0 : sky, blockLight);

      let type = null;
      if (light <= 7 && (night || sky < 4)) {
        const hostiles = ['zombie', 'zombie', 'skeleton', 'creeper', 'spider'];
        type = hostiles[Math.floor(Math.random() * hostiles.length)];
      } else if (sky >= 9 && ground === ID.grass_block && biome.passiveMobs.length) {
        const passives = ['pig', 'cow', 'sheep', 'chicken'];
        type = passives[Math.floor(Math.random() * passives.length)];
        if (this.mobs.filter((m) => !MOB_TYPES[m.type].hostile).length > 18) return;
      }
      if (!type) continue;

      const [gmin, gmax] = MOB_TYPES[type].group;
      const n = gmin + Math.floor(Math.random() * (gmax - gmin + 1));
      for (let i = 0; i < n && this.mobs.length < this.maxMobs; i++) {
        const ox = x + (Math.random() - 0.5) * 4;
        const oz = z + (Math.random() - 0.5) * 4;
        const oy = world.surfaceY(Math.floor(ox), Math.floor(oz));
        if (world.getBlock(Math.floor(ox), oy, Math.floor(oz)) !== 0) continue;
        this.mobs.push(new Mob(type, ox + 0.5, oy, oz + 0.5));
      }
      return;
    }
  }

  /** 爆炸：破坏方块 + 击伤实体 */
  explode(world, x, y, z, power, player) {
    const r = Math.ceil(power);
    for (let dy = -r; dy <= r; dy++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const d = Math.hypot(dx, dy, dz);
          if (d > power) continue;
          const bx = Math.floor(x) + dx, by = Math.floor(y) + dy, bz = Math.floor(z) + dz;
          const id = world.getBlock(bx, by, bz);
          if (id === 0) continue;
          const b = BLOCKS[id];
          if (!b || b.hardness < 0) continue;
          const resist = b.name === 'obsidian' ? 60 : b.hardness;
          if (resist > 8) continue;
          if (Math.random() > 1 - d / power * 0.5) continue;
          world.setBlock(bx, by, bz, 0);
          if (Math.random() < 0.3) {
            const drops = b.drops;
            if (typeof drops === 'string') this.spawnItem(bx + 0.5, by + 0.5, bz + 0.5, drops, 1);
          }
        }
      }
    }
    // 伤害
    for (const m of this.mobs) {
      const d = Math.hypot(m.x - x, m.y - y, m.z - z);
      if (d < power * 2) {
        const f = 1 - d / (power * 2);
        m.hurt(power * 6 * f, world, this, [(m.x - x) * f, (m.z - z) * f]);
      }
    }
    const pd = Math.hypot(player.x - x, player.y - y, player.z - z);
    if (pd < power * 2) {
      const f = 1 - pd / (power * 2);
      player.damage(power * 6 * f, '爆炸');
      player.vx += (player.x - x) * f * 2;
      player.vy += 6 * f;
      player.vz += (player.z - z) * f * 2;
    }
    this.addParticles(x, y, z, 30);
  }

  addParticles(x, y, z, n) {
    for (let i = 0; i < n; i++) {
      this.particles.push({
        x, y, z,
        vx: (Math.random() - 0.5) * 6,
        vy: Math.random() * 5,
        vz: (Math.random() - 0.5) * 6,
        life: 0.6 + Math.random() * 0.6,
      });
    }
    if (this.particles.length > 400) this.particles.splice(0, this.particles.length - 400);
  }
}

export { MODELS };
