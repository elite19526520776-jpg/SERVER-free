import {
  collectPeerAddresses,
  createDeviceIdentity,
  DEFAULT_P2P_PORT,
  PeerLink,
  type DeviceIdentity,
  type Member,
  type PeerAddress,
  type PeerDevice,
  type PeerEvent,
  type PeerInfo,
  type User,
} from '@chat/shared';
import { storage } from '../storage';
import { transport, type DiscoveredPeer } from './transport';

export type PeerStatus = 'offline' | 'connecting' | 'direct';

export interface PeerState {
  userId: string;
  status: PeerStatus;
  /** 走的是局域网还是公网 IPv6，UI 上给用户看 */
  route: 'lan' | 'ipv6' | null;
  peerIdPub: string | null;
  lastError: string | null;
}

interface ManagerCallbacks {
  onEvent: (event: PeerEvent, peer: PeerInfo) => void;
  onStateChange: (states: Record<string, PeerState>) => void;
}

const RETRY_BASE_MS = 3000;
const RETRY_MAX_MS = 60_000;

/**
 * P2P 连接管理器。
 *
 * 职责：维护设备身份、监听入站连接、在局域网广播和发现、
 * 对已知好友发起直连，并把连上的链路按 userId 索引起来供上层发消息。
 *
 * 上层（ChatContext）只需要问一句「这个人现在能直连吗」，
 * 能就走 P2P，不能就回落到服务器。
 */
export class PeerManager {
  private identity: DeviceIdentity | null = null;
  private self: User | null = null;
  private callbacks: ManagerCallbacks;

  private listener: { port: number; close: () => Promise<void> } | null = null;
  private links = new Map<string, PeerLink>();
  private states = new Map<string, PeerState>();
  /** userId -> 已知的可尝试地址（来自服务器下发或局域网发现） */
  private known = new Map<string, { devices: PeerDevice[]; addrs: PeerAddress[] }>();
  private pinnedKeys: Record<string, string> = {};
  private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private retryAttempts = new Map<string, number>();
  private dialing = new Set<string>();
  private started = false;

  constructor(callbacks: ManagerCallbacks) {
    this.callbacks = callbacks;
  }

  get deviceIdentity() {
    return this.identity;
  }

  get listeningPort() {
    return this.listener?.port ?? null;
  }

  get transportAvailable() {
    return transport.available;
  }

  get transportUnavailableReason() {
    return transport.unavailableReason;
  }

  getState(userId: string): PeerState {
    return (
      this.states.get(userId) ?? {
        userId,
        status: 'offline',
        route: null,
        peerIdPub: null,
        lastError: null,
      }
    );
  }

  snapshot(): Record<string, PeerState> {
    const out: Record<string, PeerState> = {};
    for (const [userId, state] of this.states) out[userId] = state;
    return out;
  }

  private setState(userId: string, patch: Partial<PeerState>) {
    const next = { ...this.getState(userId), ...patch, userId };
    this.states.set(userId, next);
    this.callbacks.onStateChange(this.snapshot());
  }

  /** 读出（或首次生成）本设备的长期密钥 */
  async ensureIdentity(): Promise<DeviceIdentity> {
    if (this.identity) return this.identity;
    let identity = await storage.getDeviceIdentity();
    if (!identity?.secretKey || !identity?.publicKey) {
      identity = createDeviceIdentity();
      await storage.setDeviceIdentity(identity);
    }
    this.identity = identity;
    return identity;
  }

  /**
   * 启动：监听入站 + 局域网广播和发现。
   * 返回本机可对外公布的地址列表，调用方拿去注册到服务器 / 生成配对码。
   */
  async start(self: User): Promise<PeerAddress[]> {
    this.self = self;
    if (!transport.available) return [];
    if (this.started) return this.localPeerAddresses();

    await this.ensureIdentity();
    this.pinnedKeys = await storage.getPinnedKeys();

    try {
      this.listener = await transport.listen({
        port: DEFAULT_P2P_PORT,
        onConnection: (socket) => this.acceptInbound(socket),
      });
    } catch (err) {
      // 端口被占用等情况下退化成「只出不进」：仍能主动连别人
      console.warn('[p2p] 监听失败，只能主动外连', err);
    }

    this.started = true;

    if (transport.supportsDiscovery && this.listener) {
      try {
        await transport.advertise({ name: self.id, port: this.listener.port });
        await transport.startDiscovery((peer) => this.onDiscovered(peer));
      } catch (err) {
        console.warn('[p2p] 局域网发现启动失败', err);
      }
    }

    return this.localPeerAddresses();
  }

  async localPeerAddresses(): Promise<PeerAddress[]> {
    if (!this.listener) return [];
    const raw = await transport.localAddresses();
    return collectPeerAddresses(raw, this.listener.port);
  }

  async stop() {
    this.started = false;
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
    this.retryAttempts.clear();

    for (const link of this.links.values()) link.close('本机下线');
    this.links.clear();
    this.states.clear();
    this.known.clear();
    this.dialing.clear();

    await transport.stopDiscovery().catch(() => {});
    await transport.stopAdvertising().catch(() => {});
    await this.listener?.close().catch(() => {});
    this.listener = null;
    this.callbacks.onStateChange({});
  }

  /* ---------------------------------------------------------------- */
  /* 对端信息                                                          */
  /* ---------------------------------------------------------------- */

  /** 从会话成员里吸收好友的设备端点，并尝试直连 */
  syncPeers(members: Member[]) {
    if (!transport.available || !this.self) return;

    for (const member of members) {
      if (member.id === this.self.id) continue;
      const entry = this.known.get(member.id) ?? { devices: [], addrs: [] };
      entry.devices = member.devices;
      this.known.set(member.id, entry);

      if (member.devices.length) void this.ensureLink(member.id);
    }
  }

  /** 扫码配对：记住对方公钥（后续握手会校验），并立刻尝试连接 */
  async pairWith(params: {
    userId: string;
    idPub: string;
    addrs: PeerAddress[];
  }) {
    await storage.pinKey(params.userId, params.idPub);
    this.pinnedKeys[params.userId] = params.idPub;

    const entry = this.known.get(params.userId) ?? { devices: [], addrs: [] };
    entry.addrs = params.addrs;
    this.known.set(params.userId, entry);

    this.retryAttempts.delete(params.userId);
    await this.ensureLink(params.userId);
  }

  private onDiscovered(peer: DiscoveredPeer) {
    // Bonjour 的服务名就是对方的 userId
    if (!peer.name || peer.name === this.self?.id) return;
    const entry = this.known.get(peer.name) ?? { devices: [], addrs: [] };
    // 局域网发现的地址排前面：同网直连延迟最低
    entry.addrs = [...peer.addresses, ...entry.addrs.filter((a) => a.kind !== 'lan')];
    this.known.set(peer.name, entry);
    void this.ensureLink(peer.name);
  }

  /* ---------------------------------------------------------------- */
  /* 连接                                                              */
  /* ---------------------------------------------------------------- */

  private candidatesFor(userId: string): PeerAddress[] {
    const entry = this.known.get(userId);
    if (!entry) return [];
    const fromDevices = entry.devices.flatMap((d) => d.addresses);
    const all = [...entry.addrs, ...fromDevices];

    // 去重，并把局域网地址排前面（同网时延迟低、成功率高）
    const seen = new Set<string>();
    const unique = all.filter((a) => {
      const key = `${a.host}:${a.port}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return unique.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'lan' ? -1 : 1));
  }

  private expectedKeyFor(userId: string): string | null {
    if (this.pinnedKeys[userId]) return this.pinnedKeys[userId];
    const devices = this.known.get(userId)?.devices ?? [];
    // 只有一台设备时可以确定公钥；多台时交给握手结果去匹配
    return devices.length === 1 ? devices[0].publicKey : null;
  }

  private async ensureLink(userId: string) {
    if (!transport.available || !this.self || !this.identity) return;
    if (this.links.has(userId) || this.dialing.has(userId)) return;

    const candidates = this.candidatesFor(userId);
    if (!candidates.length) return;

    this.dialing.add(userId);
    this.setState(userId, { status: 'connecting', lastError: null });

    let lastError = '没有可用地址';
    for (const addr of candidates) {
      try {
        const socket = await transport.connect({
          host: addr.host,
          port: addr.port,
          timeoutMs: addr.kind === 'lan' ? 3000 : 8000,
        });
        const link = this.wrapLink(userId, socket, addr.kind);
        this.dialing.delete(userId);
        void link;
        return;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    this.dialing.delete(userId);
    this.setState(userId, { status: 'offline', route: null, lastError });
    this.scheduleRetry(userId);
  }

  private wrapLink(userId: string, socket: any, route: 'lan' | 'ipv6') {
    const link = new PeerLink({
      socket,
      identity: this.identity!,
      self: {
        userId: this.self!.id,
        username: this.self!.username,
        displayName: this.self!.displayName,
        avatarColor: this.self!.avatarColor,
      },
      expectedPeerIdPub: this.expectedKeyFor(userId),
      onOpen: (peer) => {
        this.adoptLink(peer.userId, link, route, peer);
      },
      onEvent: (event, peer) => this.callbacks.onEvent(event, peer),
      onClose: (reason) => this.dropLink(userId, link, reason),
    });
    return link;
  }

  /** 入站连接：握手前还不知道对方是谁，握手完成后才认领 */
  private acceptInbound(socket: any) {
    if (!this.self || !this.identity) {
      socket.close();
      return;
    }
    const link = new PeerLink({
      socket,
      identity: this.identity,
      self: {
        userId: this.self.id,
        username: this.self.username,
        displayName: this.self.displayName,
        avatarColor: this.self.avatarColor,
      },
      onOpen: (peer) => {
        // 对方声称的身份如果和我们记录的公钥对不上，直接断开
        const pinned = this.pinnedKeys[peer.userId];
        if (pinned && pinned !== peer.idPub) {
          link.close('对端公钥与已配对记录不符');
          return;
        }
        this.adoptLink(peer.userId, link, 'lan', peer);
      },
      onEvent: (event, peer) => this.callbacks.onEvent(event, peer),
      onClose: () => {
        const peerId = link.peer?.userId;
        if (peerId) this.dropLink(peerId, link, '连接已关闭');
      },
    });
  }

  /**
   * 认领一条握手成功的连接。
   *
   * 两端可能同时向对方拨号，导致出现两条连接。
   * 用公钥字典序做确定性的取舍，保证两端留下的是同一条。
   */
  private adoptLink(userId: string, link: PeerLink, route: 'lan' | 'ipv6', peer: PeerInfo) {
    const existing = this.links.get(userId);
    if (existing && existing !== link && existing.linkState === 'open') {
      const keepNew = this.identity!.publicKey < peer.idPub;
      if (keepNew) {
        existing.close('保留新连接，关闭重复链路');
      } else {
        link.close('已有连接，关闭重复链路');
        return;
      }
    }

    this.links.set(userId, link);
    this.retryAttempts.delete(userId);
    const timer = this.retryTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      this.retryTimers.delete(userId);
    }
    this.setState(userId, {
      status: 'direct',
      route,
      peerIdPub: peer.idPub,
      lastError: null,
    });
  }

  private dropLink(userId: string, link: PeerLink, reason: string) {
    if (this.links.get(userId) !== link) return; // 已经被更新的连接替换掉了
    this.links.delete(userId);
    this.setState(userId, { status: 'offline', route: null, lastError: reason });
    this.scheduleRetry(userId);
  }

  private scheduleRetry(userId: string) {
    if (!this.started) return;
    if (this.retryTimers.has(userId)) return;
    if (!this.candidatesFor(userId).length) return;

    const attempt = this.retryAttempts.get(userId) ?? 0;
    this.retryAttempts.set(userId, attempt + 1);
    const base = Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
    const delay = base / 2 + Math.random() * (base / 2);

    this.retryTimers.set(
      userId,
      setTimeout(() => {
        this.retryTimers.delete(userId);
        void this.ensureLink(userId);
      }, delay),
    );
  }

  /* ---------------------------------------------------------------- */
  /* 收发                                                              */
  /* ---------------------------------------------------------------- */

  /** 直连可用就发出去并返回 true；否则返回 false 让上层回落到服务器 */
  send(userId: string, event: PeerEvent): boolean {
    const link = this.links.get(userId);
    if (!link || link.linkState !== 'open') return false;
    return link.send(event);
  }

  isDirect(userId: string) {
    return this.links.get(userId)?.linkState === 'open';
  }
}
