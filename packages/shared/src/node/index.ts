/**
 * 只在 Node / Electron 主进程里可用的部分（依赖 node:net、node:os）。
 * React Native 不要从这里导入，否则 Metro 会尝试打包 Node 内置模块而失败。
 */
export * from './tcp.js';
