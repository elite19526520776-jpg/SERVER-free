import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { spacing, useTheme } from '../theme';

interface Props {
  icon?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon, title, description, action }: Props) {
  const theme = useTheme();
  return (
    <View style={styles.wrapper}>
      {!!icon && <Text style={styles.icon}>{icon}</Text>}
      <Text style={[styles.title, { color: theme.colors.text }]}>{title}</Text>
      {!!description && (
        <Text style={[styles.description, { color: theme.colors.textMuted }]}>{description}</Text>
      )}
      {!!action && <View style={styles.action}>{action}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
  },
  icon: {
    fontSize: 44,
    marginBottom: spacing.md,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
  },
  description: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 21,
    maxWidth: 320,
  },
  action: {
    marginTop: spacing.lg,
  },
});
