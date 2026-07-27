import type { WebSocket } from 'ws';
import type { ClientEvent, ServerEvent, User } from '@chat/shared';
import { LIMITS } from '@chat/shared';
import {
  createMessage,
  getConversation,
  markRead,
  memberIdsOf,
  StoreError,
} from './store.js';

interface Connection {
  ws: WebSocket;
  user: User;
  alive: boolean;
}

/**
 * 在线连接注册表。同一个账号可以在手机 + 电脑同时在线，
 * 所以一个 userId 对应一组连接。
 */
class Hub {
  private byUser = new Map<string, Set<Connection>>();

  get onlineUserIds() {
    return [...this.byUser.keys()];
  }

  isOnline(userId: string) {
    return this.byUser.has(userId);
  }

  private add(conn: Connection) {
    let set = this.byUser.get(conn.user.id);
    if (!set) {
      set = new Set();
      this.byUser.set(conn.user.id, set);
    }
    const wasOffline = set.size === 0;
    set.add(conn);
    return wasOffline;
  }

  private remove(conn: Connection) {
    const set = this.byUser.get(conn.user.id);
    if (!set) return false;
    set.delete(conn);
    if (set.size === 0) {
      this.byUser.delete(conn.user.id);
      return true; // 该用户彻底离线
    }
    return false;
  }

  sendTo(userId: string, event: ServerEvent) {
    const set = this.byUser.get(userId);
    if (!set) return;
    const payload = JSON.stringify(event);
    for (const conn of set) {
      if (conn.ws.readyState === conn.ws.OPEN) conn.ws.send(payload);
    }
  }

  broadcast(userIds: Iterable<string>, event: ServerEvent, exceptUserId?: string) {
    for (const id of userIds) {
      if (id === exceptUserId) continue;
      this.sendTo(id, event);
    }
  }

  /** 把上线/下线状态推给所有和他有会话往来的人 */
  private broadcastPresence(user: User, online: boolean) {
    const peers = new Set<string>();
    for (const otherId of this.byUser.keys()) {
      if (otherId !== user.id) peers.add(otherId);
    }
    this.broadcast(peers, { t: 'presence', userId: user.id, online });
  }

  handleConnection(ws: WebSocket, user: User) {
    const conn: Connection = { ws, user, alive: true };
    const cameOnline = this.add(conn);

    const ready: ServerEvent = {
      t: 'ready',
      userId: user.id,
      onlineUserIds: this.onlineUserIds,
    };
    ws.send(JSON.stringify(ready));
    if (cameOnline) this.broadcastPresence(user, true);

    ws.on('pong', () => {
      conn.alive = true;
    });

    ws.on('message', (raw) => {
      let event: ClientEvent;
      try {
        event = JSON.parse(raw.toString());
      } catch {
        this.replyError(ws, 'bad_payload', '消息格式错误');
        return;
      }
      try {
        this.handleEvent(conn, event);
      } catch (err) {
        if (err instanceof StoreError) {
          this.replyError(ws, err.code, err.message);
        } else {
          console.error('[ws] 处理事件失败', err);
          this.replyError(ws, 'internal_error', '服务器内部错误');
        }
      }
    });

    ws.on('close', () => {
      const wentOffline = this.remove(conn);
      if (wentOffline) this.broadcastPresence(user, false);
    });

    ws.on('error', () => {
      const wentOffline = this.remove(conn);
      if (wentOffline) this.broadcastPresence(user, false);
    });
  }

  private replyError(ws: WebSocket, code: string, message: string) {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ t: 'error', code, message } satisfies ServerEvent));
    }
  }

  private handleEvent(conn: Connection, event: ClientEvent) {
    switch (event.t) {
      case 'ping': {
        conn.ws.send(JSON.stringify({ t: 'pong' } satisfies ServerEvent));
        return;
      }

      case 'send': {
        if (typeof event.body !== 'string' || typeof event.conversationId !== 'string') {
          throw new StoreError(400, 'bad_payload', '参数不完整');
        }
        if (event.body.length > LIMITS.messageMax) {
          throw new StoreError(400, 'body_too_long', '消息太长了');
        }
        const { message } = createMessage({
          conversationId: event.conversationId,
          senderId: conn.user.id,
          body: event.body,
          clientId: event.clientId ?? null,
        });

        // 先给发送方回执，让本地的“发送中”气泡尽快落定
        conn.ws.send(
          JSON.stringify({ t: 'ack', clientId: event.clientId, message } satisfies ServerEvent),
        );

        const members = memberIdsOf(event.conversationId);
        for (const memberId of members) {
          // 附带会话快照，接收方即使还没有这个会话也能直接插进列表
          const conversation = this.isOnline(memberId)
            ? getConversation(event.conversationId, memberId)
            : undefined;
          this.sendTo(memberId, { t: 'message', message, conversation });
        }
        return;
      }

      case 'typing': {
        const members = memberIdsOf(event.conversationId);
        if (!members.includes(conn.user.id)) return;
        this.broadcast(
          members,
          {
            t: 'typing',
            conversationId: event.conversationId,
            userId: conn.user.id,
            on: !!event.on,
          },
          conn.user.id,
        );
        return;
      }

      case 'read': {
        markRead(event.conversationId, conn.user.id, event.messageId);
        const members = memberIdsOf(event.conversationId);
        this.broadcast(members, {
          t: 'read',
          conversationId: event.conversationId,
          userId: conn.user.id,
          messageId: event.messageId,
        });
        return;
      }

      default: {
        this.replyError(conn.ws, 'unknown_event', '未知的事件类型');
      }
    }
  }

  /** 定期 ping，回收半开连接（手机切后台/断网时很常见） */
  startHeartbeat(intervalMs = 30_000) {
    const timer = setInterval(() => {
      for (const set of this.byUser.values()) {
        for (const conn of set) {
          if (!conn.alive) {
            conn.ws.terminate();
            continue;
          }
          conn.alive = false;
          try {
            conn.ws.ping();
          } catch {
            /* ignore */
          }
        }
      }
    }, intervalMs);
    timer.unref?.();
    return timer;
  }
}

export const hub = new Hub();
