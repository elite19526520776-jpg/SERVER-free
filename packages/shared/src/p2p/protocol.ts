import type { Message } from '../types.js';

/**
 * 握手完成后在加密通道里传的事件。
 *
 * 和服务器模式的区别：这里没有「服务端」，两边完全对等，
 * 消息 id 由发送方本地生成（前缀 p_，和服务器的 m_ 区分开）。
 */
export type PeerEvent =
  | { t: 'msg'; message: Message }
  | { t: 'ack'; clientId: string; messageId: string }
  | { t: 'typing'; conversationId: string; on: boolean }
  | { t: 'read'; conversationId: string; messageId: string }
  | { t: 'ping' }
  | { t: 'pong' };

/** P2P 消息 id，和服务器下发的 m_ 前缀区分，便于本地识别来源 */
export function newPeerMessageId() {
  const ts = Date.now().toString(36).padStart(9, '0');
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let rand = '';
  for (const b of bytes) rand += b.toString(36);
  return `p_${ts}${rand}`;
}

export function isPeerMessageId(id: string) {
  return id.startsWith('p_');
}
