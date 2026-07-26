import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { config } from './config.js';

export const db = new Database(config.dbFile);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  avatar_color  TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL CHECK (type IN ('direct','group')),
  title      TEXT,
  created_at INTEGER NOT NULL,
  -- 私聊会话两个成员 id 排序后拼接，保证同一对人只有一个会话
  direct_key TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id      TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at            INTEGER NOT NULL,
  last_read_seq        INTEGER NOT NULL DEFAULT 0,
  last_read_message_id TEXT,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  seq             INTEGER PRIMARY KEY AUTOINCREMENT,
  id              TEXT NOT NULL UNIQUE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       TEXT NOT NULL REFERENCES users(id),
  kind            TEXT NOT NULL CHECK (kind IN ('text','system')),
  body            TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  client_id       TEXT
);

CREATE INDEX IF NOT EXISTS idx_messages_conv_seq ON messages(conversation_id, seq);
CREATE INDEX IF NOT EXISTS idx_members_user ON conversation_members(user_id);
-- 同一发送者的同一 clientId 只允许落库一次，断线重发不会产生重复消息
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_idempotency
  ON messages(sender_id, client_id) WHERE client_id IS NOT NULL;
`);

/** 时间有序的短 id：前缀 + 时间戳 base36 + 随机串 */
export function newId(prefix: string) {
  const ts = Date.now().toString(36).padStart(9, '0');
  const rand = crypto.randomBytes(6).toString('base64url');
  return `${prefix}_${ts}${rand}`;
}

/** 私聊会话的唯一键 */
export function directKey(a: string, b: string) {
  return [a, b].sort().join('|');
}

export interface UserRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  avatar_color: string;
  created_at: number;
}

export interface MessageRow {
  seq: number;
  id: string;
  conversation_id: string;
  sender_id: string;
  kind: 'text' | 'system';
  body: string;
  created_at: number;
  client_id: string | null;
}

export interface ConversationRow {
  id: string;
  type: 'direct' | 'group';
  title: string | null;
  created_at: number;
  direct_key: string | null;
}

export interface MemberRow {
  conversation_id: string;
  user_id: string;
  joined_at: number;
  last_read_seq: number;
  last_read_message_id: string | null;
}
