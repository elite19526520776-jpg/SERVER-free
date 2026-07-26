import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Conversation, Message, User } from '@chat/shared';

const KEYS = {
  token: 'chat.token',
  user: 'chat.user',
  serverUrl: 'chat.serverUrl',
  conversations: 'chat.cache.conversations',
  messages: (id: string) => `chat.cache.messages.${id}`,
} as const;

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

async function writeJson(key: string, value: unknown) {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 存储写失败不影响主流程，忽略即可 */
  }
}

export const storage = {
  getToken: () => AsyncStorage.getItem(KEYS.token),
  setToken: (token: string) => AsyncStorage.setItem(KEYS.token, token),

  getUser: () => readJson<User>(KEYS.user),
  setUser: (user: User) => writeJson(KEYS.user, user),

  getServerUrl: () => AsyncStorage.getItem(KEYS.serverUrl),
  setServerUrl: (url: string) => AsyncStorage.setItem(KEYS.serverUrl, url),

  /** 会话列表缓存：冷启动时先显示上次的内容，再后台刷新 */
  getConversations: () => readJson<Conversation[]>(KEYS.conversations),
  setConversations: (list: Conversation[]) => writeJson(KEYS.conversations, list),

  /** 每个会话只缓存最近 100 条，够填满首屏 */
  getMessages: (conversationId: string) => readJson<Message[]>(KEYS.messages(conversationId)),
  setMessages: (conversationId: string, messages: Message[]) =>
    writeJson(KEYS.messages(conversationId), messages.slice(-100)),

  /** 登出时清掉账号相关数据，但保留服务器地址 */
  async clearSession() {
    const keys = await AsyncStorage.getAllKeys();
    const toRemove = keys.filter((k) => k.startsWith('chat.') && k !== KEYS.serverUrl);
    if (toRemove.length) await AsyncStorage.multiRemove(toRemove);
  },
};
