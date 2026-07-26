import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Slot, Stack, usePathname, useRouter } from 'expo-router';
import { ChatThread } from '../../src/components/ChatThread';
import { ConnectionBanner } from '../../src/components/ConnectionBanner';
import { EmptyState } from '../../src/components/EmptyState';
import { SideRail } from '../../src/components/SideRail';
import { TabBar } from '../../src/components/TabBar';
import type { TabItem } from '../../src/components/TabBar';
import { useResponsive } from '../../src/hooks/useResponsive';
import { useChat } from '../../src/state/ChatContext';
import { useUi } from '../../src/state/UiContext';
import { useTheme } from '../../src/theme';

const TAB_ROUTES = ['/chats', '/contacts', '/me'] as const;

export default function MainLayout() {
  const theme = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const { isWide } = useResponsive();
  const { conversations } = useChat();
  const { selectedConversationId } = useUi();

  const totalUnread = useMemo(
    () => conversations.reduce((sum, c) => sum + c.unreadCount, 0),
    [conversations],
  );

  const items = useMemo<TabItem[]>(
    () => [
      { key: '/chats', label: '消息', icon: '💬', badge: totalUnread },
      { key: '/contacts', label: '通讯录', icon: '👥' },
      { key: '/me', label: '我', icon: '⚙️' },
    ],
    [totalUnread],
  );

  const activeKey = TAB_ROUTES.find((r) => pathname.startsWith(r)) ?? '/chats';
  const onTabsScreen = (TAB_ROUTES as readonly string[]).includes(pathname);

  const selected = conversations.find((c) => c.id === selectedConversationId) ?? null;

  if (isWide) {
    // 桌面端：导航条 + 列表栏 + 会话详情，三栏常驻
    return (
      <View style={[styles.root, { backgroundColor: theme.colors.bg }]}>
        <ConnectionBanner />
        <View style={styles.row}>
          <SideRail
            items={items}
            activeKey={activeKey}
            onSelect={(key) => router.replace(key as any)}
          />
          <View
            style={[
              styles.listPane,
              { backgroundColor: theme.colors.surface, borderRightColor: theme.colors.border },
            ]}
          >
            <Slot />
          </View>
          <View style={styles.detailPane}>
            {selected ? (
              <ChatThread conversation={selected} />
            ) : (
              <EmptyState
                icon="💬"
                title="选择一个会话开始聊天"
                description="左侧列表点一下就能进入对话；还没有联系人的话，先去「通讯录」搜一个。"
              />
            )}
          </View>
        </View>
      </View>
    );
  }

  // 手机端：单栏 + 底部标签栏，聊天页盖住标签栏
  return (
    <View style={[styles.root, { backgroundColor: theme.colors.bg }]}>
      <ConnectionBanner />
      <View style={styles.flex}>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.colors.bg },
          }}
        />
      </View>
      {onTabsScreen && (
        <TabBar
          items={items}
          activeKey={activeKey}
          onSelect={(key) => router.replace(key as any)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  row: {
    flex: 1,
    flexDirection: 'row',
  },
  listPane: {
    width: 340,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  detailPane: {
    flex: 1,
  },
});
