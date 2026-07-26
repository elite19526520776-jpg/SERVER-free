import React, { useCallback, useEffect, useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  conversationPeer,
  conversationTitle,
  formatDayDivider,
  shouldShowDivider,
} from '@chat/shared';
import type { Conversation, Message } from '@chat/shared';
import { spacing, useTheme } from '../theme';
import { useAuth } from '../state/AuthContext';
import { useChat } from '../state/ChatContext';
import { Avatar } from './Avatar';
import { ChannelBadge } from './ChannelBadge';
import { Composer } from './Composer';
import { EmptyState } from './EmptyState';
import { MessageBubble } from './MessageBubble';

interface Props {
  conversation: Conversation;
  /** 手机端显示返回按钮，桌面端不需要 */
  onBack?: () => void;
}

type Row =
  | { kind: 'divider'; key: string; label: string }
  | { kind: 'message'; key: string; message: Message; showAvatar: boolean };

export function ChatThread({ conversation, onBack }: Props) {
  const theme = useTheme();
  const { user } = useAuth();
  const {
    messagesOf,
    sendMessage,
    retryMessage,
    setTyping,
    markRead,
    ensureMessages,
    loadOlder,
    hasMoreIn,
    loadingMoreIn,
    sendStatus,
    onlineUserIds,
    typingIn,
    channelOf,
  } = useChat();

  const channel = channelOf(conversation.id);

  const selfId = user?.id ?? '';
  const messages = messagesOf(conversation.id);
  const peer = conversationPeer(conversation, selfId);
  const title = conversationTitle(conversation, selfId);
  const typers = typingIn(conversation.id);
  const online = peer ? onlineUserIds.has(peer.id) : false;

  useEffect(() => {
    void ensureMessages(conversation.id);
  }, [conversation.id, ensureMessages]);

  // 进入会话 / 有新消息时把已读位置推到最新
  useEffect(() => {
    if (messages.length) markRead(conversation.id);
  }, [conversation.id, messages.length, markRead]);

  /** 对方读到哪条了：该条及之前的自己发的消息都算已读 */
  const peerReadIndex = useMemo(() => {
    const readId = peer?.lastReadMessageId;
    if (!readId) return -1;
    return messages.findIndex((m) => m.id === readId);
  }, [messages, peer?.lastReadMessageId]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    messages.forEach((message, index) => {
      const prev = messages[index - 1];
      if (shouldShowDivider(prev, message)) {
        out.push({
          kind: 'divider',
          key: `d_${message.id}`,
          label: formatDayDivider(message.createdAt),
        });
      }
      const next = messages[index + 1];
      // 连续同一人发言时只在最后一条挂头像
      const showAvatar = !next || next.senderId !== message.senderId;
      out.push({ kind: 'message', key: message.id, message, showAvatar });
    });
    // inverted 列表需要倒序数据
    return out.reverse();
  }, [messages]);

  const renderRow = useCallback(
    ({ item }: { item: Row }) => {
      if (item.kind === 'divider') {
        return (
          <View style={styles.dividerWrap}>
            <Text style={[styles.dividerText, { color: theme.colors.textFaint }]}>
              {item.label}
            </Text>
          </View>
        );
      }
      const { message, showAvatar } = item;
      const isOwn = message.senderId === selfId;
      const sender = conversation.members.find((m) => m.id === message.senderId);
      const index = messages.findIndex((m) => m.id === message.id);
      return (
        <MessageBubble
          message={message}
          isOwn={isOwn}
          senderName={sender?.displayName ?? '未知'}
          senderColor={sender?.avatarColor ?? theme.colors.primary}
          showAvatar={showAvatar}
          status={message.clientId ? sendStatus[message.clientId] : undefined}
          read={isOwn && peerReadIndex >= 0 && index <= peerReadIndex}
          onRetry={retryMessage}
        />
      );
    },
    [
      conversation.members,
      messages,
      peerReadIndex,
      retryMessage,
      selfId,
      sendStatus,
      theme.colors.primary,
      theme.colors.textFaint,
    ],
  );

  const subtitle = typers.length
    ? '正在输入…'
    : peer
      ? online
        ? '在线'
        : '离线'
      : `${conversation.members.length} 人`;

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: theme.colors.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
    >
      <View
        style={[
          styles.header,
          { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.border },
        ]}
      >
        {!!onBack && (
          <Pressable accessibilityRole="button" accessibilityLabel="返回" onPress={onBack} hitSlop={8}>
            <Text style={[styles.back, { color: theme.colors.primary }]}>‹ 返回</Text>
          </Pressable>
        )}
        <Avatar name={title} color={peer?.avatarColor ?? theme.colors.primary} size={36} />
        <View style={styles.headerText}>
          <Text style={[styles.headerTitle, { color: theme.colors.text }]} numberOfLines={1}>
            {title}
          </Text>
          <Text
            style={[
              styles.headerSubtitle,
              {
                color: typers.length
                  ? theme.colors.primary
                  : online
                    ? theme.colors.success
                    : theme.colors.textFaint,
              },
            ]}
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        </View>
        <ChannelBadge channel={channel} />
      </View>

      <FlatList
        data={rows}
        inverted
        keyExtractor={(item) => item.key}
        renderItem={renderRow}
        contentContainerStyle={rows.length ? styles.listContent : styles.emptyContent}
        keyboardDismissMode="interactive"
        onEndReached={() => {
          if (hasMoreIn(conversation.id)) void loadOlder(conversation.id);
        }}
        onEndReachedThreshold={0.4}
        ListFooterComponent={
          loadingMoreIn(conversation.id) ? (
            <ActivityIndicator style={styles.loadMore} color={theme.colors.textFaint} />
          ) : null
        }
        ListEmptyComponent={
          <EmptyState
            icon="👋"
            title={`和 ${title} 的对话`}
            description="发条消息打个招呼吧。"
          />
        }
      />

      <Composer
        onSend={(body) => sendMessage(conversation.id, body)}
        onTypingChange={(on) => setTyping(conversation.id, on)}
        // 直连可用时即便服务器断了也照样能发
        disabled={channel === 'none'}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: {
    fontSize: 16,
    fontWeight: '500',
  },
  headerText: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  headerSubtitle: {
    fontSize: 12,
    marginTop: 1,
  },
  listContent: {
    paddingVertical: spacing.md,
  },
  emptyContent: {
    flexGrow: 1,
    justifyContent: 'center',
    // inverted 列表里空状态需要翻回来才是正的
    transform: [{ scaleY: -1 }],
  },
  dividerWrap: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  dividerText: {
    fontSize: 12,
  },
  loadMore: {
    paddingVertical: spacing.md,
  },
});
