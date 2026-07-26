import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import type { User } from '@chat/shared';
import { config } from './config.js';
import { findUserById } from './store.js';

export interface TokenPayload {
  sub: string;
}

export function signToken(userId: string) {
  return jwt.sign({ sub: userId } satisfies TokenPayload, config.jwtSecret, {
    expiresIn: config.tokenTtl as jwt.SignOptions['expiresIn'],
  });
}

/** 校验 token 并取回用户；失败返回 null（WebSocket 握手也复用这个） */
export function userFromToken(token: string | undefined | null): User | null {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret) as TokenPayload;
    if (!payload?.sub) return null;
    return findUserById(payload.sub);
  } catch {
    return null;
  }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header('authorization') ?? '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : null;
  const user = userFromToken(token);
  if (!user) {
    res.status(401).json({ error: 'unauthorized', message: '登录已过期，请重新登录' });
    return;
  }
  req.user = user;
  next();
}
