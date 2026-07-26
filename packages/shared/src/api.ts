import type {
  AuthResult,
  Conversation,
  LoginBody,
  Message,
  RegisterBody,
  User,
} from './types.js';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }

  /** 401/403：本地 token 已失效，调用方应登出 */
  get isAuthError() {
    return this.status === 401 || this.status === 403;
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  /** 每次请求时读取 token；返回 null 表示未登录 */
  getToken?: () => string | null | Promise<string | null>;
  /** 收到 401 时的回调，通常用来触发登出 */
  onUnauthorized?: () => void;
  fetchImpl?: typeof fetch;
}

/**
 * 纯 fetch 实现，React Native / 浏览器 / Node 都能直接跑。
 */
export class ApiClient {
  private baseUrl: string;
  private getToken: () => string | null | Promise<string | null>;
  private onUnauthorized?: () => void;
  private fetchImpl: typeof fetch;

  constructor(opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.getToken = opts.getToken ?? (() => null);
    this.onUnauthorized = opts.onUnauthorized;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  setBaseUrl(url: string) {
    this.baseUrl = url.replace(/\/+$/, '');
  }

  getBaseUrl() {
    return this.baseUrl;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const token = await this.getToken();
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (cause) {
      throw new ApiError(0, 'network_error', '无法连接服务器，请检查网络或服务器地址');
    }

    if (res.status === 204) return undefined as T;

    const text = await res.text();
    let payload: unknown = undefined;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = undefined;
      }
    }

    if (!res.ok) {
      const shape = payload as { error?: string; message?: string } | undefined;
      if (res.status === 401 || res.status === 403) this.onUnauthorized?.();
      throw new ApiError(
        res.status,
        shape?.error ?? 'http_error',
        shape?.message ?? `请求失败 (${res.status})`,
      );
    }

    return payload as T;
  }

  /* -------------------------- auth -------------------------- */

  register(body: RegisterBody) {
    return this.request<AuthResult>('POST', '/api/auth/register', body);
  }

  login(body: LoginBody) {
    return this.request<AuthResult>('POST', '/api/auth/login', body);
  }

  me() {
    return this.request<User>('GET', '/api/me');
  }

  /* ----------------------- users / convs ---------------------- */

  searchUsers(q: string) {
    return this.request<User[]>('GET', `/api/users/search?q=${encodeURIComponent(q)}`);
  }

  listConversations() {
    return this.request<Conversation[]>('GET', '/api/conversations');
  }

  /** 与某人开始私聊；已存在则直接返回原会话 */
  openDirectConversation(userId: string) {
    return this.request<Conversation>('POST', '/api/conversations/direct', { userId });
  }

  /**
   * 拉取历史消息，按时间升序返回。
   * before 传最早一条消息的 id 用于向上翻页。
   */
  listMessages(conversationId: string, opts: { before?: string; limit?: number } = {}) {
    const params = new URLSearchParams();
    if (opts.before) params.set('before', opts.before);
    if (opts.limit) params.set('limit', String(opts.limit));
    const qs = params.toString();
    return this.request<Message[]>(
      'GET',
      `/api/conversations/${conversationId}/messages${qs ? `?${qs}` : ''}`,
    );
  }

  markRead(conversationId: string, messageId: string) {
    return this.request<void>('POST', `/api/conversations/${conversationId}/read`, {
      messageId,
    });
  }

  health() {
    return this.request<{ ok: true; version: string }>('GET', '/api/health');
  }
}
