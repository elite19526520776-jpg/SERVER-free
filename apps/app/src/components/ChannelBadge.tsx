import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { radius, spacing, useTheme } from '../theme';
import type { Channel } from '../state/ChatContext';

/** 让用户一眼看出这段对话到底走没走服务器 */
export function ChannelBadge({ channel, compact }: { channel: Channel; compact?: boolean }) {
  const theme = useTheme();

  const config = {
    'p2p-lan': { label: '局域网直连', short: '直连', color: theme.colors.success, icon: '🔒' },
    'p2p-ipv6': { label: 'IPv6 直连', short: '直连', color: theme.colors.success, icon: '🔒' },
    server: { label: '服务器中转', short: '中转', color: theme.colors.textFaint, icon: '☁️' },
    none: { label: '未连接', short: '离线', color: theme.colors.danger, icon: '⚠️' },
  }[channel];

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: theme.colors.elevated,
          borderColor: theme.colors.border,
          paddingVertical: compact ? 1 : 3,
        },
      ]}
    >
      <Text style={styles.icon}>{config.icon}</Text>
      <Text style={[styles.label, { color: config.color, fontSize: compact ? 10 : 11 }]}>
        {compact ? config.short : config.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 3,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  icon: {
    fontSize: 9,
  },
  label: {
    fontWeight: '600',
  },
});
