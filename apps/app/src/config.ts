import Constants from 'expo-constants';
import { Platform } from 'react-native';

const DEFAULT_PORT = 4000;

/**
 * 猜一个默认的服务器地址，尽量让「装完就能连上」：
 *
 * - Expo Go / 开发构建跑在真机上时，从 Metro 的 hostUri 里取电脑的局域网 IP
 * - 安卓模拟器访问宿主机要用 10.0.2.2
 * - 其它情况（iOS 模拟器、Electron、浏览器）用 localhost
 *
 * 用户可以在「我 → 服务器地址」里随时改，改完存本地。
 */
export function guessServerUrl(): string {
  const envUrl = process.env.EXPO_PUBLIC_SERVER_URL;
  if (envUrl) return envUrl;

  if (Platform.OS === 'web') {
    // Electron 打包后跑在 file:// 下，location.hostname 为空，退回 localhost
    if (typeof location !== 'undefined' && location.hostname && location.protocol.startsWith('http')) {
      return `${location.protocol}//${location.hostname}:${DEFAULT_PORT}`;
    }
    return `http://localhost:${DEFAULT_PORT}`;
  }

  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)?.debuggerHost;
  const host = hostUri?.split(':')[0];
  if (host && host !== 'localhost' && host !== '127.0.0.1') {
    return `http://${host}:${DEFAULT_PORT}`;
  }

  if (Platform.OS === 'android') return `http://10.0.2.2:${DEFAULT_PORT}`;
  return `http://localhost:${DEFAULT_PORT}`;
}

/** 用户手输的地址做一下容错：补协议、去尾部斜杠、没写端口时补默认端口 */
export function normalizeServerUrl(input: string): string {
  let value = input.trim();
  if (!value) return value;
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
  value = value.replace(/\/+$/, '');
  try {
    const url = new URL(value);
    if (!url.port && url.hostname !== 'localhost' && /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) {
      url.port = String(DEFAULT_PORT);
    }
    return url.toString().replace(/\/+$/, '');
  } catch {
    return value;
  }
}
