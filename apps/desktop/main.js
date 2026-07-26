const { app, BrowserWindow, Menu, shell, nativeTheme } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

// CHATAPP_USE_BUNDLE=1 可以在未打包的情况下走线上加载路径，
// 用来验证 renderer 产物本身有没有问题，不用每次都跑一遍 electron-builder。
const isDev = !app.isPackaged && process.env.CHATAPP_USE_BUNDLE !== '1';
/** 开发模式下直接连 Expo 的 web dev server，可以热更新 */
const DEV_URL = process.env.EXPO_DEV_URL || 'http://localhost:8081';
const RENDERER_DIR = path.join(__dirname, 'renderer');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/**
 * Expo 导出的 web 产物里资源用的是绝对路径（/_expo/static/...），
 * 直接用 file:// 打开会全部 404。所以在主进程里起一个只监听回环地址的
 * 静态服务，让渲染进程跑在正常的 http 源上，顺带避免 file:// 下
 * localStorage / WebSocket 的各种限制。
 */
function startStaticServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      let filePath = path.join(RENDERER_DIR, urlPath);

      // 防目录穿越
      if (!filePath.startsWith(RENDERER_DIR)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      // 单页应用：找不到的路径一律回 index.html 交给前端路由
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(RENDERER_DIR, 'index.html');
      }

      res.setHeader('Content-Type', MIME[path.extname(filePath)] || 'application/octet-stream');
      fs.createReadStream(filePath).pipe(res);
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

function buildMenu(win) {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: '文件',
      submenu: [isMac ? { role: 'close', label: '关闭窗口' } : { role: 'quit', label: '退出' }],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        ...(isMac ? [{ role: 'zoom', label: '缩放' }, { role: 'front', label: '前置全部窗口' }] : []),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  return win;
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 480,
    minHeight: 560,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b0f17' : '#f2f4f8',
    // macOS 上用隐藏标题栏，视觉上更接近原生聊天应用
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  buildMenu(win);

  win.once('ready-to-show', () => win.show());

  // 站外链接交给系统浏览器，不在应用里打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    await win.loadURL(DEV_URL);
  } else {
    const origin = await startStaticServer();
    await win.loadURL(origin);
  }

  return win;
}

// Windows 上限制成单实例，重复启动时聚焦已有窗口
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    await createWindow();

    // macOS：点 Dock 图标且没有窗口时重开一个
    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) await createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
