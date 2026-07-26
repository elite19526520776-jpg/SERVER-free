import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { radius, spacing, useTheme } from '../theme';

interface Props {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  style,
}: Props) {
  const theme = useTheme();
  const inert = disabled || loading;

  const bg = {
    primary: theme.colors.primary,
    secondary: theme.colors.elevated,
    ghost: 'transparent',
    danger: theme.colors.danger,
  }[variant];

  const fg = {
    primary: theme.colors.primaryText,
    secondary: theme.colors.text,
    ghost: theme.colors.primary,
    danger: '#fff',
  }[variant];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inert, busy: loading }}
      onPress={inert ? undefined : onPress}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: bg,
          borderColor: variant === 'ghost' ? 'transparent' : theme.colors.border,
          opacity: inert ? 0.55 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      <View style={styles.content}>
        {loading && <ActivityIndicator size="small" color={fg} style={styles.spinner} />}
        <Text style={[styles.label, { color: fg }]} numberOfLines={1}>
          {title}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 46,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  spinner: {
    marginRight: spacing.sm,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
  },
});
