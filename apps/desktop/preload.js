const { contextBridge } = require('electron');

/**
 * 渲染进程跑的是和手机端完全一样的 React Native Web 代码，
 * 目前不需要任何 Node 能力，这里只暴露一点平台信息，
 * 方便以后加托盘、系统通知、开机自启时有个入口。
 */
contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
});
