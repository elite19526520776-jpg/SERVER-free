import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, spacing, useTheme } from '../theme';
import { Avatar } from './Avatar';
import { useAuth } from '../state/AuthContext';
import type { TabItem } from './TabBar';

interface Props {
  items: TabItem[];
  activeKey: string;
  onSelect: (key: string) => void;
}

/** 桌面端最左侧的窄导航条（Windows / macOS 客户端） */
export function SideRail({ items, activeKey, onSelect }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  return (
    <View
      style={[
        styles.rail,
        {
          backgroundColor: theme.colors.sidebar,
          borderRightColor: theme.colors.border,
          paddingTop: insets.top + spacing.lg,
          paddingBottom: insets.bottom + spacing.lg,
        },
      ]}
    >
      {!!user && (
        <View style={styles.me}>
          <Avatar name={user.displayName} color={user.avatarColor} size={36} />
        </View>
      )}

      {items.map((item) => {
        const active = item.key === activeKey;
        return (
          <Pressable
            key={item.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={item.label}
            onPress={() => onSelect(item.key)}
            style={({ hovered }: any) => [
              styles.item,
              {
                backgroundColor: active
                  ? theme.colors.elevated
                  : hovered
                    ? theme.colors.ripple
                    : 'transparent',
              },
            ]}
          >
            <View>
              <Text style={[styles.icon, { opacity: active ? 1 : 0.6 }]}>{item.icon}</Text>
              {!!item.badge && item.badge > 0 && (
                <View style={[styles.badge, { backgroundColor: theme.colors.unread }]}>
                  <Text style={styles.badgeText}>{item.badge > 99 ? '99+' : item.badge}</Text>
                </View>
              )}
            </View>
            <Text
              style={[
                styles.label,
                { color: active ? theme.colors.text : theme.colors.textFaint },
              ]}
            >
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  rail: {
    width: 78,
    alignItems: 'center',
    borderRightWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
  },
  me: {
    marginBottom: spacing.lg,
  },
  item: {
    width: 60,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    alignItems: 'center',
    gap: 3,
  },
  icon: {
    fontSize: 20,
  },
  label: {
    fontSize: 11,
    fontWeight: '500',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -10,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
});
