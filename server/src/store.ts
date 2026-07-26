import bcrypt from 'bcryptjs';
import { avatarColorFor, LIMITS } from '@chat/shared';
import type { Conversation, Member, Message, User } from '@chat/shared';
import {
  db,
  directKey,
  newId,
  type ConversationRow,
  type MemberRow,
  type MessageRow,
  type UserRow,
} from './db.js';

export class StoreError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'StoreError';
  }
}

/* ------------------------------------------------------------------ */
/* 映射                                                                */
/* ------------------------------------------------------------------ */

function toUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarColor: row.avatar_color,
    createdAt: row.created_at,
  };
}

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    kind: row.kind,
    body: row.body,
    createdAt: row.created_at,
    clientId: row.client_id,
  };
}

/* ------------------------------------------------------------------ */
/* 用户                                                                */
/* ------------------------------------------------------------------ */

const qUserById = db.prepare<[string], UserRow>('SELECT * FROM users WHERE id = ?');
const qUserByName = db.prepare<[string], UserRow>('SELECT * FROM users WHERE username = ?');

export function findUserById(id: string) {
  const row = qUserById.get(id);
  return row ? toUser(row) : null;
}

export function createUser(username: string, password: string, displayName: string): User {
  if (qUserByName.get(username)) {
    throw new StoreError(409, 'username_taken', '该用户名已被注册');
  }
  const id = newId('u');
  const now = Date.now();
  const row: UserRow = {
    id,
    username,
    display_name: displayName,
    password_hash: bcrypt.hashSync(password, 10),
    avatar_color: avatarColorFor(username),
    created_at: now,
  };
  try {
    db.prepare(
      `INSERT INTO users (id, username, display_name, password_hash, avatar_color, created_at)
       VALUES (@id, @username, @display_name, @password_hash, @avatar_color, @created_at)`,
    ).run(row);
  } catch (err) {
    // UNIQUE 约束是最终防线，防止并发注册同名用户
    if (String(err).includes('UNIQUE')) {
      throw new StoreError(409, 'username_taken', '该用户名已被注册');
    }
    throw err;
  }
  return toUser(row);
}

export function verifyCredentials(username: string, password: string): User {
  const row = qUserByName.get(username);
  // 用户不存在时也跑一次 hash 比较，避免通过响应耗时探测用户是否存在
  const hash = row?.password_hash ?? '$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';
  const ok = bcrypt.compareSync(password, hash);
  if (!row || !ok) {
    throw new StoreError(401, 'bad_credentials', '用户名或密码不正确');
  }
  return toUser(row);
}

/** 按用户名/昵称模糊搜索，排除自己 */
export function searchUsers(selfId: string, q: string): User[] {
  const term = `%${q.trim()}%`;
  const rows = db
    .prepare<[string, string, string], UserRow>(
      `SELECT * FROM users
       WHERE id != ? AND (username LIKE ? OR display_name LIKE ?)
       ORDER BY username LIMIT 20`,
    )
    .all(selfId, term, term);
  return rows.map(toUser);
}

/* ------------------------------------------------------------------ */
/* 会话                                                                */
/* ------------------------------------------------------------------ */

const qConversation = db.prepare<[string], ConversationRow>(
  'SELECT * FROM conversations WHERE id = ?',
);

export function isMember(conversationId: string, userId: string) {
  const row = db
    .prepare<[string, string], { c: number }>(
      'SELECT COUNT(*) AS c FROM conversation_members WHERE conversation_id = ? AND user_id = ?',
    )
    .get(conversationId, userId);
  return (row?.c ?? 0) > 0;
}

export function memberIdsOf(conversationId: string): string[] {
  return db
    .prepare<[string], { user_id: string }>(
      'SELECT user_id FROM conversation_members WHERE conversation_id = ?',
    )
    .all(conversationId)
    .map((r) => r.user_id);
}

function membersOf(conversationId: string): Member[] {
  const rows = db
    .prepare<[string], UserRow & MemberRow>(
      `SELECT u.*, m.last_read_message_id, m.last_read_seq, m.conversation_id, m.joined_at
       FROM conversation_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.conversation_id = ?
       ORDER BY m.joined_at`,
    )
    .all(conversationId);
  return rows.map((row) => ({
    ...toUser(row),
    lastReadMessageId: row.last_read_message_id,
  }));
}

function lastMessageOf(conversationId: string): Message | null {
  const row = db
    .prepare<[string], MessageRow>(
      'SELECT * FROM messages WHERE conversation_id = ? ORDER BY seq DESC LIMIT 1',
    )
    .get(conversationId);
  return row ? toMessage(row) : null;
}

function unreadCountOf(conversationId: string, userId: string) {
  const row = db
    .prepare<[string, string, string], { c: number }>(
      `SELECT COUNT(*) AS c FROM messages
       WHERE conversation_id = ?
         AND sender_id != ?
         AND seq > COALESCE(
           (SELECT last_read_seq FROM conversation_members
            WHERE conversation_id = messages.conversation_id AND user_id = ?), 0)`,
    )
    .get(conversationId, userId, userId);
  return row?.c ?? 0;
}

/** 组装成前端直接可用的 Conversation（含成员、最后一条消息、未读数） */
export function hydrateConversation(row: ConversationRow, viewerId: string): Conversation {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    createdAt: row.created_at,
    members: membersOf(row.id),
    lastMessage: lastMessageOf(row.id),
    unreadCount: unreadCountOf(row.id, viewerId),
  };
}

export function getConversation(id: string, viewerId: string): Conversation {
  const row = qConversation.get(id);
  if (!row) throw new StoreError(404, 'not_found', '会话不存在');
  if (!isMember(id, viewerId)) throw new StoreError(403, 'forbidden', '你不在该会话中');
  return hydrateConversation(row, viewerId);
}

/** 会话列表按最后一条消息时间倒序；没有消息的排在创建时间位置 */
export function listConversations(userId: string): Conversation[] {
  const rows = db
    .prepare<[string], ConversationRow>(
      `SELECT c.* FROM conversations c
       JOIN conversation_members m ON m.conversation_id = c.id
       WHERE m.user_id = ?`,
    )
    .all(userId);

  return rows
    .map((row) => hydrateConversation(row, userId))
    .sort((a, b) => {
      const ta = a.lastMessage?.createdAt ?? a.createdAt;
      const tb = b.lastMessage?.createdAt ?? b.createdAt;
      return tb - ta;
    });
}

/** 打开与某人的私聊，已存在则复用 */
export function openDirectConversation(selfId: string, otherId: string): Conversation {
  if (selfId === otherId) {
    throw new StoreError(400, 'invalid_target', '不能和自己聊天');
  }
  if (!findUserById(otherId)) {
    throw new StoreError(404, 'not_found', '用户不存在');
  }

  const key = directKey(selfId, otherId);
  const existing = db
    .prepare<[string], ConversationRow>('SELECT * FROM conversations WHERE direct_key = ?')
    .get(key);
  if (existing) return hydrateConversation(existing, selfId);

  const id = newId('cv');
  const now = Date.now();
  const create = db.transaction(() => {
    db.prepare(
      `INSERT INTO conversations (id, type, title, created_at, direct_key)
       VALUES (?, 'direct', NULL, ?, ?)`,
    ).run(id, now, key);
    const addMember = db.prepare(
      `INSERT INTO conversation_members (conversation_id, user_id, joined_at)
       VALUES (?, ?, ?)`,
    );
    addMember.run(id, selfId, now);
    addMember.run(id, otherId, now);
  });

  try {
    create();
  } catch (err) {
    // 并发下两端同时开会话，退回读已存在的那条
    const raced = db
      .prepare<[string], ConversationRow>('SELECT * FROM conversations WHERE direct_key = ?')
      .get(key);
    if (raced) return hydrateConversation(raced, selfId);
    throw err;
  }

  const row = qConversation.get(id)!;
  return hydrateConversation(row, selfId);
}

/* ------------------------------------------------------------------ */
/* 消息                                                                */
/* ------------------------------------------------------------------ */

/**
 * 写入一条消息。带 clientId 时是幂等的：
 * 同一发送者重复提交相同 clientId 会直接返回已存在的那条。
 */
export function createMessage(params: {
  conversationId: string;
  senderId: string;
  body: string;
  clientId?: string | null;
}): { message: Message; created: boolean } {
  const { conversationId, senderId, clientId = null } = params;
  const body = params.body.trim();

  if (!body) throw new StoreError(400, 'empty_body', '消息内容不能为空');
  if (body.length > LIMITS.messageMax) {
    throw new StoreError(400, 'body_too_long', `消息长度不能超过 ${LIMITS.messageMax} 字`);
  }
  if (!isMember(conversationId, senderId)) {
    throw new StoreError(403, 'forbidden', '你不在该会话中');
  }

  if (clientId) {
    const dup = db
      .prepare<[string, string], MessageRow>(
        'SELECT * FROM messages WHERE sender_id = ? AND client_id = ?',
      )
      .get(senderId, clientId);
    if (dup) return { message: toMessage(dup), created: false };
  }

  const id = newId('m');
  const now = Date.now();
  try {
    db.prepare(
      `INSERT INTO messages (id, conversation_id, sender_id, kind, body, created_at, client_id)
       VALUES (?, ?, ?, 'text', ?, ?, ?)`,
    ).run(id, conversationId, senderId, body, now, clientId);
  } catch (err) {
    if (clientId && String(err).includes('UNIQUE')) {
      const dup = db
        .prepare<[string, string], MessageRow>(
          'SELECT * FROM messages WHERE sender_id = ? AND client_id = ?',
        )
        .get(senderId, clientId);
      if (dup) return { message: toMessage(dup), created: false };
    }
    throw err;
  }

  // 发送者自己发的消息立即算作已读，避免自己给自己刷未读
  const row = db.prepare<[string], MessageRow>('SELECT * FROM messages WHERE id = ?').get(id)!;
  db.prepare(
    `UPDATE conversation_members SET last_read_seq = ?, last_read_message_id = ?
     WHERE conversation_id = ? AND user_id = ?`,
  ).run(row.seq, id, conversationId, senderId);

  return { message: toMessage(row), created: true };
}

/** 历史消息，返回按时间升序；before 传消息 id 用于向上翻页 */
export function listMessages(
  conversationId: string,
  viewerId: string,
  opts: { before?: string; limit?: number } = {},
): Message[] {
  if (!isMember(conversationId, viewerId)) {
    throw new StoreError(403, 'forbidden', '你不在该会话中');
  }
  const limit = Math.min(Math.max(opts.limit ?? LIMITS.messagePageSize, 1), 100);

  let beforeSeq = Number.MAX_SAFE_INTEGER;
  if (opts.before) {
    const anchor = db
      .prepare<[string], { seq: number }>('SELECT seq FROM messages WHERE id = ?')
      .get(opts.before);
    if (anchor) beforeSeq = anchor.seq;
  }

  const rows = db
    .prepare<[string, number, number], MessageRow>(
      `SELECT * FROM messages
       WHERE conversation_id = ? AND seq < ?
       ORDER BY seq DESC LIMIT ?`,
    )
    .all(conversationId, beforeSeq, limit);

  return rows.reverse().map(toMessage);
}

/** 把已读位置推进到指定消息（只能前进，不能回退） */
export function markRead(conversationId: string, userId: string, messageId: string) {
  if (!isMember(conversationId, userId)) {
    throw new StoreError(403, 'forbidden', '你不在该会话中');
  }
  const anchor = db
    .prepare<[string, string], { seq: number }>(
      'SELECT seq FROM messages WHERE id = ? AND conversation_id = ?',
    )
    .get(messageId, conversationId);
  if (!anchor) throw new StoreError(404, 'not_found', '消息不存在');

  db.prepare(
    `UPDATE conversation_members
     SET last_read_seq = ?, last_read_message_id = ?
     WHERE conversation_id = ? AND user_id = ? AND last_read_seq < ?`,
  ).run(anchor.seq, messageId, conversationId, userId, anchor.seq);
}
