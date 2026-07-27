import net from 'node:net';
import os from 'node:os';
import { DEFAULT_P2P_PORT, stripBrackets } from '../address.js';
import type { DeviceIdentity } from '../p2p/identity.js';
import { PeerLink } from '../p2p/link.js';
import type { PeerLinkOptions } from '../p2p/link.js';
import type { DuplexSocket } from '../p2p/socket.js';

/**
 * Node / Electron 端的 TCP 适配。
 * React Native 端用 react-native-tcp-socket 实现同样的接口，
 * 上层的 PeerLink 完全不用改。
 */
export function adaptNodeSocket(socket: net.Socket): DuplexSocket {
  // 聊天是小包高频，禁用 Nagle 避免最多 40ms 的额外延迟
  socket.setNoDelay(true);
  return {
    send: (data) => socket.write(data),
    close: () => socket.destroy(),
    onData: (cb) => socket.on('data', (chunk: Buffer) => cb(new Uint8Array(chunk))),
    onClose: (cb) => socket.on('close', () => cb()),
    onError: (cb) => socket.on('error', (err: Error) => cb(err)),
  };
}

type LinkParams = Omit<PeerLinkOptions, 'socket'>;

export interface TcpPeerServer {
  port: number;
  /** 实际绑定的地址族；主机没开 IPv6 时会退回 IPv4 */
  host: string;
  close: () => Promise<void>;
}

/** 主机 / 容器没有 IPv6 协议栈时 bind :: 会直接报这几个错 */
function isIPv6Unsupported(err: unknown) {
  const code = (err as NodeJS.ErrnoException)?.code;
  return code === 'EAFNOSUPPORT' || code === 'EADDRNOTAVAIL' || code === 'EINVAL';
}

/**
 * 优先绑 ::（双栈，同时收 IPv4 和 IPv6 连接），
 * 主机不支持 IPv6 时自动退回 0.0.0.0，不让服务起不来。
 */
export async function listenDualStack(
  server: net.Server,
  port: number,
  preferredHost?: string,
): Promise<string> {
  const candidates = preferredHost ? [preferredHost] : ['::', '0.0.0.0'];

  let lastError: unknown;
  for (const host of candidates) {
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (err: Error) => reject(err);
        server.once('error', onError);
        server.listen(port, host, () => {
          server.off('error', onError);
          resolve();
        });
      });
      return host;
    } catch (err) {
      lastError = err;
      if (!isIPv6Unsupported(err)) throw err;
      console.warn(`[p2p] 绑定 ${host} 失败（本机可能未启用 IPv6），尝试下一个地址族`);
    }
  }
  throw lastError;
}

/**
 * 监听入站 P2P 连接。
 *
 * 默认绑在 :: 上，Node 的双栈行为会让同一个端口同时接受 IPv4 和 IPv6 连接。
 */
export async function startTcpPeerServer(params: {
  port?: number;
  host?: string;
  makeLinkParams: () => LinkParams;
  onLink: (link: PeerLink) => void;
}): Promise<TcpPeerServer> {
  const server = net.createServer((socket) => {
    const link = new PeerLink({ socket: adaptNodeSocket(socket), ...params.makeLinkParams() });
    params.onLink(link);
  });

  const host = await listenDualStack(server, params.port ?? DEFAULT_P2P_PORT, params.host);

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : (params.port ?? DEFAULT_P2P_PORT);

  return {
    port,
    host,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

/** 主动拨号。IPv6 地址传进来时不要带方括号。 */
export function connectTcpPeer(params: {
  host: string;
  port: number;
  timeoutMs?: number;
  linkParams: LinkParams;
}): Promise<PeerLink> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({
      host: stripBrackets(params.host),
      port: params.port,
      // 有 IPv6 地址就优先走 IPv6：跨网络场景下只有它能通
      family: 0,
    });

    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`连接 ${params.host}:${params.port} 超时`));
    }, params.timeoutMs ?? 8000);

    socket.once('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    socket.once('connect', () => {
      clearTimeout(timeout);
      socket.removeAllListeners('error');
      resolve(new PeerLink({ socket: adaptNodeSocket(socket), ...params.linkParams }));
    });
  });
}

/** 本机所有非回环地址，用来生成配对码 */
export function listLocalAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((n): n is os.NetworkInterfaceInfo => !!n && !n.internal)
    .map((n) => n.address);
}

export type { DeviceIdentity };
