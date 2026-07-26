/**
 * P2P 端到端测试：用真实的 TCP socket 在 IPv4 和 IPv6 上各跑一遍完整流程。
 *
 * 这里验证的是不经过任何服务器的直连通道：
 * 分帧、双向认证握手、加密收发、篡改检测、中间人拒绝。
 *
 *   npm run test -w @chat/shared
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import net from 'node:net';

import {
  createDeviceIdentity,
  decodePairingPayload,
  encodePairingPayload,
  collectPeerAddresses,
  normalizeServerUrl,
  formatHostPort,
  isGlobalIPv6,
  isIPv6Literal,
  httpToWsUrl,
  newPeerMessageId,
  isPeerMessageId,
  PeerLink,
  FrameReader,
  encodeFrame,
  type DeviceIdentity,
  type PeerEvent,
  type Message,
} from '../src/index.js';
import { adaptNodeSocket, startTcpPeerServer, connectTcpPeer } from '../src/node/index.js';

const alice = { userId: 'u_alice', username: 'alice', displayName: '爱丽丝', avatarColor: '#2f6df6' };
const bob = { userId: 'u_bob', username: 'bob', displayName: 'Bob', avatarColor: '#00897b' };

function makeMessage(body: string, conversationId = 'cv_1', senderId = 'u_alice'): Message {
  return {
    id: newPeerMessageId(),
    conversationId,
    senderId,
    kind: 'text',
    body,
    createdAt: Date.now(),
    clientId: 'c_test',
  };
}

/** 起一对已握手完成的直连，host 决定走 IPv4 还是 IPv6 */
async function connectedPair(host: string, opts: { expectMismatch?: boolean } = {}) {
  const aliceId = createDeviceIdentity();
  const bobId = createDeviceIdentity();

  const bobEvents: PeerEvent[] = [];
  const aliceEvents: PeerEvent[] = [];
  const closes: string[] = [];

  let inbound: PeerLink | null = null;
  const inboundReady = new Promise<PeerLink>((resolve) => {
    void startTcpPeerServer({
      port: 0,
      host,
      makeLinkParams: () => ({
        identity: bobId,
        self: bob,
        onEvent: (event) => bobEvents.push(event),
        onClose: (reason) => closes.push(`bob: ${reason}`),
      }),
      onLink: (link) => {
        inbound = link;
        resolve(link);
      },
    }).then((server) => {
      serverRef = server;
      portRef = server.port;
    });
  });

  let serverRef: Awaited<ReturnType<typeof startTcpPeerServer>> | null = null;
  let portRef = 0;

  // 等监听起来
  for (let i = 0; i < 100 && !portRef; i += 1) await new Promise((r) => setTimeout(r, 10));
  assert.ok(portRef > 0, '监听端口应已分配');

  const outbound = await connectTcpPeer({
    host,
    port: portRef,
    linkParams: {
      identity: aliceId,
      self: alice,
      expectedPeerIdPub: opts.expectMismatch ? createDeviceIdentity().publicKey : bobId.publicKey,
      onEvent: (event) => aliceEvents.push(event),
      onClose: (reason) => closes.push(`alice: ${reason}`),
    },
  });

  await inboundReady;

  return {
    outbound,
    get inbound() {
      return inbound!;
    },
    aliceEvents,
    bobEvents,
    closes,
    aliceId,
    bobId,
    close: async () => {
      outbound.close();
      inbound?.close();
      await serverRef?.close();
    },
  };
}

async function waitUntil(check: () => boolean, label: string, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`等待「${label}」超时`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

/* ------------------------------------------------------------------ */
/* 分帧                                                                */
/* ------------------------------------------------------------------ */

test('分帧能正确处理粘包和拆包', () => {
  const frames: string[] = [];
  const reader = new FrameReader(
    (f) => frames.push(new TextDecoder().decode(f)),
    (err) => {
      throw err;
    },
  );

  const a = encodeFrame(new TextEncoder().encode('第一条'));
  const b = encodeFrame(new TextEncoder().encode('第二条'));

  // 粘包：两帧一次到达
  const glued = new Uint8Array(a.length + b.length);
  glued.set(a, 0);
  glued.set(b, a.length);
  reader.push(glued);
  assert.deepEqual(frames, ['第一条', '第二条']);

  // 拆包：一帧被切成三段
  const c = encodeFrame(new TextEncoder().encode('第三条'));
  reader.push(c.slice(0, 2));
  reader.push(c.slice(2, 6));
  assert.equal(frames.length, 2, '帧不完整时不应触发回调');
  reader.push(c.slice(6));
  assert.deepEqual(frames, ['第一条', '第二条', '第三条']);
});

test('超长帧头会被拒绝，不会撑爆内存', () => {
  let fatal: Error | null = null;
  const reader = new FrameReader(
    () => {},
    (err) => {
      fatal = err;
    },
  );
  const evil = new Uint8Array(4);
  new DataView(evil.buffer).setUint32(0, 500 * 1024 * 1024, false);
  reader.push(evil);
  assert.ok(fatal, '应当报错');
  assert.match(String(fatal), /超出上限/);
});

/* ------------------------------------------------------------------ */
/* 直连                                                                */
/* ------------------------------------------------------------------ */

/** 有些容器 / CI 环境没开 IPv6 协议栈，测不了就明确跳过，别伪装成通过 */
async function ipv6Available() {
  return new Promise<boolean>((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(0, '::1', () => probe.close(() => resolve(true)));
  });
}

const hasIPv6 = await ipv6Available();
if (!hasIPv6) {
  console.log('# 注意：当前环境没有 IPv6 协议栈，IPv6 直连用例被跳过（代码路径本身与 IPv4 共用）');
}

for (const [label, host] of [
  ['IPv4', '127.0.0.1'],
  ['IPv6', '::1'],
] as const) {
  test(`${label} 直连：握手、双向收发、加密通道`, { skip: label === 'IPv6' && !hasIPv6 }, async () => {
    const pair = await connectedPair(host);
    await waitUntil(() => pair.outbound.linkState === 'open', `${label} 主动方握手完成`);
    await waitUntil(() => pair.inbound.linkState === 'open', `${label} 被动方握手完成`);

    // 双方都认出了对端身份
    assert.equal(pair.outbound.peer?.username, 'bob');
    assert.equal(pair.outbound.peer?.idPub, pair.bobId.publicKey);
    assert.equal(pair.inbound.peer?.username, 'alice');
    assert.equal(pair.inbound.peer?.idPub, pair.aliceId.publicKey);

    // alice -> bob
    const msg = makeMessage(`${label} 直连测试，这条消息不经过任何服务器`);
    assert.equal(pair.outbound.send({ t: 'msg', message: msg }), true);
    await waitUntil(() => pair.bobEvents.length > 0, `${label} bob 收到消息`);
    const received = pair.bobEvents[0];
    assert.equal(received.t, 'msg');
    assert.equal(received.t === 'msg' && received.message.body, msg.body);

    // bob -> alice
    pair.inbound.send({ t: 'ack', clientId: 'c_test', messageId: msg.id });
    await waitUntil(() => pair.aliceEvents.length > 0, `${label} alice 收到回执`);
    assert.equal(pair.aliceEvents[0].t, 'ack');

    // 连发多条，验证 nonce 计数器没错位
    for (let i = 0; i < 20; i += 1) {
      pair.outbound.send({ t: 'msg', message: makeMessage(`连发 ${i}`) });
    }
    await waitUntil(() => pair.bobEvents.length === 21, `${label} bob 收齐 21 条`);
    assert.equal(
      pair.bobEvents.filter((e) => e.t === 'msg').length,
      21,
      '连续消息不能丢也不能乱',
    );

    await pair.close();
  });
}

test('ping 会被自动回 pong，且不冒泡给上层', async () => {
  const pair = await connectedPair('127.0.0.1');
  await waitUntil(() => pair.outbound.linkState === 'open', '握手完成');

  pair.outbound.send({ t: 'ping' });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(pair.bobEvents.some((e) => e.t === 'ping'), false, 'ping 不应交给上层');
  assert.equal(pair.aliceEvents.some((e) => e.t === 'pong'), false, 'pong 也不该冒泡');

  // 通道仍然可用
  pair.outbound.send({ t: 'msg', message: makeMessage('ping 之后依然能发') });
  await waitUntil(() => pair.bobEvents.length === 1, '心跳后消息仍可送达');

  await pair.close();
});

test('设备公钥不符时拒绝连接（防中间人）', async () => {
  const pair = await connectedPair('127.0.0.1', { expectMismatch: true });
  await waitUntil(() => pair.outbound.linkState === 'closed', '连接被拒绝');
  assert.ok(
    pair.closes.some((c) => c.includes('公钥与预期不符')),
    `应因公钥不符断开，实际：${pair.closes.join(' / ')}`,
  );
  await pair.close();
});

test('伪造签名无法通过握手', async () => {
  const victimId = createDeviceIdentity();
  const closes: string[] = [];

  const server = await startTcpPeerServer({
    port: 0,
    host: '127.0.0.1',
    makeLinkParams: () => ({
      identity: victimId,
      self: bob,
      onClose: (reason) => closes.push(reason),
    }),
    onLink: () => {},
  });

  // 手工拼一个 hello 正常、auth 签名乱填的攻击端
  const attackerId = createDeviceIdentity();
  const socket = net.createConnection({ host: '127.0.0.1', port: server.port });
  await new Promise<void>((resolve) => socket.once('connect', () => resolve()));

  const raw = adaptNodeSocket(socket);
  const hello = {
    t: 'hello',
    v: 1,
    userId: 'u_evil',
    username: 'evil',
    displayName: '攻击者',
    avatarColor: '#000000',
    idPub: attackerId.publicKey,
    ephPub: '00'.repeat(32),
    nonce: '11'.repeat(32),
  };
  raw.send(encodeFrame(new TextEncoder().encode(JSON.stringify(hello))));
  raw.send(
    encodeFrame(new TextEncoder().encode(JSON.stringify({ t: 'auth', sig: '00'.repeat(64) }))),
  );

  await waitUntil(() => closes.length > 0, '被动方应主动断开', 4000);
  assert.ok(
    closes.some((c) => /签名校验失败|Point|invalid|错误|failed/i.test(c)),
    `应因签名无效断开，实际：${closes.join(' / ')}`,
  );

  socket.destroy();
  await server.close();
});

test('握手不说话会超时断开', async () => {
  const closes: string[] = [];
  const server = await startTcpPeerServer({
    port: 0,
    host: '127.0.0.1',
    makeLinkParams: () => ({
      identity: createDeviceIdentity(),
      self: bob,
      handshakeTimeoutMs: 300,
      onClose: (reason) => closes.push(reason),
    }),
    onLink: () => {},
  });

  const socket = net.createConnection({ host: '127.0.0.1', port: server.port });
  await new Promise<void>((resolve) => socket.once('connect', () => resolve()));

  await waitUntil(() => closes.includes('握手超时'), '应因超时断开', 3000);
  socket.destroy();
  await server.close();
});

test('连接关闭后 send 返回 false，不会抛异常', async () => {
  const pair = await connectedPair('127.0.0.1');
  await waitUntil(() => pair.outbound.linkState === 'open', '握手完成');
  pair.outbound.close();
  assert.equal(pair.outbound.send({ t: 'msg', message: makeMessage('关闭之后') }), false);
  await pair.close();
});

/* ------------------------------------------------------------------ */
/* 配对码                                                              */
/* ------------------------------------------------------------------ */

test('配对码编解码可往返', () => {
  const identity = createDeviceIdentity();
  const payload = {
    v: 1 as const,
    userId: 'u_alice',
    username: 'alice',
    displayName: '爱丽丝',
    avatarColor: '#2f6df6',
    idPub: identity.publicKey,
    addrs: [
      { host: '2408:8207:1::abcd', port: 4310, kind: 'ipv6' as const },
      { host: '192.168.1.10', port: 4310, kind: 'lan' as const },
    ],
    ts: 1_700_000_000_000,
  };

  const encoded = encodePairingPayload(payload);
  assert.match(encoded, /^chatapp:\/\/pair\?/);

  const decoded = decodePairingPayload(encoded);
  assert.deepEqual(decoded, payload);

  // 去掉 scheme 前缀（用户手动粘贴时常见）也要能解
  assert.deepEqual(decodePairingPayload(encoded.split('?')[1]), payload);
});

test('非法配对码会被拒绝', () => {
  assert.throws(() => decodePairingPayload('这不是配对码'), /格式不正确|不完整/);
  assert.throws(
    () => decodePairingPayload(encodePairingPayload({ v: 2 } as any)),
    /不完整|版本/,
  );
});

test('只挑出对端真正可能连上的地址', () => {
  const addrs = collectPeerAddresses([
    '127.0.0.1', // 回环，排除
    '::1', // 回环，排除
    'fe80::1%en0', // 链路本地，排除
    '169.254.1.1', // IPv4 link-local，排除
    '192.168.1.10', // 局域网，保留
    'fd00::1', // 唯一本地地址，排除（不是全局可路由）
    '2408:8207:1::abcd', // 公网 IPv6，保留且排最前
    '203.0.113.5', // 公网 IPv4，多半在 NAT 后，排除
  ]);

  assert.deepEqual(
    addrs.map((a) => `${a.kind}:${a.host}`),
    ['ipv6:2408:8207:1::abcd', 'lan:192.168.1.10'],
  );
});

/* ------------------------------------------------------------------ */
/* IPv6 地址处理                                                        */
/* ------------------------------------------------------------------ */

test('IPv6 地址判定', () => {
  assert.equal(isIPv6Literal('::1'), true);
  assert.equal(isIPv6Literal('2408:8207::1'), true);
  assert.equal(isIPv6Literal('[::1]'), true);
  assert.equal(isIPv6Literal('192.168.1.1'), false);
  assert.equal(isIPv6Literal('example.com:4000'), false);

  assert.equal(isGlobalIPv6('2408:8207:1::abcd'), true);
  assert.equal(isGlobalIPv6('fd00::1'), false, '唯一本地地址不算全局');
  assert.equal(isGlobalIPv6('fe80::1'), false, '链路本地不算全局');
  assert.equal(isGlobalIPv6('::1'), false);
});

test('服务器地址补全支持 IPv6', () => {
  assert.equal(normalizeServerUrl('192.168.1.10'), 'http://192.168.1.10:4000');
  assert.equal(normalizeServerUrl('192.168.1.10:5000'), 'http://192.168.1.10:5000');

  // 裸 IPv6 自动加方括号和默认端口
  assert.equal(normalizeServerUrl('2408:8207:1::abcd'), 'http://[2408:8207:1::abcd]:4000');
  assert.equal(normalizeServerUrl('::1'), 'http://[::1]:4000');
  // 已经写好方括号和端口的原样保留
  assert.equal(normalizeServerUrl('http://[::1]:4000'), 'http://[::1]:4000');
  assert.equal(normalizeServerUrl('[2408:8207::1]:5000'), 'http://[2408:8207::1]:5000');
  // https 走标准端口，不强塞 4000
  assert.equal(normalizeServerUrl('https://chat.example.com'), 'https://chat.example.com');

  assert.equal(formatHostPort('::1', 4000), '[::1]:4000');
  assert.equal(formatHostPort('192.168.1.1', 4000), '192.168.1.1:4000');
});

test('WebSocket 地址转换保留 IPv6 方括号', () => {
  assert.equal(httpToWsUrl('http://[::1]:4000'), 'ws://[::1]:4000');
  assert.equal(httpToWsUrl('https://chat.example.com/'), 'wss://chat.example.com');
});

test('P2P 消息 id 与服务器消息 id 可区分', () => {
  const id = newPeerMessageId();
  assert.equal(isPeerMessageId(id), true);
  assert.equal(isPeerMessageId('m_abc123'), false);
  // 同一毫秒内连发也不应重复
  const ids = new Set(Array.from({ length: 500 }, () => newPeerMessageId()));
  assert.equal(ids.size, 500);
});
