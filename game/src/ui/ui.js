// 界面：HUD、背包、合成台、熔炉、箱子、创造模式物品栏

import { getItem, ITEMS } from '../world/items.js';
import { matchRecipe, SMELTING, fuelValue } from '../world/recipes.js';
import { Inventory, makeStack, maxStack, sameStack } from '../world/inventory.js';
import { BLOCK_BY_NAME } from '../world/blocks.js';

const el = (tag, cls, parent) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (parent) parent.appendChild(e);
  return e;
};

export class UI {
  constructor(game, icons) {
    this.game = game;
    this.icons = icons;           // Map(itemName → canvas)
    this.root = document.getElementById('ui');
    this.screen = null;           // 当前打开的界面
    this.slotEls = [];
    this.tooltip = null;
    this.build();
  }

  build() {
    const root = this.root;
    root.innerHTML = '';

    // 准星
    this.crosshair = el('div', 'crosshair', root);

    // 受伤/水下滤镜
    this.overlayFx = el('div', 'screen-fx', root);

    // 状态栏
    this.hud = el('div', 'hud', root);
    this.statsLeft = el('div', 'stats stats-left', this.hud);
    this.statsRight = el('div', 'stats stats-right', this.hud);
    this.hotbarEl = el('div', 'hotbar', this.hud);
    this.hotbarSlots = [];
    for (let i = 0; i < 9; i++) {
      const s = this.makeSlot(this.hotbarEl, { inv: 'player', index: i });
      this.hotbarSlots.push(s);
    }
    this.itemName = el('div', 'item-name', root);

    // 调试信息
    this.debug = el('div', 'debug hidden', root);

    // 提示条
    this.toast = el('div', 'toast', root);

    // 屏幕层
    this.modal = el('div', 'modal hidden', root);
    this.modalPanel = el('div', 'panel', this.modal);

    // 死亡界面
    this.deathScreen = el('div', 'death hidden', root);
    const dbox = el('div', 'death-box', this.deathScreen);
    el('h1', null, dbox).textContent = '你死了！';
    this.deathCause = el('p', null, dbox);
    const btn = el('button', null, dbox);
    btn.textContent = '重生';
    btn.onclick = () => this.game.respawn();

    // 拖拽中的物品
    this.cursorEl = el('div', 'cursor-item hidden', root);
    this.cursorCanvas = el('canvas', null, this.cursorEl);
    this.cursorCanvas.width = this.cursorCanvas.height = 48;
    this.cursorCount = el('span', 'count', this.cursorEl);

    document.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      if (this.game.player.cursor) {
        this.cursorEl.style.left = e.clientX + 'px';
        this.cursorEl.style.top = e.clientY + 'px';
      }
      if (this.tooltip) {
        this.tooltip.style.left = e.clientX + 14 + 'px';
        this.tooltip.style.top = e.clientY + 14 + 'px';
      }
    });
  }

  makeSlot(parent, ref) {
    const s = el('div', 'slot', parent);
    const c = el('canvas', null, s);
    c.width = c.height = 48;
    const n = el('span', 'count', s);
    const dur = el('div', 'durability', s);
    const slot = { el: s, canvas: c, count: n, dur, ref };
    s.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onSlotClick(slot, e.button, e.shiftKey);
    });
    s.addEventListener('mouseenter', () => this.showTooltip(slot));
    s.addEventListener('mouseleave', () => this.hideTooltip());
    s.addEventListener('contextmenu', (e) => e.preventDefault());
    return slot;
  }

  drawSlot(slot, stack) {
    const ctx = slot.canvas.getContext('2d');
    ctx.clearRect(0, 0, 48, 48);
    if (!stack) {
      slot.count.textContent = '';
      slot.dur.style.display = 'none';
      slot.stack = null;
      return;
    }
    const icon = this.icons.get(stack.item);
    if (icon) ctx.drawImage(icon, 0, 0, 48, 48);
    slot.count.textContent = stack.count > 1 ? stack.count : '';
    const def = getItem(stack.item);
    const maxDur = def && def.tool ? def.tool.durability : def && def.armor ? def.armor.durability : null;
    if (maxDur && stack.durability !== null && stack.durability < maxDur) {
      const f = stack.durability / maxDur;
      slot.dur.style.display = 'block';
      slot.dur.style.width = `${Math.max(2, f * 100)}%`;
      slot.dur.style.background = `hsl(${f * 120}, 90%, 45%)`;
    } else {
      slot.dur.style.display = 'none';
    }
    slot.stack = stack;
  }

  showTooltip(slot) {
    const stack = this.getStack(slot.ref);
    if (!stack) return;
    this.hideTooltip();
    const def = getItem(stack.item);
    this.tooltip = el('div', 'tooltip', this.root);
    this.tooltip.textContent = def ? def.display : stack.item;
    if (def && def.tool) {
      const sub = el('div', 'sub', this.tooltip);
      sub.textContent = `耐久 ${stack.durability}/${def.tool.durability} · 伤害 ${def.tool.damage}`;
    } else if (def && def.armor) {
      const sub = el('div', 'sub', this.tooltip);
      sub.textContent = `护甲 +${def.armor.defense} · 耐久 ${stack.durability}/${def.armor.durability}`;
    } else if (def && def.food) {
      const sub = el('div', 'sub', this.tooltip);
      sub.textContent = `回复饱食 ${def.food.hunger}`;
    }
    this.tooltip.style.left = (this.mouseX || 0) + 14 + 'px';
    this.tooltip.style.top = (this.mouseY || 0) + 14 + 'px';
  }

  hideTooltip() {
    if (this.tooltip) { this.tooltip.remove(); this.tooltip = null; }
  }

  // ── 槽位数据访问 ──
  getInv(ref) {
    const p = this.game.player;
    switch (ref.inv) {
      case 'player': return p.inventory;
      case 'armor': return p.armor;
      case 'craft': return this.craftInv;
      case 'result': return this.resultInv;
      case 'container': return this.containerInv;
      case 'creative': return null;
      default: return null;
    }
  }
  getStack(ref) {
    if (ref.inv === 'creative') return ref.stack || null;
    const inv = this.getInv(ref);
    return inv ? inv.get(ref.index) : null;
  }
  setStack(ref, s) {
    const inv = this.getInv(ref);
    if (inv) inv.set(ref.index, s);
  }

  onSlotClick(slot, button, shift) {
    const p = this.game.player;
    const ref = slot.ref;

    // 创造模式物品栏：无限取用
    if (ref.inv === 'creative') {
      const st = ref.stack;
      if (!st) return;
      if (shift) { p.inventory.add(st.item, maxStack(st.item)); }
      else p.cursor = makeStack(st.item, button === 2 ? 1 : maxStack(st.item));
      this.refresh();
      return;
    }

    // 合成结果槽
    if (ref.inv === 'result') {
      this.takeCraftResult(shift);
      this.refresh();
      return;
    }
    // 熔炉输出槽
    if (ref.inv === 'container' && this.screen === 'furnace' && ref.index === 2) {
      const out = this.containerInv.get(2);
      if (out) {
        if (shift || !p.cursor) {
          const left = p.inventory.add(out.item, out.count);
          if (left === 0) this.containerInv.set(2, null);
          else out.count = left;
        }
      }
      this.refresh();
      return;
    }

    const inv = this.getInv(ref);
    if (!inv) return;
    const cur = inv.get(ref.index);

    if (shift) {
      // 快速移动
      this.quickMove(ref, inv, cur);
      this.refresh();
      return;
    }

    if (button === 2) {
      // 右键：放一个 / 拿一半
      if (p.cursor) {
        if (!cur) {
          if (this.canPlace(ref, p.cursor)) {
            inv.set(ref.index, makeStack(p.cursor.item, 1, p.cursor.durability));
            p.cursor.count--;
            if (p.cursor.count <= 0) p.cursor = null;
          }
        } else if (sameStack(cur, p.cursor) && cur.count < maxStack(cur.item)) {
          cur.count++;
          p.cursor.count--;
          if (p.cursor.count <= 0) p.cursor = null;
        }
      } else if (cur) {
        const half = Math.ceil(cur.count / 2);
        p.cursor = makeStack(cur.item, half, cur.durability);
        cur.count -= half;
        if (cur.count <= 0) inv.set(ref.index, null);
      }
    } else {
      // 左键
      if (p.cursor && cur && sameStack(cur, p.cursor)) {
        const max = maxStack(cur.item);
        const move = Math.min(max - cur.count, p.cursor.count);
        cur.count += move;
        p.cursor.count -= move;
        if (p.cursor.count <= 0) p.cursor = null;
      } else if (p.cursor) {
        if (this.canPlace(ref, p.cursor)) {
          inv.set(ref.index, p.cursor);
          p.cursor = cur;
        }
      } else if (cur) {
        p.cursor = cur;
        inv.set(ref.index, null);
      }
    }
    this.refresh();
  }

  canPlace(ref, stack) {
    if (ref.inv === 'armor') {
      const def = getItem(stack.item);
      return !!(def && def.armor && def.armor.slot === ref.index);
    }
    if (ref.inv === 'container' && this.screen === 'furnace') {
      if (ref.index === 1) return fuelValue(stack.item) > 0;
      if (ref.index === 2) return false;
    }
    return true;
  }

  quickMove(ref, inv, cur) {
    if (!cur) return;
    const p = this.game.player;
    if (ref.inv === 'player') {
      // 背包 ⇄ 容器 / 快捷栏
      if (this.screen === 'chest' || this.screen === 'furnace') {
        const target = this.containerInv;
        const limit = this.screen === 'furnace' ? 1 : target.size;
        let left = cur.count;
        for (let i = 0; i < limit && left > 0; i++) {
          const s = target.get(i);
          if (!s) { target.set(i, makeStack(cur.item, left, cur.durability)); left = 0; }
          else if (sameStack(s, cur)) {
            const move = Math.min(maxStack(cur.item) - s.count, left);
            s.count += move; left -= move;
          }
        }
        cur.count = left;
        if (left <= 0) inv.set(ref.index, null);
        return;
      }
      // 快捷栏 ⇄ 背包
      const toHotbar = ref.index >= 9;
      const from = ref.index;
      const range = toHotbar ? [0, 9] : [9, 36];
      let left = cur.count;
      for (let i = range[0]; i < range[1] && left > 0; i++) {
        const s = inv.get(i);
        if (s && sameStack(s, cur)) {
          const move = Math.min(maxStack(cur.item) - s.count, left);
          s.count += move; left -= move;
        }
      }
      for (let i = range[0]; i < range[1] && left > 0; i++) {
        if (!inv.get(i)) { inv.set(i, makeStack(cur.item, left, cur.durability)); left = 0; }
      }
      cur.count = left;
      if (left <= 0) inv.set(from, null);
    } else {
      // 容器/合成格 → 玩家背包
      const left = p.inventory.add(cur.item, cur.count);
      cur.count = left;
      if (left <= 0) inv.set(ref.index, null);
    }
  }

  // ── 合成 ──
  updateCraftResult() {
    if (!this.craftInv) return;
    const n = this.craftSize;
    const grid = [];
    for (let i = 0; i < n * n; i++) grid.push(this.craftInv.get(i));
    const r = matchRecipe(grid, n, n);
    this.resultInv.set(0, r ? makeStack(r.result, r.count) : null);
    this.currentRecipe = r;
  }

  takeCraftResult(all) {
    const p = this.game.player;
    const res = this.resultInv.get(0);
    if (!res) return;
    let times = 1;
    if (all) {
      times = 64;
      for (let i = 0; i < this.craftInv.size; i++) {
        const s = this.craftInv.get(i);
        if (s) times = Math.min(times, s.count);
      }
    }
    for (let t = 0; t < times; t++) {
      const r = this.currentRecipe;
      if (!r) break;
      if (all) {
        if (p.inventory.add(r.result, r.count) > 0) break;
      } else if (p.cursor) {
        if (!sameStack(p.cursor, { item: r.result }) ||
            p.cursor.count + r.count > maxStack(r.result)) break;
        p.cursor.count += r.count;
      } else {
        p.cursor = makeStack(r.result, r.count);
      }
      for (let i = 0; i < this.craftInv.size; i++) {
        const s = this.craftInv.get(i);
        if (s) { s.count--; if (s.count <= 0) this.craftInv.set(i, null); }
      }
      this.updateCraftResult();
      if (!all) break;
    }
    this.game.sound && this.game.sound('craft');
  }

  /** 关闭界面时把合成格里的东西还给玩家 */
  dumpCrafting() {
    if (!this.craftInv) return;
    const p = this.game.player;
    for (let i = 0; i < this.craftInv.size; i++) {
      const s = this.craftInv.get(i);
      if (s) {
        const left = p.inventory.add(s.item, s.count);
        if (left > 0) this.game.dropItem(s.item, left);
        this.craftInv.set(i, null);
      }
    }
  }

  // ── 界面开关 ──
  open(kind, data = {}) {
    this.close(false);
    this.screen = kind;
    this.slotEls = [];
    this.modal.classList.remove('hidden');
    const panel = this.modalPanel;
    panel.innerHTML = '';
    panel.className = 'panel panel-' + kind;

    if (kind === 'inventory' || kind === 'crafting_table') {
      this.craftSize = kind === 'crafting_table' ? 3 : 2;
      this.craftInv = new Inventory(this.craftSize * this.craftSize);
      this.resultInv = new Inventory(1);
      this.buildCraftPanel(panel, kind);
    } else if (kind === 'furnace') {
      this.containerInv = data.inv;
      this.tile = data.tile;
      this.buildFurnacePanel(panel);
    } else if (kind === 'chest') {
      this.containerInv = data.inv;
      this.buildChestPanel(panel);
    } else if (kind === 'creative') {
      this.buildCreativePanel(panel);
    }
    this.refresh();
    document.exitPointerLock && document.exitPointerLock();
  }

  close(dump = true) {
    if (dump && (this.screen === 'inventory' || this.screen === 'crafting_table')) this.dumpCrafting();
    const p = this.game.player;
    if (dump && p && p.cursor) {
      const left = p.inventory.add(p.cursor.item, p.cursor.count);
      if (left > 0) this.game.dropItem(p.cursor.item, left);
      p.cursor = null;
    }
    this.screen = null;
    this.modal.classList.add('hidden');
    this.hideTooltip();
    this.craftInv = null;
    this.containerInv = null;
    this.refresh();
  }

  title(parent, text) {
    const h = el('div', 'panel-title', parent);
    h.textContent = text;
    return h;
  }

  buildInventoryGrid(parent) {
    const wrap = el('div', 'inv-grid', parent);
    for (let i = 9; i < 36; i++) {
      this.slotEls.push(this.makeSlot(wrap, { inv: 'player', index: i }));
    }
    const hb = el('div', 'inv-hotbar', parent);
    for (let i = 0; i < 9; i++) {
      this.slotEls.push(this.makeSlot(hb, { inv: 'player', index: i }));
    }
  }

  buildCraftPanel(panel, kind) {
    this.title(panel, kind === 'crafting_table' ? '工作台' : '物品栏');
    const top = el('div', 'panel-top', panel);

    if (kind === 'inventory') {
      const armorCol = el('div', 'armor-col', top);
      const labels = ['头盔', '胸甲', '护腿', '靴子'];
      for (let i = 0; i < 4; i++) {
        const s = this.makeSlot(armorCol, { inv: 'armor', index: i });
        s.el.dataset.hint = labels[i];
        this.slotEls.push(s);
      }
      el('div', 'player-preview', top);
    }

    const craftBox = el('div', 'craft-box', top);
    const grid = el('div', `craft-grid craft-${this.craftSize}`, craftBox);
    for (let i = 0; i < this.craftSize * this.craftSize; i++) {
      this.slotEls.push(this.makeSlot(grid, { inv: 'craft', index: i }));
    }
    el('div', 'arrow', craftBox);
    const res = el('div', 'result-slot', craftBox);
    this.slotEls.push(this.makeSlot(res, { inv: 'result', index: 0 }));

    this.buildInventoryGrid(panel);
  }

  buildFurnacePanel(panel) {
    this.title(panel, '熔炉');
    const top = el('div', 'panel-top furnace-top', panel);
    const col = el('div', 'furnace-col', top);
    this.slotEls.push(this.makeSlot(col, { inv: 'container', index: 0 }));
    this.fireEl = el('div', 'fire', col);
    this.slotEls.push(this.makeSlot(col, { inv: 'container', index: 1 }));
    const arrowWrap = el('div', 'furnace-arrow', top);
    this.smeltArrow = el('div', 'arrow-fill', arrowWrap);
    const out = el('div', 'result-slot', top);
    this.slotEls.push(this.makeSlot(out, { inv: 'container', index: 2 }));
    this.buildInventoryGrid(panel);
  }

  buildChestPanel(panel) {
    this.title(panel, '箱子');
    const grid = el('div', 'inv-grid', panel);
    for (let i = 0; i < 27; i++) {
      this.slotEls.push(this.makeSlot(grid, { inv: 'container', index: i }));
    }
    this.buildInventoryGrid(panel);
  }

  buildCreativePanel(panel) {
    this.title(panel, '创造模式物品栏');
    const search = el('input', 'creative-search', panel);
    search.placeholder = '搜索物品…';
    const grid = el('div', 'creative-grid', panel);
    const render = (filter) => {
      grid.innerHTML = '';
      this.slotEls = this.slotEls.filter((s) => s.ref.inv !== 'creative');
      for (const [name, it] of ITEMS) {
        if (filter && !it.display.includes(filter) && !name.includes(filter)) continue;
        const s = this.makeSlot(grid, { inv: 'creative', stack: makeStack(name, 1) });
        this.drawSlot(s, { item: name, count: 1, durability: null });
        s.count.textContent = '';
      }
    };
    search.oninput = () => render(search.value.trim());
    render('');
    this.buildInventoryGrid(panel);
  }

  // ── 每帧刷新 ──
  refresh() {
    const p = this.game.player;
    if (!p) return;
    for (let i = 0; i < 9; i++) {
      this.drawSlot(this.hotbarSlots[i], p.inventory.get(i));
      this.hotbarSlots[i].el.classList.toggle('selected', i === p.hotbar);
    }
    for (const s of this.slotEls) {
      if (s.ref.inv === 'creative') continue;
      this.drawSlot(s, this.getStack(s.ref));
    }
    if (this.craftInv) this.updateCraftResult();
    if (this.craftInv && this.resultInv) {
      const rs = this.slotEls.find((s) => s.ref.inv === 'result');
      if (rs) this.drawSlot(rs, this.resultInv.get(0));
    }

    // 光标物品
    if (p.cursor) {
      this.cursorEl.classList.remove('hidden');
      const ctx = this.cursorCanvas.getContext('2d');
      ctx.clearRect(0, 0, 48, 48);
      const icon = this.icons.get(p.cursor.item);
      if (icon) ctx.drawImage(icon, 0, 0, 48, 48);
      this.cursorCount.textContent = p.cursor.count > 1 ? p.cursor.count : '';
    } else {
      this.cursorEl.classList.add('hidden');
    }
    this.updateStats();
  }

  updateStats() {
    const p = this.game.player;
    const survival = p.gamemode === 'survival';
    this.statsLeft.innerHTML = '';
    this.statsRight.innerHTML = '';
    if (!survival) return;

    const row = (parent, n, cls, full, half) => {
      for (let i = 0; i < n; i++) {
        const d = el('div', 'icon ' + cls, parent);
        const v = i * 2;
        if (full > v + 1) d.classList.add('full');
        else if (half && full > v) d.classList.add('half');
      }
    };
    // 护甲
    const ap = p.armorPoints;
    if (ap > 0) {
      const armorRow = el('div', 'row', this.statsLeft);
      row(armorRow, 10, 'armor', ap, true);
    }
    const hpRow = el('div', 'row', this.statsLeft);
    row(hpRow, 10, 'heart', p.health, true);
    if (p.hurtCooldown > 0) hpRow.classList.add('shake');

    const foodRow = el('div', 'row', this.statsRight);
    row(foodRow, 10, 'food', p.food, true);
    if (p.air < 300) {
      const airRow = el('div', 'row', this.statsRight);
      row(airRow, 10, 'bubble', Math.ceil(p.air / 15), false);
    }
  }

  setItemName(text) {
    this.itemName.textContent = text;
    this.itemName.style.opacity = 1;
    clearTimeout(this._nameTimer);
    this._nameTimer = setTimeout(() => { this.itemName.style.opacity = 0; }, 1600);
  }

  showToast(text, ms = 2200) {
    this.toast.textContent = text;
    this.toast.style.opacity = 1;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { this.toast.style.opacity = 0; }, ms);
  }

  setDebug(lines) {
    this.debug.innerHTML = lines.map((l) => `<div>${l}</div>`).join('');
  }

  toggleDebug() {
    this.debug.classList.toggle('hidden');
  }

  showDeath(cause) {
    this.deathCause.textContent = cause ? `死因：${cause}` : '';
    this.deathScreen.classList.remove('hidden');
    document.exitPointerLock && document.exitPointerLock();
  }
  hideDeath() {
    this.deathScreen.classList.add('hidden');
  }

  setFx(kind, amount) {
    if (kind === 'hurt') {
      this.overlayFx.style.background = `rgba(200,20,20,${amount * 0.42})`;
    } else if (kind === 'water') {
      this.overlayFx.style.background = `rgba(30,90,170,${amount * 0.45})`;
    } else if (kind === 'lava') {
      this.overlayFx.style.background = `rgba(220,90,10,${amount * 0.75})`;
    } else {
      this.overlayFx.style.background = 'transparent';
    }
  }
}

export { BLOCK_BY_NAME, SMELTING };
