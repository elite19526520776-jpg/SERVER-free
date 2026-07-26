import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { useResponsive } from '../hooks/useResponsive';

interface UiValue {
  /** 桌面端右侧详情面板当前显示的会话 */
  selectedConversationId: string | null;
  /** 手机端跳转到聊天页，桌面端只切换右侧面板 */
  selectConversation: (id: string) => void;
  /** 只同步选中态，不做任何跳转（聊天页自己已经在路由里了） */
  markSelected: (id: string) => void;
  clearSelection: () => void;
}

const UiContext = createContext<UiValue | null>(null);

export function UiProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { isWide } = useResponsive();
  const [selectedConversationId, setSelected] = useState<string | null>(null);

  const selectConversation = useCallback(
    (id: string) => {
      setSelected(id);
      if (!isWide) router.push(`/chat/${id}`);
    },
    [isWide, router],
  );

  const markSelected = useCallback((id: string) => setSelected(id), []);
  const clearSelection = useCallback(() => setSelected(null), []);

  const value = useMemo<UiValue>(
    () => ({ selectedConversationId, selectConversation, markSelected, clearSelection }),
    [selectedConversationId, selectConversation, markSelected, clearSelection],
  );

  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

export function useUi() {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error('useUi 必须在 UiProvider 内使用');
  return ctx;
}
