import { Platform } from 'react-native';
import TcpSocket from 'react-native-tcp-socket';
import Zeroconf from 'react-native-zeroconf';
import type { DuplexSocket, PeerAddress } from '@chat/shared';
import { DEFAULT_P2P_PORT } from '@chat/shared';
import { base64ToBytes, bytesToBase64 } from './base64';
import type { DiscoveredPeer, P2PTransport, PeerListener } from './transport';

/** Bonjour 服务类型；iOS 需要在 Info.plist 的 NSBonjourServices 里声明同名条目 */
export const BONJOUR_SERVICE_TYPE = 'chatapp';
const BONJOUR_PROTOCOL = 'tcp';
const BONJOUR_DOMAIN = 'local.';

/**
 * 原生桥传回来的可能是 Buffer（polyfill）、Uint8Array，
 * 或者设过 encoding 后的 base64 字符串，这里统一收敛成字节数组。
 */
function toBytes(chunk: unknown): Uint8Array {
  if (chunk instanceof Uint8Array) return chunk;
  if (typeof chunk === 'string') return base64ToBytes(chunk);
  if (chunk && typeof chunk === 'object' && 'length' in (chunk as any)) {
    return Uint8Array.from(chunk as ArrayLike<number>);
  }
  return new Uint8Array(0);
}

function adaptSocket(socket: any): DuplexSocket {
  // 聊天是小包高频，关掉 Nagle 省掉最多 40ms 延迟
  socket.setNoDelay?.(true);
  return {
    // RN 里没有全局 Buffer，走 base64 编码把二进制交给原生层
    send: (data) => socket.write(bytesToBase64(data), 'base64'),
    close: () => socket.destroy(),
    onData: (cb) => socket.on('data', (chunk: unknown) => cb(toBytes(chunk))),
    onClose: (cb) => socket.on('close', () => cb()),
    onError: (cb) => socket.on('error', (err: Error) => cb(err)),
  };
}

/**
 * iOS / Android 的直连实现。
 *
 * - TCP：react-native-tcp-socket（原生 socket，Expo Go 里没有，必须用 dev build）
 * - 局域网发现：react-native-zeroconf（iOS 走 NSNetService，Android 走 NsdManager）
 *
 * iOS 额外要求（app.json 里已配好）：
 *   NSLocalNetworkUsageDescription + NSBonjourServices
 */
class NativeTransport implements P2PTransport {
  readonly available = true;
  readonly unavailableReason = '';
  readonly supportsDiscovery = true;

  private zeroconf: Zeroconf | null = null;
  private advertising = false;
  private scanning = false;

  private zc() {
    if (!this.zeroconf) this.zeroconf = new Zeroconf();
    return this.zeroconf;
  }

  async listen(params: { port: number; onConnection: (socket: DuplexSocket) => void }) {
    return new Promise<PeerListener>((resolve, reject) => {
      const server = TcpSocket.createServer((socket: any) => {
        params.onConnection(adaptSocket(socket));
      });

      server.on('error', reject);
      // 绑 :: 让同一个监听同时接受 IPv4 和 IPv6 连接
      server.listen({ port: params.port, host: '::', reuseAddress: true }, () => {
        server.off?.('error', reject);
        resolve({
          port: params.port,
          close: () =>
            new Promise<void>((done) => {
              try {
                server.close(() => done());
              } catch {
                done();
              }
            }),
        });
      });
    });
  }

  connect(params: { host: string; port: number; timeoutMs?: number }) {
    return new Promise<DuplexSocket>((resolve, reject) => {
      let settled = false;
      const socket: any = TcpSocket.createConnection(
        { host: params.host, port: params.port },
        () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(adaptSocket(socket));
        },
      );

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(new Error(`连接 ${params.host}:${params.port} 超时`));
      }, params.timeoutMs ?? 8000);

      socket.on('error', (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  /**
   * RN 里没有 os.networkInterfaces()。react-native-tcp-socket 只给出
   * 本机 IPv4，公网 IPv6 地址靠 Bonjour 广播出去后由对端解析。
   */
  async localAddresses(): Promise<string[]> {
    const out: string[] = [];
    try {
      const info = await (TcpSocket as any).getLocalIpAddress?.();
      if (typeof info === 'string' && info) out.push(info);
    } catch {
      /* 拿不到就算了，配对码里至少还有 Bonjour 发现的地址 */
    }
    return out;
  }

  async advertise(params: { name: string; port: number }) {
    if (this.advertising) await this.stopAdvertising();
    this.zc().publishService(
      BONJOUR_SERVICE_TYPE,
      BONJOUR_PROTOCOL,
      BONJOUR_DOMAIN,
      params.name,
      params.port,
    );
    this.advertising = true;
  }

  async stopAdvertising() {
    if (!this.advertising) return;
    try {
      this.zc().unpublishService(BONJOUR_SERVICE_TYPE);
    } catch {
      /* 已经停了 */
    }
    this.advertising = false;
  }

  async startDiscovery(onFound: (peer: DiscoveredPeer) => void) {
    if (this.scanning) return;
    const zeroconf = this.zc();

    zeroconf.on('resolved', (service: any) => {
      const addresses: PeerAddress[] = (service?.addresses ?? [])
        .filter((host: unknown): host is string => typeof host === 'string' && !!host)
        .map((host: string) => ({
          host,
          port: service.port ?? DEFAULT_P2P_PORT,
          // 局域网发现到的一律按 lan 处理，公网 IPv6 走配对码那条路
          kind: 'lan' as const,
        }));
      if (!addresses.length) return;
      onFound({ name: service.name ?? '', addresses });
    });

    zeroconf.on('error', (err: unknown) => {
      console.warn('[p2p] 局域网发现出错', err);
    });

    zeroconf.scan(BONJOUR_SERVICE_TYPE, BONJOUR_PROTOCOL, BONJOUR_DOMAIN);
    this.scanning = true;
  }

  async stopDiscovery() {
    if (!this.scanning) return;
    try {
      this.zc().stop();
      this.zc().removeAllListeners?.();
    } catch {
      /* ignore */
    }
    this.scanning = false;
  }
}

export const transport: P2PTransport = new NativeTransport();

/** 安卓 6+ 的 Bonjour 在部分机型上不稳定，UI 上可以据此提示用户改用配对码 */
export const DISCOVERY_RELIABLE = Platform.OS === 'ios';
