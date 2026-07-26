import type { ClientEvent, ServerEvent } from './types.js';

export type ConnectionState = 'idle' | 'connecting' | 'online' | 'offline';

export interface RealtimeOptions {
  /** REST 的 baseUrl，内部会转换成 ws:// 或 wss:// */
  baseUrl: string;
  getToken: () => string | null | Promise<string | null>;
  onEvent: (event: ServerEvent) => void;
  onStateChange?: (state: ConnectionState) => void;
  /** 注入用（测试 / Node 环境）；不传则用全局 WebSocket */
  webSocketImpl?: typeof WebSocket;
}

const HEARTBEAT_MS = 25_000;
const MAX_BACKOFF_MS = 30_000;

function toWsUrl(baseUrl: string, token: string) {
  const trimmed = baseUrl.replace(/\/+$/, '');
  const wsBase = trimmed.replace(/^http/, 'ws');
  return `${wsBase}/ws?token=${encodeURIComponent(token)}`;
}

/**
 * 带自动重连、心跳和离线发送队列的 WebSocket 客户端。
 *
 * 断线期间调用 send() 的消息会进队列，重连成功后按顺序补发；
 * 消息带 clientId，服务端做幂等，所以重复补发不会产生重复消息。
 */
export class RealtimeClient {
  private opts: RealtimeOptions;
  private ws: WebSocket | null = null;
  private state: ConnectionState = 'idle';
  private queue: ClientEvent[] = [];
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = true;

  constructor(opts: RealtimeOptions) {
    this.opts = opts;
  }

  getState() {
    return this.state;
  }

  setBaseUrl(baseUrl: string) {
    this.opts.baseUrl = baseUrl;
  }

  private setState(next: ConnectionState) {
    if (this.state === next) return;
    this.state = next;
    this.opts.onStateChange?.(next);
  }

  async connect() {
    this.stopped = false;
    if (this.ws || this.state === 'connecting') return;

    const token = await this.opts.getToken();
    if (!token) {
      this.setState('offline');
      return;
    }
    if (this.stopped) return;

    const Impl = this.opts.webSocketImpl ?? (globalThis as any).WebSocket;
    if (!Impl) {
      this.setState('offline');
      return;
    }

    this.setState('connecting');
    let ws: WebSocket;
    try {
      ws = new Impl(toWsUrl(this.opts.baseUrl, token));
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.attempt = 0;
      this.setState('online');
      this.startHeartbeat();
      this.flushQueue();
    };

    ws.onmessage = (ev: MessageEvent) => {
      let parsed: ServerEvent;
      try {
        parsed = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data));
      } catch {
        return;
      }
      if (parsed.t === 'pong') return;
      this.opts.onEvent(parsed);
    };

    ws.onerror = () => {
      // onclose 紧随其后，重连逻辑统一放在 onclose
    };

    ws.onclose = () => {
      this.stopHeartbeat();
      if (this.ws === ws) this.ws = null;
      if (this.stopped) {
        this.setState('idle');
        return;
      }
      this.setState('offline');
      this.scheduleReconnect();
    };
  }

  /** 主动断开（登出 / 应用退到后台），不会触发重连 */
  disconnect() {
    this.stopped = true;
    this.clearReconnect();
    this.stopHeartbeat();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null as any;
      ws.onmessage = null as any;
      ws.onerror = null as any;
      ws.onopen = null as any;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    this.setState('idle');
  }

  /** 清空未发送队列（例如切换账号时） */
  reset() {
    this.queue = [];
    this.attempt = 0;
  }

  send(event: ClientEvent) {
    if (this.ws && this.state === 'online') {
      try {
        this.ws.send(JSON.stringify(event));
        return true;
      } catch {
        /* 落到下面入队 */
      }
    }
    // typing 是瞬时状态，断线时丢弃即可，不必补发
    if (event.t !== 'typing' && event.t !== 'ping') this.queue.push(event);
    return false;
  }

  private flushQueue() {
    if (!this.ws || this.state !== 'online') return;
    const pending = this.queue;
    this.queue = [];
    for (const event of pending) {
      try {
        this.ws.send(JSON.stringify(event));
      } catch {
        this.queue.push(event);
      }
    }
  }

  private scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    // 指数退避 + 抖动，避免服务端重启时所有客户端同时冲上来
    const base = Math.min(1000 * 2 ** this.attempt, MAX_BACKOFF_MS);
    const delay = base / 2 + Math.random() * (base / 2);
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private clearReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.state === 'online') {
        try {
          this.ws.send(JSON.stringify({ t: 'ping' } satisfies ClientEvent));
        } catch {
          /* ignore */
        }
      }
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
