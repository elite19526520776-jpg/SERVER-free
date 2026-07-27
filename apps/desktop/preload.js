const { contextBridge, ipcRenderer } = require('electron');

/**
 * 渲染进程跑的是和手机端完全一样的 React Native Web 代码，
 * 本身开不了 TCP socket。这里把主进程的 socket 能力桥过去，
 * 桌面端也就能做 P2P 直连，而不必退回服务器中转。
 *
 * 只暴露具体的几个方法，不把 ipcRenderer 整个交出去。
 */
contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },

  tcp: {
    listen: (port, onConnection) => {
      ipcRenderer.removeAllListeners('tcp:connection');
      ipcRenderer.on('tcp:connection', (_event, id) => onConnection(id));
      return ipcRenderer.invoke('tcp:listen', port);
    },
    closeListener: () => ipcRenderer.invoke('tcp:closeListener'),
    connect: (host, port, timeoutMs) => ipcRenderer.invoke('tcp:connect', host, port, timeoutMs),
    send: (id, data) => ipcRenderer.send('tcp:send', id, data),
    close: (id) => ipcRenderer.send('tcp:close', id),
    onData: (cb) => ipcRenderer.on('tcp:data', (_event, id, data) => cb(id, data)),
    onClose: (cb) => ipcRenderer.on('tcp:close', (_event, id) => cb(id)),
    onError: (cb) => ipcRenderer.on('tcp:error', (_event, id, message) => cb(id, message)),
    localAddresses: () => ipcRenderer.invoke('tcp:localAddresses'),
  },
});
