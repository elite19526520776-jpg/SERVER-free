// 物品栏与物品堆

import { ITEMS, getItem } from './items.js';

export function makeStack(item, count = 1, durability = null) {
  const def = getItem(item);
  return {
    item,
    count,
    durability: durability !== null ? durability
      : def && (def.tool || def.armor) ? (def.tool ? def.tool.durability : def.armor.durability) : null,
  };
}

export function maxStack(item) {
  const d = getItem(item);
  return d ? d.stack : 64;
}

export function sameStack(a, b) {
  if (!a || !b) return false;
  if (a.item !== b.item) return false;
  const d = getItem(a.item);
  if (d && (d.tool || d.armor)) return false;   // 工具不叠加
  return true;
}

export class Inventory {
  constructor(size) {
    this.slots = new Array(size).fill(null);
  }
  get size() {
    return this.slots.length;
  }
  get(i) {
    return this.slots[i];
  }
  set(i, s) {
    this.slots[i] = s && s.count > 0 ? s : null;
  }
  /** 返回未放下的数量 */
  add(item, count = 1) {
    const max = maxStack(item);
    const def = getItem(item);
    const stackable = !(def && (def.tool || def.armor));
    if (stackable) {
      for (let i = 0; i < this.slots.length && count > 0; i++) {
        const s = this.slots[i];
        if (s && s.item === item && s.count < max) {
          const add = Math.min(max - s.count, count);
          s.count += add;
          count -= add;
        }
      }
    }
    for (let i = 0; i < this.slots.length && count > 0; i++) {
      if (!this.slots[i]) {
        const add = Math.min(max, count);
        this.slots[i] = makeStack(item, add);
        count -= add;
      }
    }
    return count;
  }
  /** 是否装得下 */
  canFit(item, count = 1) {
    let need = count;
    const max = maxStack(item);
    for (const s of this.slots) {
      if (!s) need -= max;
      else if (s.item === item) need -= max - s.count;
      if (need <= 0) return true;
    }
    return need <= 0;
  }
  count(item) {
    let n = 0;
    for (const s of this.slots) if (s && s.item === item) n += s.count;
    return n;
  }
  remove(item, count = 1) {
    let need = count;
    for (let i = 0; i < this.slots.length && need > 0; i++) {
      const s = this.slots[i];
      if (s && s.item === item) {
        const take = Math.min(s.count, need);
        s.count -= take;
        need -= take;
        if (s.count <= 0) this.slots[i] = null;
      }
    }
    return count - need;
  }
  removeAt(i, count = 1) {
    const s = this.slots[i];
    if (!s) return null;
    const take = Math.min(count, s.count);
    s.count -= take;
    const out = makeStack(s.item, take, s.durability);
    if (s.count <= 0) this.slots[i] = null;
    return out;
  }
  serialize() {
    return this.slots.map((s) => (s ? [s.item, s.count, s.durability] : null));
  }
  load(data) {
    this.slots = new Array(this.slots.length).fill(null);
    (data || []).forEach((d, i) => {
      if (d && i < this.slots.length && ITEMS.has(d[0])) {
        this.slots[i] = { item: d[0], count: d[1], durability: d[2] };
      }
    });
  }
}
