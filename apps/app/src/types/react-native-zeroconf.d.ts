/**
 * react-native-zeroconf 没有自带类型声明，这里补一份最小可用的，
 * 只声明我们实际用到的方法。
 */
declare module 'react-native-zeroconf' {
  export interface ZeroconfService {
    name?: string;
    port?: number;
    host?: string;
    addresses?: string[];
  }

  export default class Zeroconf {
    scan(type: string, protocol: string, domain: string): void;
    stop(): void;
    publishService(
      type: string,
      protocol: string,
      domain: string,
      name: string,
      port: number,
    ): void;
    unpublishService(name: string): void;
    on(event: 'resolved', cb: (service: ZeroconfService) => void): void;
    on(event: 'error', cb: (err: unknown) => void): void;
    on(event: string, cb: (...args: any[]) => void): void;
    removeAllListeners?(): void;
  }
}
