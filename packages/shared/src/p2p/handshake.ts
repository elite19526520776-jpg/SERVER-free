import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  bytesToHex,
  createEphemeralKeyPair,
  hexToBytes,
  type DeviceIdentity,
} from './identity.js';

export const P2P_PROTOCOL_VERSION = 1;

/** 握手第一帧：双方同时发，不分先后 */
export interface HelloFrame {
  t: 'hello';
  v: number;
  userId: string;
  username: string;
  displayName: string;
  avatarColor: string;
  /** ed25519 设备公钥 hex */
  idPub: string;
  /** x25519 临时公钥 hex */
  ephPub: string;
  /** 32 字节随机数 hex，防重放 */
  nonce: string;
}

/** 握手第二帧：对握手记录签名，证明自己确实持有 idPub 对应的私钥 */
export interface AuthFrame {
  t: 'auth';
  sig: string;
}

export type HandshakeFrame = HelloFrame | AuthFrame;

export interface PeerInfo {
  userId: string;
  username: string;
  displayName: string;
  avatarColor: string;
  idPub: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function randomNonceHex() {
  const bytes = new Uint8Array(32);
  // RN 里需要 react-native-get-random-values 提供这个 polyfill
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

function canonicalHello(hello: HelloFrame) {
  // 字段顺序固定，两端算出的握手记录才会一致
  return [
    hello.v,
    hello.userId,
    hello.username,
    hello.displayName,
    hello.avatarColor,
    hello.idPub,
    hello.ephPub,
    hello.nonce,
  ].join('');
}

/**
 * 会话密钥。收发用两把不同的密钥，
 * 这样把对方发来的帧原样打回去也不会被自己解开（防反射攻击）。
 */
export interface SessionKeys {
  send: Uint8Array;
  recv: Uint8Array;
}

/**
 * 双向认证的 ECDH 握手。
 *
 * 两端行为完全对称：各自发 hello，收到对方 hello 后算出共享密钥和握手记录，
 * 再各自对握手记录签名发过去。任意一方验签失败就断开。
 *
 * 密钥绑定了完整握手记录，中间人即使转发也无法让两端算出相同的记录。
 */
export class Handshake {
  private identity: DeviceIdentity;
  private ephemeral = createEphemeralKeyPair();
  private myHello: HelloFrame;
  private peerHello: HelloFrame | null = null;
  private transcript: Uint8Array | null = null;
  private keys: SessionKeys | null = null;
  private peerVerified = false;
  /** 由调用方指定的期望对端公钥；不匹配直接拒绝 */
  private expectedPeerIdPub: string | null;

  constructor(params: {
    identity: DeviceIdentity;
    self: Omit<PeerInfo, 'idPub'>;
    expectedPeerIdPub?: string | null;
  }) {
    this.identity = params.identity;
    this.expectedPeerIdPub = params.expectedPeerIdPub ?? null;
    this.myHello = {
      t: 'hello',
      v: P2P_PROTOCOL_VERSION,
      userId: params.self.userId,
      username: params.self.username,
      displayName: params.self.displayName,
      avatarColor: params.self.avatarColor,
      idPub: this.identity.publicKey,
      ephPub: bytesToHex(this.ephemeral.publicKey),
      nonce: randomNonceHex(),
    };
  }

  /** 连接建立后立刻发这一帧 */
  get hello(): HelloFrame {
    return this.myHello;
  }

  get peer(): PeerInfo | null {
    if (!this.peerHello) return null;
    return {
      userId: this.peerHello.userId,
      username: this.peerHello.username,
      displayName: this.peerHello.displayName,
      avatarColor: this.peerHello.avatarColor,
      idPub: this.peerHello.idPub,
    };
  }

  get done() {
    return this.peerVerified && this.keys !== null;
  }

  get sessionKeys(): SessionKeys {
    if (!this.keys) throw new Error('握手尚未完成');
    return this.keys;
  }

  /**
   * 收到对方 hello：派生共享密钥，返回自己要发出的 auth 帧。
   */
  receiveHello(hello: HelloFrame): AuthFrame {
    if (this.peerHello) throw new Error('重复的 hello 帧');
    if (hello.v !== P2P_PROTOCOL_VERSION) {
      throw new Error(`协议版本不匹配：对方 v${hello.v}，本机 v${P2P_PROTOCOL_VERSION}`);
    }
    if (hello.idPub === this.identity.publicKey) {
      throw new Error('对端设备公钥与本机相同，拒绝自连');
    }
    if (this.expectedPeerIdPub && hello.idPub !== this.expectedPeerIdPub) {
      throw new Error('对端设备公钥与预期不符，可能存在中间人');
    }

    this.peerHello = hello;

    const shared = x25519.getSharedSecret(this.ephemeral.secretKey, hexToBytes(hello.ephPub));

    // 按公钥字典序排出固定的 A/B 角色，两端才能对上收发密钥
    const iAmA = this.identity.publicKey < hello.idPub;
    const helloA = iAmA ? this.myHello : hello;
    const helloB = iAmA ? hello : this.myHello;
    this.transcript = sha256(encoder.encode(canonicalHello(helloA) + '' + canonicalHello(helloB)));

    const material = hkdf(sha256, shared, this.transcript, encoder.encode('chatapp-p2p-v1'), 64);
    const keyA = material.slice(0, 32);
    const keyB = material.slice(32, 64);

    this.keys = iAmA ? { send: keyA, recv: keyB } : { send: keyB, recv: keyA };

    return { t: 'auth', sig: bytesToHex(ed25519.sign(this.transcript, hexToBytes(this.identity.secretKey))) };
  }

  /** 收到对方 auth：验签。失败会抛错，调用方应当立刻断开连接。 */
  receiveAuth(auth: AuthFrame) {
    if (!this.peerHello || !this.transcript) throw new Error('还没收到对方 hello');
    const ok = ed25519.verify(
      hexToBytes(auth.sig),
      this.transcript,
      hexToBytes(this.peerHello.idPub),
    );
    if (!ok) throw new Error('对端签名校验失败，拒绝连接');
    this.peerVerified = true;
  }
}

/**
 * 握手完成后的对称加密通道。
 *
 * nonce 用递增计数器（收发各一套），不重复使用，
 * 也就不需要每帧额外传 24 字节随机 nonce。
 */
export class SecureChannel {
  private keys: SessionKeys;
  private sendCounter = 0n;
  private recvCounter = 0n;

  constructor(keys: SessionKeys) {
    this.keys = keys;
  }

  private static nonceOf(counter: bigint) {
    const nonce = new Uint8Array(24);
    new DataView(nonce.buffer).setBigUint64(16, counter, false);
    return nonce;
  }

  encrypt(plaintext: string): Uint8Array {
    const nonce = SecureChannel.nonceOf(this.sendCounter);
    this.sendCounter += 1n;
    return xchacha20poly1305(this.keys.send, nonce).encrypt(encoder.encode(plaintext));
  }

  decrypt(ciphertext: Uint8Array): string {
    const nonce = SecureChannel.nonceOf(this.recvCounter);
    this.recvCounter += 1n;
    // 计数器对不上或内容被改过，解密会直接抛错（Poly1305 认证失败）
    return decoder.decode(xchacha20poly1305(this.keys.recv, nonce).decrypt(ciphertext));
  }
}
