import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmptyState } from '../../../src/components/EmptyState';
import { ChatThread } from '../../../src/components/ChatThread';
import { useResponsive } from '../../../src/hooks/useResponsive';
import { useChat } from '../../../src/state/ChatContext';
import { useUi } from '../../../src/state/UiContext';
import { useTheme } from '../../../src/theme';

/**
 * 手机端的聊天详情页。桌面端聊天内容常驻在右侧面板里，
 * 所以窗口变宽（或直接从链接打开）时把这个页面收起来，只保留选中态。
 */
export default function ChatDetailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isWide } = useResponsive();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { conversations, loading } = useChat();
  const { markSelected } = useUi();

  const conversation = conversations.find((c) => c.id === id) ?? null;

  // 用 markSelected 而不是 selectConversation：后者在窄屏下会再 push 一次本页面
  useEffect(() => {
    if (id) markSelected(id);
  }, [id, markSelected]);

  useEffect(() => {
    if (isWide) router.replace('/chats');
  }, [isWide, router]);

  if (!conversation) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.bg }]}>
        {loading ? (
          <ActivityIndicator color={theme.colors.primary} />
        ) : (
          <EmptyState
            icon="🤔"
            title="会话不存在"
            description="它可能已经被删除，返回列表看看别的对话吧。"
          />
        )}
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top, backgroundColor: theme.colors.bg }]}>
      <ChatThread conversation={conversation} onBack={() => router.back()} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
