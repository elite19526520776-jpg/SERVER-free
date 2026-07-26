/**
 * 最小双工字节流接口。
 *
 * Node 的 net.Socket、Electron 主进程、react-native-tcp-socket 的 Socket
 * 都能用几行适配到这个接口上，P2P 逻辑本身就不必关心平台差异。
 */
export interface DuplexSocket {
  send(data: Uint8Array): void;
  close(): void;
  onData(cb: (chunk: Uint8Array) => void): void;
  onClose(cb: () => void): void;
  onError(cb: (err: Error) => void): void;
}

const MAX_FRAME_BYTES = 1024 * 1024; // 单帧上限 1MB，防止对端用一个超长长度头把内存吃光

/**
 * 长度前缀分帧：4 字节大端长度 + 负载。
 *
 * TCP 是字节流，不保证一次 data 事件正好对应一条消息，
 * 粘包和拆包都必须自己处理。
 */
export class FrameReader {
  private buffer = new Uint8Array(0);
  private onFrame: (frame: Uint8Array) => void;
  private onFatal: (err: Error) => void;

  constructor(onFrame: (frame: Uint8Array) => void, onFatal: (err: Error) => void) {
    this.onFrame = onFrame;
    this.onFatal = onFatal;
  }

  push(chunk: Uint8Array) {
    const merged = new Uint8Array(this.buffer.length + chunk.length);
    merged.set(this.buffer, 0);
    merged.set(chunk, this.buffer.length);
    this.buffer = merged;

    for (;;) {
      if (this.buffer.length < 4) return;
      const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, 4);
      const length = view.getUint32(0, false);

      if (length > MAX_FRAME_BYTES) {
        this.onFatal(new Error(`帧长度 ${length} 超出上限，断开连接`));
        return;
      }
      if (this.buffer.length < 4 + length) return;

      const frame = this.buffer.slice(4, 4 + length);
      this.buffer = this.buffer.slice(4 + length);
      this.onFrame(frame);
    }
  }
}

export function encodeFrame(payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + payload.length);
  new DataView(out.buffer).setUint32(0, payload.length, false);
  out.set(payload, 4);
  return out;
}
