import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { spacing, useTheme } from '../theme';
import { useChat } from '../state/ChatContext';

/**
 * 顶部的连接状态条。online 时完全不占位，
 * 断线/重连时才出现，避免正常使用时干扰。
 */
export function ConnectionBanner() {
  const theme = useTheme();
  const { connection } = useChat();

  if (connection === 'online' || connection === 'idle') return null;

  const connecting = connection === 'connecting';
  const text = connecting ? '正在连接服务器…' : '已断开，正在自动重连…';
  const bg = connecting ? theme.colors.elevated : theme.colors.danger;
  const fg = connecting ? theme.colors.textMuted : '#fff';

  return (
    <View style={[styles.bar, { backgroundColor: bg }]}>
      <ActivityIndicator size="small" color={fg} />
      <Text style={[styles.text, { color: fg }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  text: {
    fontSize: 13,
    fontWeight: '500',
  },
});
