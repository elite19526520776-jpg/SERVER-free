import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import {
  RealtimeClient,
  conversationPeer,
  mergeMessages,
  newClientId,
  newPeerMessageId,
} from '@chat/shared';
import type {
  ConnectionState,
  Conversation,
  Message,
  PeerEvent,
  ServerEvent,
} from '@chat/shared';
import { PeerManager, type PeerState } from '../p2p/PeerManager';
import { storage } from '../storage';
import { useAuth } from './AuthContext';

/** 本地乐观消息的发送状态；服务端确认后从表里移除 */
export type SendStatus = 'sending' | 'failed';

/** 一条消息实际走的通道 */
export type Channel = 'p2p-lan' | 'p2p-ipv6' | 'server' | 'none';

interface ChatValue {
  connection: ConnectionState;
  conversations: Conversation[];
  /** 首次加载中（还没有任何缓存可显示） */
  loading: boolean;
  onlineUserIds: Set<string>;
  sendStatus: Record<string, SendStatus>;
  messagesOf: (conversationId: string) => Message[];
  typingIn: (conversationId: string) => string[];
  hasMoreIn: (conversationId: string) => boolean;
  loadingMoreIn: (conversationId: string) => boolean;

  /* --------------------------- P2P --------------------------- */
  /** 本机是否支持直连（浏览器里不支持） */
  p2pAvailable: boolean;
  p2pUnavailableReason: string;
  /** 本设备公钥，UI 上给用户核对指纹 */
  deviceIdPub: string | null;
  peerStates: Record<string, PeerState>;
  /** 某个会话当前走的通道 */
  channelOf: (conversationId: string) => Channel;
  /** 生成配对码需要的本机地址 */
  localPeerAddresses: () => Promise<import('@chat/shared').PeerAddress[]>;
  /** 扫码/粘贴配对码后调用 */
  pairWithPayload: (payload: import('@chat/shared').PairingPayload) => Promise<void>;

  refresh: () => Promise<void>;
  ensureMessages: (conversationId: string) => Promise<void>;
  loadOlder: (conversationId: string) => Promise<void>;
  sendMessage: (conversationId: string, body: string) => void;
  retryMessage: (message: Message) => void;
  setTyping: (conversationId: string, on: boolean) => void;
  markRead: (conversationId: string) => void;
  openDirect: (userId: string) => Promise<Conversation>;
}

const ChatContext = createContext<ChatValue | null>(null);

const TYPING_TIMEOUT_MS = 4000;
const PAGE_SIZE = 30;

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { status, api, serverUrl, getToken, user } = useAuth();
  const selfId = user?.id ?? null;

  const [connection, setConnection] = useState<ConnectionState>('idle');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [sendStatus, setSendStatus] = useState<Record<string, SendStatus>>({});
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const [typing, setTypingState] = useState<Record<string, Record<string, number>>>({});
  const [loading, setLoading] = useState(true);
  const [exhausted, setExhausted] = useState<Record<string, boolean>>({});
  const [loadingMore, setLoadingMore] = useState<Record<string, boolean>>({});

  const [peerStates, setPeerStates] = useState<Record<string, PeerState>>({});

  const rtRef = useRef<RealtimeClient | null>(null);
  const peerRef = useRef<PeerManager | null>(null);
  /** 已经拉过历史的会话，避免每次进页面都重复请求 */
  const fetchedRef = useRef<Set<string>>(new Set());
  const typingTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // markRead 会在 effect 里被调用，必须保持引用稳定，
  // 否则「状态变化 -> 回调重建 -> effect 重跑 -> 状态变化」会绕成死循环。
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;

  /* ---------------------------------------------------------------- */
  /* 本地状态更新工具                                                   */
  /* ---------------------------------------------------------------- */

  const upsertConversation = useCallback((conv: Conversation) => {
    setConversations((prev) => {
      const next = prev.some((c) => c.id === conv.id)
        ? prev.map((c) => (c.id === conv.id ? conv : c))
        : [conv, ...prev];
      return sortConversations(next);
    });
  }, []);

  const appendMessage = useCallback((message: Message) => {
    setMessages((prev) => {
      const list = prev[message.conversationId] ?? [];
      if (list.some((m) => m.id === message.id)) return prev;
      const next = mergeMessages(list, [message]);
      void storage.setMessages(message.conversationId, next);
      return { ...prev, [message.conversationId]: next };
    });
  }, []);

  /** 用服务端返回的消息替换本地的乐观占位（按 clientId 匹配） */
  const settleOptimistic = useCallback((clientId: string, message: Message) => {
    setMessages((prev) => {
      const list = prev[message.conversationId] ?? [];
      const replaced = list.filter((m) => m.id !== clientId && m.id !== message.id);
      const next = mergeMessages(replaced, [message]);
      void storage.setMessages(message.conversationId, next);
      return { ...prev, [message.conversationId]: next };
    });
    setSendStatus((prev) => {
      if (!(clientId in prev)) return prev;
      const next = { ...prev };
      delete next[clientId];
      return next;
    });
  }, []);

  /* ---------------------------------------------------------------- */
  /* WebSocket 事件                                                    */
  /* ---------------------------------------------------------------- */

  const handleEvent = useCallback(
    (event: ServerEvent) => {
      switch (event.t) {
        case 'ready': {
          setOnlineUserIds(new Set(event.onlineUserIds));
          break;
        }
        case 'presence': {
          setOnlineUserIds((prev) => {
            const next = new Set(prev);
            if (event.online) next.add(event.userId);
            else next.delete(event.userId);
            return next;
          });
          break;
        }
        case 'conversation': {
          upsertConversation(event.conversation);
          break;
        }
        case 'devices': {
          // 好友换了网络 / 刚上线，地址变了，立刻重试直连
          setConversations((prev) =>
            prev.map((c) => ({
              ...c,
              members: c.members.map((m) =>
                m.id === event.userId ? { ...m, devices: event.devices } : m,
              ),
            })),
          );
          break;
        }
        case 'message': {
          // 自己发的消息已经由 ack 处理过，这里只补会话快照
          appendMessage(event.message);
          if (event.conversation) upsertConversation(event.conversation);
          // 对方发来消息说明他不在输入了
          if (event.message.senderId !== selfId) {
            clearTyping(event.message.conversationId, event.message.senderId);
          }
          break;
        }
        case 'ack': {
          settleOptimistic(event.clientId, event.message);
          break;
        }
        case 'typing': {
          if (event.userId === selfId) break;
          if (event.on) markTyping(event.conversationId, event.userId);
          else clearTyping(event.conversationId, event.userId);
          break;
        }
        case 'read': {
          setConversations((prev) =>
            prev.map((c) => {
              if (c.id !== event.conversationId) return c;
              return {
                ...c,
                unreadCount: event.userId === selfId ? 0 : c.unreadCount,
                members: c.members.map((m) =>
                  m.id === event.userId ? { ...m, lastReadMessageId: event.messageId } : m,
                ),
              };
            }),
          );
          break;
        }
        case 'error': {
          console.warn('[realtime] 服务端返回错误:', event.code, event.message);
          break;
        }
        default:
          break;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selfId, appendMessage, upsertConversation, settleOptimistic],
  );

  function markTyping(conversationId: string, userId: string) {
    setTypingState((prev) => ({
      ...prev,
      [conversationId]: { ...(prev[conversationId] ?? {}), [userId]: Date.now() },
    }));
    const key = `${conversationId}:${userId}`;
    clearTimeout(typingTimers.current[key]);
    // 对方可能直接关掉页面而不发 typing:false，超时兜底
    typingTimers.current[key] = setTimeout(
      () => clearTyping(conversationId, userId),
      TYPING_TIMEOUT_MS,
    );
  }

  function clearTyping(conversationId: string, userId: string) {
    const key = `${conversationId}:${userId}`;
    clearTimeout(typingTimers.current[key]);
    delete typingTimers.current[key];
    setTypingState((prev) => {
      const inConv = prev[conversationId];
      if (!inConv || !(userId in inConv)) return prev;
      const nextConv = { ...inConv };
      delete nextConv[userId];
      return { ...prev, [conversationId]: nextConv };
    });
  }

  /* ---------------------------------------------------------------- */
  /* P2P                                                               */
  /* ---------------------------------------------------------------- */

  /** 私聊会话对应的对端 userId；群聊暂不走 P2P */
  const peerIdOf = useCallback(
    (conversationId: string): string | null => {
      const conv = conversationsRef.current.find((c) => c.id === conversationId);
      if (!conv || conv.type !== 'direct' || !selfId) return null;
      return conversationPeer(conv, selfId)?.id ?? null;
    },
    [selfId],
  );

  /** 收到 P2P 消息后本地更新会话，服务器不知道这条消息，只能自己维护 */
  const touchConversation = useCallback(
    (conversationId: string, message: Message, unread: boolean) => {
      setConversations((prev) =>
        sortConversations(
          prev.map((c) =>
            c.id === conversationId
              ? {
                  ...c,
                  lastMessage: message,
                  unreadCount: unread ? c.unreadCount + 1 : c.unreadCount,
                }
              : c,
          ),
        ),
      );
    },
    [],
  );

  const handlePeerEvent = useCallback(
    (event: PeerEvent) => {
      switch (event.t) {
        case 'msg': {
          appendMessage(event.message);
          touchConversation(event.message.conversationId, event.message, true);
          clearTyping(event.message.conversationId, event.message.senderId);
          // 回执，让对方的「发送中」落定
          if (event.message.clientId) {
            peerRef.current?.send(event.message.senderId, {
              t: 'ack',
              clientId: event.message.clientId,
              messageId: event.message.id,
            });
          }
          break;
        }
        case 'ack': {
          // 对端已收下，把「发送中」去掉
          setSendStatus((prev) => {
            if (!(event.clientId in prev)) return prev;
            const next = { ...prev };
            delete next[event.clientId];
            return next;
          });
          break;
        }
        case 'typing': {
          const userId = peerIdOf(event.conversationId);
          if (!userId) break;
          if (event.on) markTyping(event.conversationId, userId);
          else clearTyping(event.conversationId, userId);
          break;
        }
        case 'read': {
          const userId = peerIdOf(event.conversationId);
          if (!userId) break;
          setConversations((prev) =>
            prev.map((c) =>
              c.id === event.conversationId
                ? {
                    ...c,
                    members: c.members.map((m) =>
                      m.id === userId ? { ...m, lastReadMessageId: event.messageId } : m,
                    ),
                  }
                : c,
            ),
          );
          break;
        }
        default:
          break;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appendMessage, touchConversation, peerIdOf],
  );

  /* ---------------------------------------------------------------- */
  /* 数据拉取                                                           */
  /* ---------------------------------------------------------------- */

  const refresh = useCallback(async () => {
    try {
      const list = await api.listConversations();
      setConversations(sortConversations(list));
      void storage.setConversations(list);
    } catch (err) {
      // 离线时保留本地缓存，不清空列表
      console.warn('[chat] 拉取会话列表失败', err);
    } finally {
      setLoading(false);
    }
  }, [api]);

  const ensureMessages = useCallback(
    async (conversationId: string) => {
      if (fetchedRef.current.has(conversationId)) return;
      fetchedRef.current.add(conversationId);

      const cached = await storage.getMessages(conversationId);
      if (cached?.length) {
        setMessages((prev) => ({
          ...prev,
          [conversationId]: mergeMessages(cached, prev[conversationId] ?? []),
        }));
      }

      try {
        const fresh = await api.listMessages(conversationId, { limit: PAGE_SIZE });
        setMessages((prev) => {
          const next = mergeMessages(prev[conversationId] ?? [], fresh);
          void storage.setMessages(conversationId, next);
          return { ...prev, [conversationId]: next };
        });
        if (fresh.length < PAGE_SIZE) {
          setExhausted((prev) => ({ ...prev, [conversationId]: true }));
        }
      } catch (err) {
        // 失败时允许下次进入重试
        fetchedRef.current.delete(conversationId);
        console.warn('[chat] 拉取历史消息失败', err);
      }
    },
    [api],
  );

  const loadOlder = useCallback(
    async (conversationId: string) => {
      if (exhausted[conversationId] || loadingMore[conversationId]) return;
      const list = messages[conversationId] ?? [];
      // 乐观消息还没有服务端 id，不能拿来当翻页锚点
      const oldest = list.find((m) => !m.id.startsWith('c_'));
      if (!oldest) return;

      setLoadingMore((prev) => ({ ...prev, [conversationId]: true }));
      try {
        const older = await api.listMessages(conversationId, {
          before: oldest.id,
          limit: PAGE_SIZE,
        });
        if (older.length < PAGE_SIZE) {
          setExhausted((prev) => ({ ...prev, [conversationId]: true }));
        }
        if (older.length) {
          setMessages((prev) => ({
            ...prev,
            [conversationId]: mergeMessages(older, prev[conversationId] ?? []),
          }));
        }
      } catch (err) {
        console.warn('[chat] 加载更多消息失败', err);
      } finally {
        setLoadingMore((prev) => ({ ...prev, [conversationId]: false }));
      }
    },
    [api, exhausted, loadingMore, messages],
  );

  /* ---------------------------------------------------------------- */
  /* 动作                                                              */
  /* ---------------------------------------------------------------- */

  const sendMessage = useCallback(
    (conversationId: string, rawBody: string) => {
      const body = rawBody.trim();
      if (!body || !selfId) return;

      const clientId = newClientId();
      const peerId = peerIdOf(conversationId);
      // 直连可用就走 P2P：消息不经过服务器，id 由本机生成（p_ 前缀）
      const direct = !!peerId && !!peerRef.current?.isDirect(peerId);

      const optimistic: Message = {
        // 走服务器时 id 暂用 clientId，等服务端 ack 回来再换成正式 id
        id: direct ? newPeerMessageId() : clientId,
        conversationId,
        senderId: selfId,
        kind: 'text',
        body,
        createdAt: Date.now(),
        clientId,
      };
      appendMessage(optimistic);
      setSendStatus((prev) => ({ ...prev, [clientId]: 'sending' }));

      if (direct && peerId) {
        const sent = peerRef.current!.send(peerId, { t: 'msg', message: optimistic });
        if (!sent) {
          // 直连刚好在这一刻断了，退回服务器重发一遍
          rtRef.current?.send({ t: 'send', conversationId, clientId, body });
        }
      } else {
        // 断线时 RealtimeClient 会把它放进离线队列，恢复后自动补发
        rtRef.current?.send({ t: 'send', conversationId, clientId, body });
      }

      setConversations((prev) =>
        sortConversations(
          prev.map((c) => (c.id === conversationId ? { ...c, lastMessage: optimistic } : c)),
        ),
      );
    },
    [appendMessage, peerIdOf, selfId],
  );

  const retryMessage = useCallback((message: Message) => {
    if (!message.clientId) return;
    setSendStatus((prev) => ({ ...prev, [message.clientId!]: 'sending' }));
    rtRef.current?.send({
      t: 'send',
      conversationId: message.conversationId,
      clientId: message.clientId,
      body: message.body,
    });
  }, []);

  const setTyping = useCallback(
    (conversationId: string, on: boolean) => {
      const peerId = peerIdOf(conversationId);
      if (peerId && peerRef.current?.send(peerId, { t: 'typing', conversationId, on })) return;
      rtRef.current?.send({ t: 'typing', conversationId, on });
    },
    [peerIdOf],
  );

  const markRead = useCallback((conversationId: string) => {
    const list = messagesRef.current[conversationId] ?? [];
    // 乐观消息还没有服务端 id，不能拿来当已读位置
    const last = [...list].reverse().find((m) => !m.id.startsWith('c_'));
    if (!last) return;

    const conv = conversationsRef.current.find((c) => c.id === conversationId);
    if (conv && conv.unreadCount === 0) return;

    setConversations((prev) =>
      prev.map((c) => (c.id === conversationId ? { ...c, unreadCount: 0 } : c)),
    );

    const peerId = peerIdOf(conversationId);
    if (peerId && peerRef.current?.send(peerId, { t: 'read', conversationId, messageId: last.id })) {
      return;
    }
    // P2P 消息服务器不认识，别拿它的 id 去请求服务器
    if (!last.id.startsWith('p_')) {
      rtRef.current?.send({ t: 'read', conversationId, messageId: last.id });
    }
  }, [peerIdOf]);

  const openDirect = useCallback(
    async (userId: string) => {
      const conv = await api.openDirectConversation(userId);
      upsertConversation(conv);
      return conv;
    },
    [api, upsertConversation],
  );

  /* ---------------------------------------------------------------- */
  /* 生命周期                                                           */
  /* ---------------------------------------------------------------- */

  // 登录后建立实时连接；登出或换服务器时重建
  useEffect(() => {
    if (status !== 'signedIn') {
      rtRef.current?.disconnect();
      rtRef.current = null;
      setConnection('idle');
      setConversations([]);
      setMessages({});
      setSendStatus({});
      setOnlineUserIds(new Set());
      fetchedRef.current.clear();
      setLoading(true);
      return;
    }

    const client = new RealtimeClient({
      baseUrl: serverUrl,
      getToken: async () => getToken(),
      onEvent: handleEvent,
      onStateChange: setConnection,
    });
    rtRef.current = client;
    void client.connect();

    return () => {
      client.disconnect();
      if (rtRef.current === client) rtRef.current = null;
    };
  }, [status, serverUrl, getToken, handleEvent]);

  // P2P：登录后启动监听 / 局域网发现，并把本机端点注册给服务器供好友直连
  useEffect(() => {
    if (status !== 'signedIn' || !user) {
      void peerRef.current?.stop();
      peerRef.current = null;
      setPeerStates({});
      return;
    }

    const manager = new PeerManager({
      onEvent: (event) => handlePeerEvent(event),
      onStateChange: setPeerStates,
    });
    peerRef.current = manager;

    let cancelled = false;
    let heartbeat: ReturnType<typeof setInterval> | null = null;

    (async () => {
      const enabled = await storage.getP2pEnabled();
      if (cancelled || !enabled) return;

      const addresses = await manager.start(user);
      if (cancelled) return;

      const identity = manager.deviceIdentity;
      if (!identity || !addresses.length) return;

      const publish = async () => {
        try {
          await api.registerDevice({ publicKey: identity.publicKey, addresses });
        } catch (err) {
          // 服务器不可用不影响已经建立的直连
          console.warn('[p2p] 上报设备端点失败', err);
        }
      };
      await publish();
      // 服务端 30 分钟不更新就认为地址过期，这里定期续一下
      heartbeat = setInterval(publish, 10 * 60 * 1000);
    })();

    return () => {
      cancelled = true;
      if (heartbeat) clearInterval(heartbeat);
      void manager.stop();
      if (peerRef.current === manager) peerRef.current = null;
    };
  }, [status, user, api, handlePeerEvent]);

  // 会话成员里带着好友的直连端点，拿到就尝试连过去
  useEffect(() => {
    if (!peerRef.current) return;
    peerRef.current.syncPeers(conversations.flatMap((c) => c.members));
  }, [conversations]);

  // 冷启动先渲染缓存，再请求服务端
  useEffect(() => {
    if (status !== 'signedIn') return;
    let cancelled = false;

    (async () => {
      const cached = await storage.getConversations();
      if (!cancelled && cached?.length) {
        setConversations(sortConversations(cached));
        setLoading(false);
      }
      if (!cancelled) await refresh();
    })();

    return () => {
      cancelled = true;
    };
  }, [status, refresh]);

  // 重新联网后补一次全量，把断线期间漏掉的消息拉回来
  const prevConnection = useRef<ConnectionState>('idle');
  useEffect(() => {
    if (prevConnection.current !== 'online' && connection === 'online') {
      void refresh();
      // 允许已打开过的会话重新拉一次历史
      fetchedRef.current.clear();
    }
    prevConnection.current = connection;
  }, [connection, refresh]);

  // 手机从后台回到前台时立即重连并刷新
  useEffect(() => {
    if (status !== 'signedIn') return;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        void rtRef.current?.connect();
        void refresh();
      }
    });
    return () => sub.remove();
  }, [status, refresh]);

  // 卸载时清掉所有 typing 定时器
  useEffect(() => {
    const timers = typingTimers.current;
    return () => {
      for (const timer of Object.values(timers)) clearTimeout(timer);
    };
  }, []);

  const channelOf = useCallback(
    (conversationId: string): Channel => {
      const peerId = peerIdOf(conversationId);
      const state = peerId ? peerStates[peerId] : undefined;
      if (state?.status === 'direct') {
        return state.route === 'ipv6' ? 'p2p-ipv6' : 'p2p-lan';
      }
      if (connection === 'online') return 'server';
      return 'none';
    },
    [connection, peerIdOf, peerStates],
  );

  const localPeerAddresses = useCallback(
    () => peerRef.current?.localPeerAddresses() ?? Promise.resolve([]),
    [],
  );

  const pairWithPayload = useCallback(
    async (payload: import('@chat/shared').PairingPayload) => {
      // 先在服务器上建好会话（拿到双方一致的 conversationId），再记住公钥去直连
      await openDirect(payload.userId).catch(() => undefined);
      await peerRef.current?.pairWith({
        userId: payload.userId,
        idPub: payload.idPub,
        addrs: payload.addrs,
      });
    },
    [openDirect],
  );

  const messagesOf = useCallback(
    (conversationId: string) => messages[conversationId] ?? [],
    [messages],
  );

  const typingIn = useCallback(
    (conversationId: string) => Object.keys(typing[conversationId] ?? {}),
    [typing],
  );

  const hasMoreIn = useCallback(
    (conversationId: string) => !exhausted[conversationId],
    [exhausted],
  );

  const loadingMoreIn = useCallback(
    (conversationId: string) => !!loadingMore[conversationId],
    [loadingMore],
  );

  const value = useMemo<ChatValue>(
    () => ({
      connection,
      conversations,
      loading,
      onlineUserIds,
      sendStatus,
      messagesOf,
      typingIn,
      hasMoreIn,
      loadingMoreIn,
      p2pAvailable: peerRef.current?.transportAvailable ?? false,
      p2pUnavailableReason: peerRef.current?.transportUnavailableReason ?? '',
      deviceIdPub: peerRef.current?.deviceIdentity?.publicKey ?? null,
      peerStates,
      channelOf,
      localPeerAddresses,
      pairWithPayload,
      refresh,
      ensureMessages,
      loadOlder,
      sendMessage,
      retryMessage,
      setTyping,
      markRead,
      openDirect,
    }),
    [
      connection,
      conversations,
      loading,
      onlineUserIds,
      sendStatus,
      messagesOf,
      typingIn,
      hasMoreIn,
      loadingMoreIn,
      peerStates,
      channelOf,
      localPeerAddresses,
      pairWithPayload,
      refresh,
      ensureMessages,
      loadOlder,
      sendMessage,
      retryMessage,
      setTyping,
      markRead,
      openDirect,
    ],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

function sortConversations(list: Conversation[]) {
  return [...list].sort((a, b) => {
    const ta = a.lastMessage?.createdAt ?? a.createdAt;
    const tb = b.lastMessage?.createdAt ?? b.createdAt;
    return tb - ta;
  });
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat 必须在 ChatProvider 内使用');
  return ctx;
}
