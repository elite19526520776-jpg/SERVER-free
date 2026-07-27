import { Handshake, SecureChannel, type AuthFrame, type HelloFrame, type PeerInfo } from './handshake.js';
import type { DeviceIdentity } from './identity.js';
import type { PeerEvent } from './protocol.js';
import { encodeFrame, FrameReader, type DuplexSocket } from './socket.js';

export type LinkState = 'handshaking' | 'open' | 'closed';

export interface PeerLinkOptions {
  socket: DuplexSocket;
  identity: DeviceIdentity;
  self: {
    userId: string;
    username: string;
    displayName: string;
    avatarColor: string;
  };
  /** 已知的对端设备公钥；主动拨号时应当传，能防中间人 */
  expectedPeerIdPub?: string | null;
  onOpen?: (peer: PeerInfo) => void;
  onEvent?: (event: PeerEvent, peer: PeerInfo) => void;
  onClose?: (reason: string) => void;
  /** 握手超时（毫秒），防止对端连上不说话把连接占住 */
  handshakeTimeoutMs?: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * 一条点对点连接。
 *
 * 生命周期：建立字节流 -> 双向认证握手 -> 加密通道收发事件 -> 关闭。
 * 主动连接方和被动接受方用的是同一个类，行为对称。
 */
export class PeerLink {
  private opts: PeerLinkOptions;
  private socket: DuplexSocket;
  private handshake: Handshake;
  private channel: SecureChannel | null = null;
  private reader: FrameReader;
  private state: LinkState = 'handshaking';
  private sentAuth = false;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: PeerLinkOptions) {
    this.opts = opts;
    this.socket = opts.socket;
    this.handshake = new Handshake({
      identity: opts.identity,
      self: opts.self,
      expectedPeerIdPub: opts.expectedPeerIdPub,
    });

    this.reader = new FrameReader(
      (frame) => this.handleFrame(frame),
      (err) => this.fail(err.message),
    );

    this.socket.onData((chunk) => this.reader.push(chunk));
    this.socket.onClose(() => this.finish('对端关闭了连接'));
    this.socket.onError((err) => this.fail(err.message));

    const timeout = opts.handshakeTimeoutMs ?? 10_000;
    this.timeoutTimer = setTimeout(() => {
      if (this.state === 'handshaking') this.fail('握手超时');
    }, timeout);

    // 两端都在连接建立后立刻发 hello，不分主被动
    this.writeRaw(encoder.encode(JSON.stringify(this.handshake.hello)));
  }

  get linkState() {
    return this.state;
  }

  get peer(): PeerInfo | null {
    return this.handshake.peer;
  }

  private writeRaw(payload: Uint8Array) {
    try {
      this.socket.send(encodeFrame(payload));
    } catch (err) {
      this.fail(err instanceof Error ? err.message : String(err));
    }
  }

  private handleFrame(frame: Uint8Array) {
    if (this.state === 'closed') return;

    try {
      if (this.state === 'handshaking') {
        const parsed = JSON.parse(decoder.decode(frame)) as HelloFrame | AuthFrame;

        if (parsed.t === 'hello') {
          const auth = this.handshake.receiveHello(parsed);
          this.writeRaw(encoder.encode(JSON.stringify(auth)));
          this.sentAuth = true;
          return;
        }

        if (parsed.t === 'auth') {
          if (!this.sentAuth) {
            // 对方的 auth 比 hello 先到达是不可能的（同一条 TCP 流有序），
            // 出现说明对端实现有问题
            throw new Error('收到 auth 但还没处理对方的 hello');
          }
          this.handshake.receiveAuth(parsed);
          this.openChannel();
          return;
        }

        throw new Error('握手阶段收到未知帧');
      }

      // 已建立加密通道
      if (!this.channel) throw new Error('加密通道未就绪');
      const event = JSON.parse(this.channel.decrypt(frame)) as PeerEvent;

      if (event.t === 'ping') {
        this.send({ t: 'pong' });
        return;
      }
      if (event.t === 'pong') return;

      this.opts.onEvent?.(event, this.handshake.peer!);
    } catch (err) {
      this.fail(err instanceof Error ? err.message : String(err));
    }
  }

  private openChannel() {
    if (!this.handshake.done) return;
    this.channel = new SecureChannel(this.handshake.sessionKeys);
    this.state = 'open';
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
    this.opts.onOpen?.(this.handshake.peer!);
  }

  /** 发送一个事件；连接没开通返回 false，调用方自行决定是否回落到服务器 */
  send(event: PeerEvent): boolean {
    if (this.state !== 'open' || !this.channel) return false;
    try {
      this.writeRaw(this.channel.encrypt(JSON.stringify(event)));
      return true;
    } catch {
      return false;
    }
  }

  close(reason = '本机主动关闭') {
    this.finish(reason);
  }

  private fail(reason: string) {
    this.finish(reason);
  }

  private finish(reason: string) {
    if (this.state === 'closed') return;
    this.state = 'closed';
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
    try {
      this.socket.close();
    } catch {
      /* 已经断了就算了 */
    }
    this.opts.onClose?.(reason);
  }
}
