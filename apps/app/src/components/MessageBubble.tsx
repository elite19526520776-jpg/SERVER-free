import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { formatClock } from '@chat/shared';
import type { Message } from '@chat/shared';
import { radius, spacing, useTheme } from '../theme';
import type { SendStatus } from '../state/ChatContext';
import { Avatar } from './Avatar';

interface Props {
  message: Message;
  isOwn: boolean;
  senderName: string;
  senderColor: string;
  /** 连续同一人发言时只在最后一条显示头像 */
  showAvatar: boolean;
  status?: SendStatus;
  /** 自己发的消息是否已被对方读过 */
  read?: boolean;
  onRetry?: (message: Message) => void;
}

export function MessageBubble({
  message,
  isOwn,
  senderName,
  senderColor,
  showAvatar,
  status,
  read,
  onRetry,
}: Props) {
  const theme = useTheme();

  if (message.kind === 'system') {
    return (
      <View style={styles.systemWrap}>
        <Text style={[styles.systemText, { color: theme.colors.textFaint }]}>{message.body}</Text>
      </View>
    );
  }

  const bubbleBg = isOwn ? theme.colors.bubbleOut : theme.colors.bubbleIn;
  const bubbleFg = isOwn ? theme.colors.bubbleOutText : theme.colors.bubbleInText;
  const failed = status === 'failed';

  return (
    <View style={[styles.row, isOwn ? styles.rowOwn : styles.rowOther]}>
      {!isOwn &&
        (showAvatar ? (
          <Avatar name={senderName} color={senderColor} size={32} />
        ) : (
          <View style={styles.avatarSpacer} />
        ))}

      <View style={[styles.column, isOwn ? styles.columnOwn : styles.columnOther]}>
        <View
          style={[
            styles.bubble,
            {
              backgroundColor: bubbleBg,
              borderColor: isOwn ? 'transparent' : theme.colors.border,
              borderTopLeftRadius: isOwn ? radius.lg : radius.sm,
              borderTopRightRadius: isOwn ? radius.sm : radius.lg,
            },
          ]}
        >
          <Text style={[styles.body, { color: bubbleFg }]} selectable>
            {message.body}
          </Text>
        </View>

        <View style={[styles.meta, isOwn ? styles.metaOwn : styles.metaOther]}>
          <Text style={[styles.time, { color: theme.colors.textFaint }]}>
            {formatClock(message.createdAt)}
          </Text>
          {isOwn && status === 'sending' && (
            <ActivityIndicator size="small" color={theme.colors.textFaint} />
          )}
          {isOwn && failed && (
            <Pressable accessibilityRole="button" onPress={() => onRetry?.(message)}>
              <Text style={[styles.retry, { color: theme.colors.danger }]}>发送失败，点击重试</Text>
            </Pressable>
          )}
          {isOwn && !status && (
            <Text style={[styles.time, { color: read ? theme.colors.primary : theme.colors.textFaint }]}>
              {read ? '已读' : '已送达'}
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  rowOwn: {
    justifyContent: 'flex-end',
  },
  rowOther: {
    justifyContent: 'flex-start',
  },
  avatarSpacer: {
    width: 32,
  },
  column: {
    maxWidth: '78%',
  },
  columnOwn: {
    alignItems: 'flex-end',
  },
  columnOther: {
    alignItems: 'flex-start',
  },
  bubble: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  body: {
    fontSize: 15.5,
    lineHeight: 22,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    marginTop: 3,
    paddingHorizontal: spacing.xs,
  },
  metaOwn: {
    justifyContent: 'flex-end',
  },
  metaOther: {
    justifyContent: 'flex-start',
  },
  time: {
    fontSize: 11,
  },
  retry: {
    fontSize: 11,
    fontWeight: '600',
  },
  systemWrap: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  systemText: {
    fontSize: 12,
    textAlign: 'center',
  },
});
