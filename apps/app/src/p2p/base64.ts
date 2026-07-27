const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const LOOKUP = (() => {
  const table = new Uint8Array(256).fill(255);
  for (let i = 0; i < ALPHABET.length; i += 1) table[ALPHABET.charCodeAt(i)] = i;
  return table;
})();

/**
 * 手写 base64，不依赖 Buffer 也不依赖 btoa/atob。
 *
 * React Native（Hermes）里没有全局 Buffer，btoa/atob 在部分版本上也缺失，
 * 而 react-native-tcp-socket 的 write 支持 'base64' 编码，
 * 所以二进制帧统一按 base64 过一遍原生桥。
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63] + ALPHABET[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + '==';
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63] + '=';
  }
  return out;
}

export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const size = Math.floor((clean.length * 3) / 4) - padding;
  const out = new Uint8Array(Math.max(size, 0));

  let outIndex = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = LOOKUP[clean.charCodeAt(i)];
    const b = LOOKUP[clean.charCodeAt(i + 1)];
    const c = LOOKUP[clean.charCodeAt(i + 2)];
    const d = LOOKUP[clean.charCodeAt(i + 3)];

    const n = (a << 18) | (b << 12) | ((c === 255 ? 0 : c) << 6) | (d === 255 ? 0 : d);
    if (outIndex < out.length) out[outIndex++] = (n >> 16) & 255;
    if (outIndex < out.length) out[outIndex++] = (n >> 8) & 255;
    if (outIndex < out.length) out[outIndex++] = n & 255;
  }
  return out;
}
