import React, { useCallback } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { conversationPeer, conversationTitle, formatListTime, previewOf } from '@chat/shared';
import type { Conversation } from '@chat/shared';
import { radius, spacing, useTheme } from '../theme';
import { useAuth } from '../state/AuthContext';
import { useChat } from '../state/ChatContext';
import { Avatar } from './Avatar';
import { EmptyState } from './EmptyState';

interface Props {
  activeId?: string | null;
  onSelect: (conversation: Conversation) => void;
  /** 桌面端侧栏不需要下拉刷新 */
  refreshable?: boolean;
  emptyAction?: React.ReactNode;
}

export function ConversationList({
  activeId,
  onSelect,
  refreshable = true,
  emptyAction,
}: Props) {
  const theme = useTheme();
  const { user } = useAuth();
  const { conversations, refresh, loading, onlineUserIds, typingIn } = useChat();
  const [refreshing, setRefreshing] = React.useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const renderItem = useCallback(
    ({ item }: { item: Conversation }) => {
      const selfId = user?.id ?? '';
      const title = conversationTitle(item, selfId);
      const peer = conversationPeer(item, selfId);
      const active = item.id === activeId;
      const typers = typingIn(item.id);

      return (
        <Pressable
          accessibilityRole="button"
          onPress={() => onSelect(item)}
          style={({ pressed, hovered }: any) => [
            styles.row,
            {
              backgroundColor: active
                ? theme.colors.elevated
                : pressed || hovered
                  ? theme.colors.ripple
                  : 'transparent',
            },
          ]}
        >
          <Avatar
            name={title}
            color={peer?.avatarColor ?? theme.colors.primary}
            online={peer ? onlineUserIds.has(peer.id) : undefined}
          />
          <View style={styles.center}>
            <View style={styles.titleRow}>
              <Text style={[styles.title, { color: theme.colors.text }]} numberOfLines={1}>
                {title}
              </Text>
              <Text style={[styles.time, { color: theme.colors.textFaint }]}>
                {item.lastMessage ? formatListTime(item.lastMessage.createdAt) : ''}
              </Text>
            </View>
            <View style={styles.previewRow}>
              <Text
                style={[
                  styles.preview,
                  { color: typers.length ? theme.colors.primary : theme.colors.textMuted },
                ]}
                numberOfLines={1}
              >
                {typers.length ? '正在输入…' : previewOf(item.lastMessage)}
              </Text>
              {item.unreadCount > 0 && (
                <View style={[styles.badge, { backgroundColor: theme.colors.unread }]}>
                  <Text style={styles.badgeText}>
                    {item.unreadCount > 99 ? '99+' : item.unreadCount}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </Pressable>
      );
    },
    [activeId, onSelect, onlineUserIds, theme, typingIn, user?.id],
  );

  return (
    <FlatList
      data={conversations}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      contentContainerStyle={conversations.length ? styles.listContent : styles.emptyContent}
      refreshControl={
        refreshable ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.textMuted}
          />
        ) : undefined
      }
      ListEmptyComponent={
        loading ? null : (
          <EmptyState
            icon="💬"
            title="还没有会话"
            description="去「通讯录」搜索用户名，就能开始第一段聊天。"
            action={emptyAction}
          />
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  listContent: {
    paddingVertical: spacing.xs,
  },
  emptyContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md - 2,
    marginHorizontal: spacing.sm,
    borderRadius: radius.md,
    gap: spacing.md,
  },
  center: {
    flex: 1,
    gap: 3,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
  },
  time: {
    fontSize: 12,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  preview: {
    flex: 1,
    fontSize: 14,
  },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
});
