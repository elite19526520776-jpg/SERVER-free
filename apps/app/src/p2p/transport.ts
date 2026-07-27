import type { DuplexSocket, PeerAddress } from '@chat/shared';

/**
 * P2P 传输层的平台抽象。
 *
 * 这个文件是 Web / Electron 的实现，Metro 在 iOS / Android 上会优先选用
 * 同目录下的 transport.native.ts。三端的差别只在这一层，
 * 上面的 PeerManager 和 PeerLink 完全共用。
 */
export interface PeerListener {
  port: number;
  close: () => Promise<void>;
}

export interface DiscoveredPeer {
  /** Bonjour 服务名，通常是 userId */
  name: string;
  addresses: PeerAddress[];
}

export interface P2PTransport {
  /** 当前环境是否支持直连 */
  readonly available: boolean;
  /** 不支持时给用户看的原因 */
  readonly unavailableReason: string;
  /** 是否支持局域网自动发现（Bonjour/mDNS） */
  readonly supportsDiscovery: boolean;

  listen(params: {
    port: number;
    onConnection: (socket: DuplexSocket) => void;
  }): Promise<PeerListener>;

  connect(params: { host: string; port: number; timeoutMs?: number }): Promise<DuplexSocket>;

  /** 本机网卡地址，用于生成配对码 */
  localAddresses(): Promise<string[]>;

  /** 在局域网广播自己 */
  advertise(params: { name: string; port: number }): Promise<void>;
  stopAdvertising(): Promise<void>;

  /** 搜索局域网里的其它设备 */
  startDiscovery(onFound: (peer: DiscoveredPeer) => void): Promise<void>;
  stopDiscovery(): Promise<void>;
}

/**
 * Electron 主进程通过 preload 暴露的 socket 桥。
 * 浏览器里没有这个对象，P2P 直接不可用。
 */
interface DesktopBridge {
  tcp?: {
    listen(port: number, onConnection: (id: string) => void): Promise<number>;
    closeListener(): Promise<void>;
    connect(host: string, port: number, timeoutMs: number): Promise<string>;
    send(id: string, data: number[]): void;
    close(id: string): void;
    onData(cb: (id: string, data: number[]) => void): void;
    onClose(cb: (id: string) => void): void;
    onError(cb: (id: string, message: string) => void): void;
    localAddresses(): Promise<string[]>;
  };
}

function bridge(): DesktopBridge['tcp'] | undefined {
  return (globalThis as any)?.desktop?.tcp;
}

/** 把 Electron 桥上的一条连接包成统一的 DuplexSocket */
function bridgeSocket(id: string, tcp: NonNullable<DesktopBridge['tcp']>): DuplexSocket {
  const dataCbs: ((chunk: Uint8Array) => void)[] = [];
  const closeCbs: (() => void)[] = [];
  const errorCbs: ((err: Error) => void)[] = [];

  tcp.onData((sid, data) => {
    if (sid === id) for (const cb of dataCbs) cb(new Uint8Array(data));
  });
  tcp.onClose((sid) => {
    if (sid === id) for (const cb of closeCbs) cb();
  });
  tcp.onError((sid, message) => {
    if (sid === id) for (const cb of errorCbs) cb(new Error(message));
  });

  return {
    send: (data) => tcp.send(id, Array.from(data)),
    close: () => tcp.close(id),
    onData: (cb) => dataCbs.push(cb),
    onClose: (cb) => closeCbs.push(cb),
    onError: (cb) => errorCbs.push(cb),
  };
}

class WebTransport implements P2PTransport {
  get available() {
    return !!bridge();
  }

  get unavailableReason() {
    return bridge()
      ? ''
      : '浏览器里无法打开 TCP 连接，P2P 直连只在手机 App 和桌面客户端可用。消息会走服务器。';
  }

  /** Electron 桥当前只做直连，局域网自动发现留给手机端 */
  readonly supportsDiscovery = false;

  async listen(params: { port: number; onConnection: (socket: DuplexSocket) => void }) {
    const tcp = bridge();
    if (!tcp) throw new Error(this.unavailableReason);

    const port = await tcp.listen(params.port, (id) => {
      params.onConnection(bridgeSocket(id, tcp));
    });
    return { port, close: () => tcp.closeListener() };
  }

  async connect(params: { host: string; port: number; timeoutMs?: number }) {
    const tcp = bridge();
    if (!tcp) throw new Error(this.unavailableReason);
    const id = await tcp.connect(params.host, params.port, params.timeoutMs ?? 8000);
    return bridgeSocket(id, tcp);
  }

  async localAddresses() {
    const tcp = bridge();
    return tcp ? tcp.localAddresses() : [];
  }

  async advertise() {
    /* 桌面端暂不广播，靠配对码或服务器下发地址 */
  }
  async stopAdvertising() {}
  async startDiscovery() {}
  async stopDiscovery() {}
}

export const transport: P2PTransport = new WebTransport();
