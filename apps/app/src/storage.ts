import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Conversation, DeviceIdentity, Message, User } from '@chat/shared';

const KEYS = {
  token: 'chat.token',
  user: 'chat.user',
  serverUrl: 'chat.serverUrl',
  conversations: 'chat.cache.conversations',
  messages: (id: string) => `chat.cache.messages.${id}`,
  // 设备密钥不随登出清除：它标识的是这台设备，不是这个账号
  deviceIdentity: 'chat.device.identity',
  p2pEnabled: 'chat.p2p.enabled',
  // 扫码配对过的好友，记住公钥用于防中间人
  pinnedKeys: 'chat.p2p.pinnedKeys',
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

  /* ----------------------------- P2P ----------------------------- */

  getDeviceIdentity: () => readJson<DeviceIdentity>(KEYS.deviceIdentity),
  setDeviceIdentity: (identity: DeviceIdentity) => writeJson(KEYS.deviceIdentity, identity),

  async getP2pEnabled() {
    const raw = await AsyncStorage.getItem(KEYS.p2pEnabled);
    return raw === null ? true : raw === '1';
  },
  setP2pEnabled: (on: boolean) => AsyncStorage.setItem(KEYS.p2pEnabled, on ? '1' : '0'),

  /** userId -> 已确认的设备公钥。扫码配对时写入，之后握手都拿它校验。 */
  async getPinnedKeys(): Promise<Record<string, string>> {
    return (await readJson<Record<string, string>>(KEYS.pinnedKeys)) ?? {};
  },
  async pinKey(userId: string, publicKey: string) {
    const pinned = await this.getPinnedKeys();
    pinned[userId] = publicKey;
    await writeJson(KEYS.pinnedKeys, pinned);
  },

  /**
   * 登出时清掉账号相关数据。
   * 保留服务器地址和设备密钥——后者标识这台设备本身，重新登录还要用。
   */
  async clearSession() {
    const keep = new Set<string>([KEYS.serverUrl, KEYS.deviceIdentity, KEYS.p2pEnabled]);
    const keys = await AsyncStorage.getAllKeys();
    const toRemove = keys.filter((k) => k.startsWith('chat.') && !keep.has(k));
    if (toRemove.length) await AsyncStorage.multiRemove(toRemove);
  },
};
