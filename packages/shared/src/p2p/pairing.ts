import {
  isGlobalIPv6,
  isPrivateIPv4,
  isUsableRemoteAddress,
  DEFAULT_P2P_PORT,
  type PeerAddress,
} from '../address.js';
import { fingerprintOf } from './identity.js';

/**
 * 配对信息。没有服务器时，两台设备靠扫二维码 / 粘贴这串码来互相认识：
 * 里面既有对方的设备公钥（用于握手认证），也有可尝试的地址列表。
 */
export interface PairingPayload {
  v: 1;
  userId: string;
  username: string;
  displayName: string;
  avatarColor: string;
  idPub: string;
  addrs: PeerAddress[];
  /** 生成时间，用于提示「这个码是不是太旧了」 */
  ts: number;
}

export const PAIRING_URI_SCHEME = 'chatapp://pair?';

/** 把本机网卡地址整理成对端可以尝试连接的列表 */
export function collectPeerAddresses(
  interfaceAddresses: string[],
  port = DEFAULT_P2P_PORT,
): PeerAddress[] {
  const out: PeerAddress[] = [];
  const seen = new Set<string>();

  for (const raw of interfaceAddresses) {
    const host = raw.trim();
    if (!host || seen.has(host)) continue;
    if (!isUsableRemoteAddress(host)) continue;
    seen.add(host);

    if (isGlobalIPv6(host)) {
      out.push({ host, port, kind: 'ipv6' });
    } else if (isPrivateIPv4(host)) {
      out.push({ host, port, kind: 'lan' });
    }
    // 公网 IPv4 基本都是 NAT 后的地址，对端连不上，直接不放进来
  }

  // 公网 IPv6 排前面：跨网络时只有它有戏，局域网地址留作同网兜底
  return out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'ipv6' ? -1 : 1));
}

function base64UrlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  const base64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : // Node 环境
        Buffer.from(bytes).toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value: string): string {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  if (typeof atob === 'function') {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  return Buffer.from(padded, 'base64').toString('utf8');
}

/** 编码成一串可放进二维码、也能直接复制粘贴的文本 */
export function encodePairingPayload(payload: PairingPayload): string {
  return `${PAIRING_URI_SCHEME}${base64UrlEncode(JSON.stringify(payload))}`;
}

export function decodePairingPayload(input: string): PairingPayload {
  const text = input.trim();
  const body = text.startsWith(PAIRING_URI_SCHEME)
    ? text.slice(PAIRING_URI_SCHEME.length)
    : text;

  let parsed: unknown;
  try {
    parsed = JSON.parse(base64UrlDecode(body));
  } catch {
    throw new Error('配对码格式不正确');
  }

  const p = parsed as Partial<PairingPayload>;
  if (p?.v !== 1 || typeof p.idPub !== 'string' || p.idPub.length !== 64) {
    throw new Error('配对码内容不完整或版本不支持');
  }
  if (!Array.isArray(p.addrs)) throw new Error('配对码里没有可用地址');

  return {
    v: 1,
    userId: String(p.userId ?? ''),
    username: String(p.username ?? ''),
    displayName: String(p.displayName ?? p.username ?? '未知用户'),
    avatarColor: String(p.avatarColor ?? '#3d7dff'),
    idPub: p.idPub,
    addrs: p.addrs.filter(
      (a): a is PeerAddress =>
        !!a && typeof a.host === 'string' && typeof a.port === 'number',
    ),
    ts: Number(p.ts ?? 0),
  };
}

/** 让用户口头核对的短指纹，防止扫到伪造的码 */
export function pairingFingerprint(payload: PairingPayload): string {
  return fingerprintOf(payload.idPub);
}
