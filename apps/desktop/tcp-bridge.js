const net = require('node:net');
const os = require('node:os');
const { ipcMain } = require('electron');

/**
 * 把主进程的 TCP 能力桥给渲染进程。
 *
 * 渲染进程跑的是和手机端同一份 React Native Web 代码，本身开不了 socket，
 * 所以 P2P 直连的实际 socket 都在主进程里，渲染进程只通过 id 引用它们。
 */
function installTcpBridge(getWindow) {
  /** @type {Map<string, net.Socket>} */
  const sockets = new Map();
  /** @type {net.Server | null} */
  let server = null;
  let nextId = 1;

  function emit(channel, ...args) {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
  }

  function track(socket) {
    const id = `s${nextId++}`;
    sockets.set(id, socket);
    socket.setNoDelay(true);

    socket.on('data', (chunk) => emit('tcp:data', id, Array.from(chunk)));
    socket.on('close', () => {
      sockets.delete(id);
      emit('tcp:close', id);
    });
    socket.on('error', (err) => emit('tcp:error', id, err.message));

    return id;
  }

  ipcMain.handle('tcp:listen', async (_event, port) => {
    if (server) await new Promise((resolve) => server.close(resolve));

    server = net.createServer((socket) => {
      const id = track(socket);
      emit('tcp:connection', id);
    });

    // 先试双栈，主机没开 IPv6 就退回 IPv4，别让 P2P 直接不可用
    const hosts = ['::', '0.0.0.0'];
    let lastError;
    for (const host of hosts) {
      try {
        await new Promise((resolve, reject) => {
          const onError = (err) => reject(err);
          server.once('error', onError);
          server.listen(port, host, () => {
            server.off('error', onError);
            resolve();
          });
        });
        return server.address().port;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError ?? new Error('无法监听 P2P 端口');
  });

  ipcMain.handle('tcp:closeListener', async () => {
    if (!server) return;
    await new Promise((resolve) => server.close(resolve));
    server = null;
  });

  ipcMain.handle('tcp:connect', (_event, host, port, timeoutMs) => {
    return new Promise((resolve, reject) => {
      // IPv6 地址从渲染进程传过来时可能带方括号，net 不接受
      const target = String(host).replace(/^\[|\]$/g, '');
      const socket = net.createConnection({ host: target, port });

      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`连接 ${host}:${port} 超时`));
      }, timeoutMs ?? 8000);

      socket.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      socket.once('connect', () => {
        clearTimeout(timer);
        socket.removeAllListeners('error');
        resolve(track(socket));
      });
    });
  });

  ipcMain.on('tcp:send', (_event, id, data) => {
    const socket = sockets.get(id);
    if (socket && !socket.destroyed) socket.write(Buffer.from(data));
  });

  ipcMain.on('tcp:close', (_event, id) => {
    sockets.get(id)?.destroy();
    sockets.delete(id);
  });

  ipcMain.handle('tcp:localAddresses', () =>
    Object.values(os.networkInterfaces())
      .flat()
      .filter((n) => n && !n.internal)
      .map((n) => n.address),
  );

  return {
    dispose: async () => {
      for (const socket of sockets.values()) socket.destroy();
      sockets.clear();
      if (server) await new Promise((resolve) => server.close(resolve));
      server = null;
    },
  };
}

module.exports = { installTcpBridge };
