import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ApiClient } from '@chat/shared';
import type { LoginBody, RegisterBody, User } from '@chat/shared';
import { guessServerUrl, normalizeServerUrl } from '../config';
import { storage } from '../storage';

type Status = 'loading' | 'signedOut' | 'signedIn';

interface AuthValue {
  status: Status;
  user: User | null;
  serverUrl: string;
  api: ApiClient;
  login: (body: LoginBody) => Promise<void>;
  register: (body: RegisterBody) => Promise<void>;
  logout: () => Promise<void>;
  changeServerUrl: (url: string) => Promise<void>;
  /** 供实时连接读取 token */
  getToken: () => string | null;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [serverUrl, setServerUrl] = useState<string>(() => guessServerUrl());

  // token 放 ref：ApiClient / RealtimeClient 每次请求时现读，避免闭包拿到旧值
  const tokenRef = useRef<string | null>(null);
  const getToken = useCallback(() => tokenRef.current, []);

  const signOutRef = useRef<() => void>(() => {});

  const api = useMemo(
    () =>
      new ApiClient({
        baseUrl: serverUrl,
        getToken,
        onUnauthorized: () => signOutRef.current(),
      }),
    // baseUrl 变化时通过 setBaseUrl 更新，不重建实例
    [getToken],
  );

  useEffect(() => {
    api.setBaseUrl(serverUrl);
  }, [api, serverUrl]);

  const clearSession = useCallback(async () => {
    tokenRef.current = null;
    setUser(null);
    setStatus('signedOut');
    await storage.clearSession();
  }, []);

  signOutRef.current = () => {
    void clearSession();
  };

  // 冷启动：恢复服务器地址和登录态
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const savedUrl = await storage.getServerUrl();
      const effectiveUrl = savedUrl || guessServerUrl();
      if (cancelled) return;
      setServerUrl(effectiveUrl);
      api.setBaseUrl(effectiveUrl);

      const [token, cachedUser] = await Promise.all([storage.getToken(), storage.getUser()]);
      if (cancelled) return;

      if (!token) {
        setStatus('signedOut');
        return;
      }

      tokenRef.current = token;
      // 先用本地缓存的用户信息进入主界面，不阻塞在 loading 上；
      // 再向服务器校验 token，失效才踢回登录页。
      if (cachedUser) {
        setUser(cachedUser);
        setStatus('signedIn');
      }

      try {
        const fresh = await api.me();
        if (cancelled) return;
        setUser(fresh);
        setStatus('signedIn');
        void storage.setUser(fresh);
      } catch (err: any) {
        if (cancelled) return;
        // 网络不通时保留登录态离线可用，只有明确 401/403 才登出
        if (err?.isAuthError) {
          await clearSession();
        } else if (!cachedUser) {
          setStatus('signedOut');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [api, clearSession]);

  const applyAuth = useCallback(async (token: string, nextUser: User) => {
    tokenRef.current = token;
    setUser(nextUser);
    setStatus('signedIn');
    await Promise.all([storage.setToken(token), storage.setUser(nextUser)]);
  }, []);

  const login = useCallback(
    async (body: LoginBody) => {
      const res = await api.login(body);
      await applyAuth(res.token, res.user);
    },
    [api, applyAuth],
  );

  const register = useCallback(
    async (body: RegisterBody) => {
      const res = await api.register(body);
      await applyAuth(res.token, res.user);
    },
    [api, applyAuth],
  );

  const logout = useCallback(async () => {
    await clearSession();
  }, [clearSession]);

  const changeServerUrl = useCallback(async (url: string) => {
    const normalized = normalizeServerUrl(url);
    await storage.setServerUrl(normalized);
    setServerUrl(normalized);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ status, user, serverUrl, api, login, register, logout, changeServerUrl, getToken }),
    [status, user, serverUrl, api, login, register, logout, changeServerUrl, getToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return ctx;
}
