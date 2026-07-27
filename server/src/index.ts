import os from 'node:os';
import { formatHostPort, isGlobalIPv6 } from '@chat/shared';
import { listenDualStack } from '@chat/shared/node';
import { config } from './config.js';
import { createServer } from './app.js';

const server = createServer();

// HOST 为空时先试 ::（IPv4 + IPv6 通吃），本机没开 IPv6 再退回 0.0.0.0
const boundHost = await listenDualStack(server, config.port, config.host || undefined);

console.log('聊天服务已启动');
console.log(`  监听地址   ${boundHost === '::' ? ':: (IPv4 + IPv6 双栈)' : boundHost}`);
console.log(`  REST       http://localhost:${config.port}/api`);
console.log(`  WebSocket  ws://localhost:${config.port}/ws`);
console.log(`  数据库      ${config.dbFile}`);

// 手机真机调试时需要连电脑的地址，这里直接把候选列出来省得手动查
const interfaces = Object.values(os.networkInterfaces())
  .flat()
  .filter((n): n is os.NetworkInterfaceInfo => !!n && !n.internal);

const v4 = interfaces.filter((n) => n.family === 'IPv4').map((n) => n.address);
const v6 = interfaces
  .filter((n) => n.family === 'IPv6')
  .map((n) => n.address)
  .filter(isGlobalIPv6);

if (v4.length || v6.length) {
  console.log('\n客户端可填的服务器地址：');
  for (const ip of v4) console.log(`  http://${formatHostPort(ip, config.port)}   (局域网，同 Wi-Fi 可用)`);
  for (const ip of v6) console.log(`  http://${formatHostPort(ip, config.port)}   (公网 IPv6)`);
  if (!v6.length) {
    console.log('  (本机没有公网 IPv6 地址，跨网络访问需要公网 IPv4 或域名 + 端口转发)');
  }
}

function shutdown(signal: string) {
  console.log(`\n收到 ${signal}，正在关闭服务...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
