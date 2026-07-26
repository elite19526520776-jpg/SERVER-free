import http from 'node:http';
import { URL } from 'node:url';
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.js';
import { router } from './routes.js';
import { StoreError } from './store.js';
import { userFromToken } from './auth.js';
import { hub } from './hub.js';

export function createServer() {
  const app = express();

  app.use(cors({ origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',') }));
  app.use(express.json({ limit: '256kb' }));
  app.use('/api', router);

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'not_found', message: '接口不存在' });
  });

  // 统一错误出口：StoreError 直接映射成 HTTP 状态码
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof StoreError) {
      res.status(err.status).json({ error: err.code, message: err.message });
      return;
    }
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({ error: 'bad_json', message: '请求体不是合法 JSON' });
      return;
    }
    console.error('[http] 未处理异常', err);
    res.status(500).json({ error: 'internal_error', message: '服务器内部错误' });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    // token 走 query，因为 RN / 浏览器的 WebSocket 都不支持自定义请求头
    const user = userFromToken(url.searchParams.get('token'));
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      hub.handleConnection(ws, user);
    });
  });

  hub.startHeartbeat();
  return server;
}
