/**
 * 客户端与服务端共用的领域模型。
 * 服务端返回的 JSON 结构必须与这里保持一致。
 */
import type { PeerAddress } from './address.js';

export interface User {
  id: string;
  username: string;
  displayName: string;
  /** 头像底色，用 displayName 首字生成占位头像 */
  avatarColor: string;
  createdAt: number;
}

/**
 * 一台已登录设备的 P2P 端点信息。
 * 服务器只保存公钥和地址，不掌握私钥，也看不到 P2P 通道里的内容。
 */
export interface PeerDevice {
  /** ed25519 设备公钥 hex */
  publicKey: string;
  addresses: PeerAddress[];
  updatedAt: number;
}

/** 会话成员的公开信息（会话列表 / 聊天页顶部需要） */
export interface Member extends User {
  lastReadMessageId: string | null;
  /** 对方在线设备的直连端点，用于尝试 P2P；为空表示只能走服务器 */
  devices: PeerDevice[];
}

export type ConversationType = 'direct' | 'group';

export interface Conversation {
  id: string;
  type: ConversationType;
  /** direct 会话为 null，展示时用对方昵称 */
  title: string | null;
  createdAt: number;
  members: Member[];
  lastMessage: Message | null;
  /** 当前登录用户在该会话中的未读条数 */
  unreadCount: number;
}

export type MessageKind = 'text' | 'system';

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  kind: MessageKind;
  body: string;
  createdAt: number;
  /** 客户端生成的幂等 id，用于把乐观消息替换成服务端消息 */
  clientId: string | null;
}

export interface AuthResult {
  token: string;
  user: User;
}

/* ------------------------------------------------------------------ */
/* WebSocket 协议                                                      */
/* ------------------------------------------------------------------ */

/** 客户端 -> 服务端 */
export type ClientEvent =
  | { t: 'send'; conversationId: string; clientId: string; body: string }
  | { t: 'typing'; conversationId: string; on: boolean }
  | { t: 'read'; conversationId: string; messageId: string }
  | { t: 'ping' };

/** 服务端 -> 客户端 */
export type ServerEvent =
  | { t: 'ready'; userId: string; onlineUserIds: string[] }
  | { t: 'message'; message: Message; conversation?: Conversation }
  /** 有人和你新建了会话，直接插进列表，不必重新拉全量 */
  | { t: 'conversation'; conversation: Conversation }
  | { t: 'ack'; clientId: string; message: Message }
  | { t: 'typing'; conversationId: string; userId: string; on: boolean }
  | { t: 'read'; conversationId: string; userId: string; messageId: string }
  | { t: 'presence'; userId: string; online: boolean }
  /** 对方设备的直连地址有变（上线 / 换网络），客户端据此重试 P2P */
  | { t: 'devices'; userId: string; devices: PeerDevice[] }
  | { t: 'pong' }
  | { t: 'error'; code: string; message: string };

/* ------------------------------------------------------------------ */
/* REST 请求体                                                         */
/* ------------------------------------------------------------------ */

export interface RegisterBody {
  username: string;
  password: string;
  displayName: string;
}

export interface LoginBody {
  username: string;
  password: string;
}

export interface ApiErrorShape {
  error: string;
  message: string;
}

export const LIMITS = {
  usernameMin: 3,
  usernameMax: 24,
  passwordMin: 6,
  passwordMax: 128,
  displayNameMax: 32,
  messageMax: 4000,
  messagePageSize: 50,
} as const;

/** 用户名规则：字母开头，可含字母数字下划线 */
export const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{2,23}$/;
