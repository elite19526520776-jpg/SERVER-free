/**
 * 端到端测试：起一个真实的 HTTP + WebSocket 服务，
 * 用共享层的 ApiClient / RealtimeClient 走一遍完整聊天流程。
 *
 *   npm run test -w @chat/server
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

// 必须在导入服务端模块之前设置，config 是在模块加载时读取环境变量的
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-test-'));
process.env.CHAT_DATA_DIR = tmpDir;
process.env.CHAT_DB_FILE = path.join(tmpDir, 'test.db');
process.env.CHAT_JWT_SECRET = 'test-secret-test-secret';

const { createServer } = await import('../src/app.js');
const { ApiClient, RealtimeClient, newClientId } = await import('@chat/shared');
type ServerEvent = import('@chat/shared').ServerEvent;

const server = createServer();
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as AddressInfo).port;
const baseUrl = `http://127.0.0.1:${port}`;

test.after(() => {
  server.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** 收集某个客户端收到的所有服务端事件，便于断言 */
function makeClient(token: { value: string | null }) {
  const events: ServerEvent[] = [];
  const rt = new RealtimeClient({
    baseUrl,
    getToken: () => token.value,
    onEvent: (e) => events.push(e),
  });
  return { events, rt };
}

async function waitFor<T extends ServerEvent['t']>(
  events: ServerEvent[],
  type: T,
  predicate: (e: Extract<ServerEvent, { t: T }>) => boolean = () => true,
  timeoutMs = 3000,
): Promise<Extract<ServerEvent, { t: T }>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const hit = events.find(
      (e): e is Extract<ServerEvent, { t: T }> => e.t === type && predicate(e as any),
    );
    if (hit) return hit;
    if (Date.now() > deadline) {
      throw new Error(`等待事件 ${type} 超时，实际收到：${events.map((e) => e.t).join(', ')}`);
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

const aliceToken = { value: null as string | null };
const bobToken = { value: null as string | null };

const alice = new ApiClient({ baseUrl, getToken: () => aliceToken.value });
const bob = new ApiClient({ baseUrl, getToken: () => bobToken.value });

let aliceId = '';
let bobId = '';
let conversationId = '';

test('健康检查', async () => {
  const health = await alice.health();
  assert.equal(health.ok, true);
});

test('注册两个账号', async () => {
  const a = await alice.register({ username: 'alice', password: 'secret123', displayName: '爱丽丝' });
  const b = await bob.register({ username: 'bob', password: 'secret123', displayName: 'Bob' });
  aliceToken.value = a.token;
  bobToken.value = b.token;
  aliceId = a.user.id;
  bobId = b.user.id;
  assert.equal(a.user.username, 'alice');
  assert.equal(a.user.displayName, '爱丽丝');
  assert.ok(a.user.avatarColor.startsWith('#'));
});

test('用户名重复会被拒绝', async () => {
  await assert.rejects(
    () => alice.register({ username: 'alice', password: 'secret123', displayName: '冒牌货' }),
    (err: any) => err.status === 409 && err.code === 'username_taken',
  );
});

test('密码错误会被拒绝', async () => {
  await assert.rejects(
    () => alice.login({ username: 'alice', password: 'wrongpass' }),
    (err: any) => err.status === 401,
  );
});

test('未登录访问受保护接口返回 401', async () => {
  const anon = new ApiClient({ baseUrl });
  await assert.rejects(() => anon.listConversations(), (err: any) => err.status === 401);
});

test('搜索用户不会搜到自己', async () => {
  const found = await alice.searchUsers('b');
  assert.equal(found.length, 1);
  assert.equal(found[0].username, 'bob');
  assert.equal(found.some((u) => u.id === aliceId), false);
});

test('创建私聊会话，重复创建返回同一个', async () => {
  const conv = await alice.openDirectConversation(bobId);
  conversationId = conv.id;
  assert.equal(conv.type, 'direct');
  assert.equal(conv.members.length, 2);

  const again = await alice.openDirectConversation(bobId);
  assert.equal(again.id, conv.id);

  // 反向创建也应复用同一个会话
  const fromBob = await bob.openDirectConversation(aliceId);
  assert.equal(fromBob.id, conv.id);
});

test('不能和自己建会话', async () => {
  await assert.rejects(
    () => alice.openDirectConversation(aliceId),
    (err: any) => err.status === 400,
  );
});

test('实时收发消息 + ack + 未读数 + 已读回执', async () => {
  const a = makeClient(aliceToken);
  const b = makeClient(bobToken);
  await a.rt.connect();
  await b.rt.connect();
  await waitFor(a.events, 'ready');
  await waitFor(b.events, 'ready');

  const clientId = newClientId();
  a.rt.send({ t: 'send', conversationId, clientId, body: '在吗？' });

  const ack = await waitFor(a.events, 'ack', (e) => e.clientId === clientId);
  assert.equal(ack.message.body, '在吗？');
  assert.equal(ack.message.senderId, aliceId);

  const received = await waitFor(b.events, 'message', (e) => e.message.body === '在吗？');
  assert.equal(received.message.id, ack.message.id);
  assert.ok(received.conversation, '在线成员应同时收到会话快照');

  // Bob 还没读，未读数应为 1；Alice 自己发的不算未读
  const bobConvs = await bob.listConversations();
  assert.equal(bobConvs[0].unreadCount, 1);
  const aliceConvs = await alice.listConversations();
  assert.equal(aliceConvs[0].unreadCount, 0);

  // Bob 标记已读，Alice 应收到已读回执
  b.rt.send({ t: 'read', conversationId, messageId: ack.message.id });
  const readEvent = await waitFor(a.events, 'read', (e) => e.userId === bobId);
  assert.equal(readEvent.messageId, ack.message.id);

  const afterRead = await bob.listConversations();
  assert.equal(afterRead[0].unreadCount, 0);

  a.rt.disconnect();
  b.rt.disconnect();
});

test('相同 clientId 重复发送是幂等的（断线重发不会产生重复消息）', async () => {
  const a = makeClient(aliceToken);
  await a.rt.connect();
  await waitFor(a.events, 'ready');

  const before = await alice.listMessages(conversationId);
  const clientId = newClientId();

  a.rt.send({ t: 'send', conversationId, clientId, body: '重复发送测试' });
  const first = await waitFor(a.events, 'ack', (e) => e.clientId === clientId);

  a.rt.send({ t: 'send', conversationId, clientId, body: '重复发送测试' });
  await new Promise((r) => setTimeout(r, 200));

  const after = await alice.listMessages(conversationId);
  assert.equal(after.length, before.length + 1, '重复的 clientId 不应新增消息');
  assert.equal(after[after.length - 1].id, first.message.id);

  a.rt.disconnect();
});

test('离线期间的消息在重新上线后能通过历史接口取回', async () => {
  // Bob 完全离线
  const unreadBefore = (await bob.listConversations())[0].unreadCount;
  const a = makeClient(aliceToken);
  await a.rt.connect();
  await waitFor(a.events, 'ready');

  for (const body of ['离线消息 1', '离线消息 2', '离线消息 3']) {
    const clientId = newClientId();
    a.rt.send({ t: 'send', conversationId, clientId, body });
    await waitFor(a.events, 'ack', (e) => e.clientId === clientId);
  }
  a.rt.disconnect();

  const history = await bob.listMessages(conversationId);
  const bodies = history.map((m) => m.body);
  assert.ok(bodies.includes('离线消息 1'));
  assert.ok(bodies.includes('离线消息 3'));

  const convs = await bob.listConversations();
  assert.equal(convs[0].unreadCount, unreadBefore + 3, '离线期间收到的消息应累加未读数');
  assert.equal(convs[0].lastMessage?.body, '离线消息 3');
});

test('历史消息按时间升序返回并支持向上翻页', async () => {
  const all = await alice.listMessages(conversationId, { limit: 100 });
  for (let i = 1; i < all.length; i += 1) {
    assert.ok(all[i].createdAt >= all[i - 1].createdAt, '消息必须按时间升序');
  }

  const lastTwo = await alice.listMessages(conversationId, { limit: 2 });
  assert.equal(lastTwo.length, 2);
  assert.deepEqual(
    lastTwo.map((m) => m.id),
    all.slice(-2).map((m) => m.id),
  );

  const page2 = await alice.listMessages(conversationId, { before: lastTwo[0].id, limit: 2 });
  assert.equal(page2.length, 2);
  assert.deepEqual(
    page2.map((m) => m.id),
    all.slice(-4, -2).map((m) => m.id),
  );
});

let malloryToken: string | null = null;

test('非会话成员无法读取消息', async () => {
  const mallory = new ApiClient({ baseUrl, getToken: () => malloryToken });
  const auth = await mallory.register({
    username: 'mallory',
    password: 'secret123',
    displayName: 'Mallory',
  });
  malloryToken = auth.token;

  await assert.rejects(
    () => mallory.listMessages(conversationId),
    (err: any) => err.status === 403,
  );
});

test('伪造 token 无法建立 WebSocket 连接', async () => {
  const fake = makeClient({ value: 'not-a-real-token' });
  await fake.rt.connect();
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(fake.events.length, 0, '非法 token 不应收到任何事件');
  fake.rt.disconnect();
});

test('设备端点注册后出现在对方的会话成员里', async () => {
  const aliceDevice = {
    publicKey: 'aa'.repeat(32),
    addresses: [
      { host: '2408:8207:1::abcd', port: 4310, kind: 'ipv6' as const },
      { host: '192.168.1.10', port: 4310, kind: 'lan' as const },
    ],
  };
  const registered = await alice.registerDevice(aliceDevice);
  assert.equal(registered.publicKey, aliceDevice.publicKey);
  assert.equal(registered.addresses.length, 2);

  // Bob 拉会话时应能看到 Alice 的直连端点
  const convs = await bob.listConversations();
  const aliceMember = convs[0].members.find((m) => m.id === aliceId);
  assert.ok(aliceMember, '应能找到 Alice');
  assert.equal(aliceMember!.devices.length, 1);
  assert.equal(aliceMember!.devices[0].publicKey, aliceDevice.publicKey);
  assert.equal(aliceMember!.devices[0].addresses[0].kind, 'ipv6', '公网 IPv6 地址应保留');

  // Bob 自己那条记录还没注册设备
  const bobMember = convs[0].members.find((m) => m.id === bobId);
  assert.deepEqual(bobMember!.devices, []);
});

test('设备公钥格式非法会被拒绝', async () => {
  await assert.rejects(
    () => alice.registerDevice({ publicKey: 'not-a-key', addresses: [] }),
    (err: any) => err.status === 400 && err.code === 'invalid_public_key',
  );
});

test('别人的设备公钥不能被占用', async () => {
  await assert.rejects(
    () => bob.registerDevice({ publicKey: 'aa'.repeat(32), addresses: [] }),
    (err: any) => err.status === 409 && err.code === 'device_taken',
  );
});

test('设备地址更新会实时推给在线好友', async () => {
  const b = makeClient(bobToken);
  await b.rt.connect();
  await waitFor(b.events, 'ready');

  await alice.registerDevice({
    publicKey: 'aa'.repeat(32),
    addresses: [{ host: '2408:8207:1::ffff', port: 4310, kind: 'ipv6' }],
  });

  const event = await waitFor(b.events, 'devices', (e) => e.userId === aliceId);
  assert.equal(event.devices[0].addresses[0].host, '2408:8207:1::ffff');

  b.rt.disconnect();
});

test('注销设备后好友就看不到直连端点了', async () => {
  await alice.unregisterDevice('aa'.repeat(32));
  const convs = await bob.listConversations();
  const aliceMember = convs[0].members.find((m) => m.id === aliceId);
  assert.deepEqual(aliceMember!.devices, []);
});

test('正在输入状态会转发给对方，且不会回给自己', async () => {
  const a = makeClient(aliceToken);
  const b = makeClient(bobToken);
  await a.rt.connect();
  await b.rt.connect();
  await waitFor(a.events, 'ready');
  await waitFor(b.events, 'ready');

  a.rt.send({ t: 'typing', conversationId, on: true });
  const typing = await waitFor(b.events, 'typing');
  assert.equal(typing.userId, aliceId);
  assert.equal(typing.on, true);
  assert.equal(a.events.some((e) => e.t === 'typing'), false);

  a.rt.disconnect();
  b.rt.disconnect();
});
