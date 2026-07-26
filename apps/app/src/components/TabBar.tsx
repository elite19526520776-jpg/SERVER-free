import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing, useTheme } from '../theme';

export interface TabItem {
  key: string;
  label: string;
  icon: string;
  badge?: number;
}

interface Props {
  items: TabItem[];
  activeKey: string;
  onSelect: (key: string) => void;
}

/** 手机端底部标签栏 */
export function TabBar({ items, activeKey, onSelect }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
          paddingBottom: Math.max(insets.bottom, spacing.sm),
        },
      ]}
    >
      {items.map((item) => {
        const active = item.key === activeKey;
        return (
          <Pressable
            key={item.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={item.label}
            onPress={() => onSelect(item.key)}
            style={styles.item}
          >
            <View>
              <Text style={[styles.icon, { opacity: active ? 1 : 0.55 }]}>{item.icon}</Text>
              {!!item.badge && item.badge > 0 && (
                <View style={[styles.badge, { backgroundColor: theme.colors.unread }]}>
                  <Text style={styles.badgeText}>{item.badge > 99 ? '99+' : item.badge}</Text>
                </View>
              )}
            </View>
            <Text
              style={[
                styles.label,
                { color: active ? theme.colors.primary : theme.colors.textFaint },
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
  bar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.sm,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  icon: {
    fontSize: 21,
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
