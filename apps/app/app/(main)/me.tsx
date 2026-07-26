import React from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '../../src/components/Avatar';
import { Button } from '../../src/components/Button';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { ServerUrlField } from '../../src/components/ServerUrlField';
import { useAuth } from '../../src/state/AuthContext';
import { useChat } from '../../src/state/ChatContext';
import { useUi } from '../../src/state/UiContext';
import { radius, spacing, useTheme } from '../../src/theme';

const PLATFORM_LABEL: Record<string, string> = {
  ios: 'iOS',
  android: 'Android',
  web: '桌面 / 浏览器',
  macos: 'macOS',
  windows: 'Windows',
};

export default function MeScreen() {
  const theme = useTheme();
  const { user, logout, serverUrl } = useAuth();
  const { connection } = useChat();
  const { clearSelection } = useUi();

  const connectionLabel = {
    online: '已连接',
    connecting: '连接中…',
    offline: '已断开，正在重连',
    idle: '未连接',
  }[connection];

  const connectionColor = {
    online: theme.colors.success,
    connecting: theme.colors.textMuted,
    offline: theme.colors.danger,
    idle: theme.colors.textFaint,
  }[connection];

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.surface }]}>
      <ScreenHeader title="我" />
      <ScrollView contentContainerStyle={styles.content}>
        {!!user && (
          <View
            style={[
              styles.card,
              { backgroundColor: theme.colors.elevated, borderColor: theme.colors.border },
            ]}
          >
            <Avatar name={user.displayName} color={user.avatarColor} size={64} />
            <View style={styles.identity}>
              <Text style={[styles.displayName, { color: theme.colors.text }]} numberOfLines={1}>
                {user.displayName}
              </Text>
              <Text style={[styles.username, { color: theme.colors.textMuted }]} numberOfLines={1}>
                @{user.username}
              </Text>
            </View>
          </View>
        )}

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.colors.textFaint }]}>连接状态</Text>
          <Row label="实时连接" value={connectionLabel} valueColor={connectionColor} />
          <Row label="当前平台" value={PLATFORM_LABEL[Platform.OS] ?? Platform.OS} />
          <Row label="服务器" value={serverUrl} />
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.colors.textFaint }]}>服务器设置</Text>
          <ServerUrlField />
        </View>

        <Button
          title="退出登录"
          variant="danger"
          style={styles.logout}
          onPress={() => {
            clearSelection();
            void logout();
          }}
        />
      </ScrollView>
    </View>
  );
}

function Row({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.row, { borderBottomColor: theme.colors.border }]}>
      <Text style={[styles.rowLabel, { color: theme.colors.textMuted }]}>{label}</Text>
      <Text
        style={[styles.rowValue, { color: valueColor ?? theme.colors.text }]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  identity: {
    flex: 1,
  },
  displayName: {
    fontSize: 20,
    fontWeight: '700',
  },
  username: {
    fontSize: 14,
    marginTop: 3,
  },
  section: {
    marginTop: spacing.xl,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: {
    fontSize: 14,
  },
  rowValue: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'right',
  },
  logout: {
    marginTop: spacing.xxl,
  },
});
