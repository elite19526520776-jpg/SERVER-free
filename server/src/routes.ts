import { Router } from 'express';
import { LIMITS, USERNAME_RE } from '@chat/shared';
import type { AuthResult } from '@chat/shared';
import { config } from './config.js';
import { requireAuth, signToken } from './auth.js';
import { hub } from './hub.js';
import {
  createUser,
  devicesOf,
  getConversation,
  listConversations,
  listMessages,
  markRead,
  memberIdsOf,
  openDirectConversation,
  registerDevice,
  removeDevice,
  searchUsers,
  StoreError,
  verifyCredentials,
} from './store.js';

export const router = Router();

function assert(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new StoreError(400, code, message);
}

router.get('/health', (_req, res) => {
  res.json({ ok: true, version: config.version });
});

/* ----------------------------- auth ----------------------------- */

router.post('/auth/register', (req, res) => {
  const { username, password, displayName } = req.body ?? {};

  assert(typeof username === 'string' && USERNAME_RE.test(username), 'invalid_username',
    `用户名需 ${LIMITS.usernameMin}-${LIMITS.usernameMax} 位，字母开头，只能含字母、数字和下划线`);
  assert(
    typeof password === 'string' &&
      password.length >= LIMITS.passwordMin &&
      password.length <= LIMITS.passwordMax,
    'invalid_password',
    `密码至少 ${LIMITS.passwordMin} 位`,
  );
  const name =
    typeof displayName === 'string' && displayName.trim() ? displayName.trim() : username;
  assert(name.length <= LIMITS.displayNameMax, 'invalid_display_name', '昵称太长了');

  const user = createUser(username, password, name);
  const result: AuthResult = { token: signToken(user.id), user };
  res.status(201).json(result);
});

router.post('/auth/login', (req, res) => {
  const { username, password } = req.body ?? {};
  assert(typeof username === 'string' && username, 'invalid_username', '请输入用户名');
  assert(typeof password === 'string' && password, 'invalid_password', '请输入密码');

  const user = verifyCredentials(username, password);
  const result: AuthResult = { token: signToken(user.id), user };
  res.json(result);
});

router.get('/me', requireAuth, (req, res) => {
  res.json(req.user);
});

/* ----------------------------- users ---------------------------- */

router.get('/users/search', requireAuth, (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (q.length < 1) {
    res.json([]);
    return;
  }
  res.json(searchUsers(req.user!.id, q));
});

/* ---------------------------- devices --------------------------- */

/**
 * 上报本设备的 P2P 端点。服务器在这里只扮演"通讯录"：
 * 存公钥和可达地址给好友去直连，消息本身不经过服务器。
 */
router.post('/devices', requireAuth, (req, res) => {
  const { publicKey, addresses } = req.body ?? {};
  assert(typeof publicKey === 'string' && publicKey, 'invalid_public_key', '缺少 publicKey');
  assert(Array.isArray(addresses), 'invalid_addresses', 'addresses 必须是数组');

  const device = registerDevice({ userId: req.user!.id, publicKey, addresses });

  // 通知在线好友：我的直连地址变了，可以来连我
  const peers = new Set<string>();
  for (const conv of listConversations(req.user!.id)) {
    for (const member of conv.members) {
      if (member.id !== req.user!.id) peers.add(member.id);
    }
  }
  const mine = devicesOf(req.user!.id);
  hub.broadcast(peers, { t: 'devices', userId: req.user!.id, devices: mine });

  res.status(201).json(device);
});

router.delete('/devices/:publicKey', requireAuth, (req, res) => {
  removeDevice(req.params.publicKey);
  res.status(204).end();
});

/* -------------------------- conversations ----------------------- */

router.get('/conversations', requireAuth, (req, res) => {
  res.json(listConversations(req.user!.id));
});

router.post('/conversations/direct', requireAuth, (req, res) => {
  const { userId } = req.body ?? {};
  assert(typeof userId === 'string' && userId, 'invalid_target', '缺少 userId');

  const conv = openDirectConversation(req.user!.id, userId);
  // 让对方的列表里也立刻出现这个会话
  if (hub.isOnline(userId)) {
    hub.sendTo(userId, { t: 'conversation', conversation: getConversation(conv.id, userId) });
  }
  res.status(201).json(conv);
});

router.get('/conversations/:id', requireAuth, (req, res) => {
  res.json(getConversation(req.params.id, req.user!.id));
});

router.get('/conversations/:id/messages', requireAuth, (req, res) => {
  const before = typeof req.query.before === 'string' ? req.query.before : undefined;
  const limitRaw = Number(req.query.limit);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined;
  res.json(listMessages(req.params.id, req.user!.id, { before, limit }));
});

router.post('/conversations/:id/read', requireAuth, (req, res) => {
  const { messageId } = req.body ?? {};
  assert(typeof messageId === 'string' && messageId, 'invalid_message', '缺少 messageId');

  markRead(req.params.id, req.user!.id, messageId);
  hub.broadcast(memberIdsOf(req.params.id), {
    t: 'read',
    conversationId: req.params.id,
    userId: req.user!.id,
    messageId,
  });
  res.status(204).end();
});
