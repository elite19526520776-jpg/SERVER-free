import os from 'node:os';
import { config } from './config.js';
import { createServer } from './app.js';

const server = createServer();

server.listen(config.port, config.host, () => {
  console.log('聊天服务已启动');
  console.log(`  REST       http://localhost:${config.port}/api`);
  console.log(`  WebSocket  ws://localhost:${config.port}/ws`);
  console.log(`  数据库      ${config.dbFile}`);

  // 手机真机调试时需要连电脑的局域网 IP，这里直接打出来省得手动查
  const lanIps = Object.values(os.networkInterfaces())
    .flat()
    .filter((n): n is os.NetworkInterfaceInfo => !!n && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);
  if (lanIps.length) {
    console.log('\n手机真机调试可用地址（和电脑处于同一 Wi-Fi 时）：');
    for (const ip of lanIps) console.log(`  http://${ip}:${config.port}`);
  }
});

function shutdown(signal: string) {
  console.log(`\n收到 ${signal}，正在关闭服务...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
