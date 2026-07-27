export const DEFAULT_SERVER_PORT = 4000;
export const DEFAULT_P2P_PORT = 4310;

export type AddressKind = 'lan' | 'ipv6';

/** 对端可尝试连接的一个地址 */
export interface PeerAddress {
  host: string;
  port: number;
  /** lan = 局域网内可达；ipv6 = 公网 IPv6，跨网络时用 */
  kind: AddressKind;
}

/** 粗判是不是 IPv6 字面量（含冒号且不是 host:port 形式） */
export function isIPv6Literal(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, '');
  if (!bare.includes(':')) return false;
  // host:port 只有一个冒号，IPv6 至少两个
  return (bare.match(/:/g) ?? []).length >= 2;
}

/** IPv6 在 URL 里必须加方括号，否则冒号会被当成端口分隔符 */
export function bracketHost(host: string): string {
  if (isIPv6Literal(host) && !host.startsWith('[')) return `[${host}]`;
  return host;
}

export function stripBrackets(host: string): string {
  return host.replace(/^\[|\]$/g, '');
}

export function formatHostPort(host: string, port: number): string {
  return `${bracketHost(host)}:${port}`;
}

/**
 * IPv6 地址常带 scope id（如 fe80::1%en0），链路本地地址离开本机就没意义，
 * 交换给对端之前要过滤掉。
 */
export function isUsableRemoteAddress(host: string): boolean {
  const bare = stripBrackets(host).toLowerCase();
  if (!bare) return false;
  if (bare === '127.0.0.1' || bare === '::1') return false;
  if (bare.startsWith('fe80:') || bare.includes('%')) return false; // 链路本地
  if (bare.startsWith('169.254.')) return false; // IPv4 link-local
  return true;
}

/** 全局可路由的 IPv6（不是唯一本地地址 fc00::/7，也不是链路本地） */
export function isGlobalIPv6(host: string): boolean {
  const bare = stripBrackets(host).toLowerCase();
  if (!isIPv6Literal(bare)) return false;
  if (bare === '::1' || bare.startsWith('fe80:') || bare.includes('%')) return false;
  const firstByte = Number.parseInt(bare.split(':')[0].padStart(4, '0').slice(0, 2), 16);
  if (Number.isNaN(firstByte)) return false;
  return (firstByte & 0xfe) !== 0xfc; // 排除 fc00::/7
}

export function isPrivateIPv4(host: string): boolean {
  const bare = stripBrackets(host);
  return (
    /^10\./.test(bare) ||
    /^192\.168\./.test(bare) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(bare)
  );
}

/**
 * 把用户手输的服务器地址补全成合法 URL。
 * 支持 IPv6：`::1:4000` 这种歧义写法要求用户写成 `[::1]:4000`，
 * 但裸 IPv6（不带端口）会自动加方括号和默认端口。
 */
export function normalizeServerUrl(input: string, defaultPort = DEFAULT_SERVER_PORT): string {
  let value = input.trim();
  if (!value) return value;

  // 裸 IPv6 字面量：既没有协议头，也没有方括号
  if (!/^https?:\/\//i.test(value) && !value.startsWith('[') && isIPv6Literal(value)) {
    value = `http://[${value}]:${defaultPort}`;
  } else if (!/^https?:\/\//i.test(value)) {
    value = `http://${value}`;
  }
  value = value.replace(/\/+$/, '');

  try {
    const url = new URL(value);
    if (!url.port) {
      const bare = stripBrackets(url.hostname);
      // 明确写了 https 的按标准端口走，其余（IP、局域网主机名）补默认端口
      const looksLikeIp = /^\d+\.\d+\.\d+\.\d+$/.test(bare) || isIPv6Literal(bare);
      if (looksLikeIp || url.protocol === 'http:') url.port = String(defaultPort);
    }
    return url.toString().replace(/\/+$/, '');
  } catch {
    return value;
  }
}

/** http(s):// -> ws(s)://，IPv6 的方括号原样保留 */
export function httpToWsUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '').replace(/^http/i, 'ws');
}
