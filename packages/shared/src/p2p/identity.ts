import { ed25519, x25519 } from '@noble/curves/ed25519.js';

/**
 * 设备身份密钥对。首次启动时在设备本地生成，私钥永远不离开设备，
 * 服务器只拿到公钥。P2P 握手靠它做双向认证——否则同一个局域网里
 * 任何人都能伪装成你的好友。
 */
export interface DeviceIdentity {
  /** ed25519 私钥（hex），只存本地 */
  secretKey: string;
  /** ed25519 公钥（hex），可公开，相当于设备指纹 */
  publicKey: string;
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('hex 长度必须为偶数');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error('非法的 hex 字符');
    out[i] = byte;
  }
  return out;
}

export function createDeviceIdentity(): DeviceIdentity {
  const secretKey = ed25519.utils.randomSecretKey();
  return {
    secretKey: bytesToHex(secretKey),
    publicKey: bytesToHex(ed25519.getPublicKey(secretKey)),
  };
}

/** 展示给用户核对的指纹：公钥前 8 字节，四组四位 */
export function fingerprintOf(publicKeyHex: string): string {
  const short = publicKeyHex.slice(0, 16).toUpperCase();
  return short.replace(/(.{4})/g, '$1 ').trim();
}

export interface EphemeralKeyPair {
  secretKey: Uint8Array;
  publicKey: Uint8Array;
}

/** 每次握手都用一对新的 x25519 临时密钥，保证前向保密 */
export function createEphemeralKeyPair(): EphemeralKeyPair {
  const secretKey = x25519.utils.randomSecretKey();
  return { secretKey, publicKey: x25519.getPublicKey(secretKey) };
}
