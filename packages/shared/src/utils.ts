import type { Conversation, Member, Message } from './types.js';

const AVATAR_COLORS = [
  '#2f6df6',
  '#7c4dff',
  '#00897b',
  '#e0533d',
  '#c2185b',
  '#f9a825',
  '#3949ab',
  '#00838f',
];

/** 根据用户名稳定地取一个头像底色，保证各端显示一致 */
export function avatarColorFor(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

/** 占位头像上的字：中文取首字，英文取首字母 */
export function initialsOf(displayName: string) {
  const name = displayName.trim();
  if (!name) return '?';
  const first = name[0];
  if (/[a-zA-Z]/.test(first)) return first.toUpperCase();
  return first;
}

/** direct 会话没有标题，用对方昵称当标题 */
export function conversationTitle(conv: Conversation, selfId: string) {
  if (conv.title) return conv.title;
  const other = conv.members.find((m) => m.id !== selfId);
  return other?.displayName ?? '未知会话';
}

export function conversationPeer(conv: Conversation, selfId: string): Member | undefined {
  if (conv.type !== 'direct') return undefined;
  return conv.members.find((m) => m.id !== selfId);
}

/** 会话列表右上角的时间：今天显示 HH:mm，昨天显示“昨天”，更早显示 M/D */
export function formatListTime(ts: number, now = Date.now()) {
  const d = new Date(ts);
  const today = new Date(now);
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  if (sameDay) return formatClock(ts);

  const yesterday = new Date(now - 24 * 3600 * 1000);
  if (
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()
  ) {
    return '昨天';
  }
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function formatClock(ts: number) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 聊天流里的日期分隔条 */
export function formatDayDivider(ts: number, now = Date.now()) {
  const d = new Date(ts);
  const today = new Date(now);
  const dayDiff = Math.floor(
    (new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() -
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) /
      86_400_000,
  );
  if (dayDiff === 0) return '今天';
  if (dayDiff === 1) return '昨天';
  if (d.getFullYear() === today.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 相邻消息间隔超过 5 分钟才插入日期/时间分隔 */
export function shouldShowDivider(prev: Message | undefined, cur: Message) {
  if (!prev) return true;
  return cur.createdAt - prev.createdAt > 5 * 60 * 1000;
}

/** 会话列表的预览文案 */
export function previewOf(message: Message | null) {
  if (!message) return '还没有消息';
  if (message.kind === 'system') return message.body;
  return message.body.replace(/\s+/g, ' ').slice(0, 60);
}

/** 客户端消息 id：用于乐观发送与服务端幂等去重 */
export function newClientId() {
  const rand = Math.random().toString(36).slice(2, 10);
  return `c_${Date.now().toString(36)}_${rand}`;
}

/** 按 id 去重并按时间升序排列（合并本地缓存与服务端结果时用） */
export function mergeMessages(a: Message[], b: Message[]) {
  const byId = new Map<string, Message>();
  for (const m of a) byId.set(m.id, m);
  for (const m of b) byId.set(m.id, m);
  return [...byId.values()].sort((x, y) => {
    if (x.createdAt !== y.createdAt) return x.createdAt - y.createdAt;
    return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
  });
}
