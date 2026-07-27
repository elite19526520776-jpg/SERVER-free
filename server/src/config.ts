import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';

const dataDir = process.env.CHAT_DATA_DIR
  ? path.resolve(process.env.CHAT_DATA_DIR)
  : path.resolve(process.cwd(), 'data');

fs.mkdirSync(dataDir, { recursive: true });

/**
 * 生产环境必须通过 CHAT_JWT_SECRET 注入密钥。
 * 开发时自动生成并落盘，避免每次重启后所有 token 失效。
 */
function resolveJwtSecret() {
  const fromEnv = process.env.CHAT_JWT_SECRET;
  if (fromEnv && fromEnv.length >= 16) return fromEnv;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '生产环境必须设置 CHAT_JWT_SECRET（至少 16 位）。可用 `openssl rand -hex 32` 生成。',
    );
  }

  const secretFile = path.join(dataDir, '.dev-jwt-secret');
  if (fs.existsSync(secretFile)) return fs.readFileSync(secretFile, 'utf8').trim();
  const generated = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(secretFile, generated, { mode: 0o600 });
  return generated;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  /**
   * 默认绑 ::（双栈）。Node 在双栈主机上绑 :: 会同时接受 IPv4 和 IPv6 连接，
   * 主机没开 IPv6 时启动流程会自动退回 0.0.0.0。
   */
  host: process.env.HOST ?? '',
  dataDir,
  dbFile: process.env.CHAT_DB_FILE
    ? path.resolve(process.env.CHAT_DB_FILE)
    : path.join(dataDir, 'chat.db'),
  jwtSecret: resolveJwtSecret(),
  tokenTtl: process.env.CHAT_TOKEN_TTL ?? '30d',
  /** 允许的前端来源；默认全放开，方便本地各端联调 */
  corsOrigin: process.env.CHAT_CORS_ORIGIN ?? '*',
  version: '0.1.0',
};
