import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, spacing, useTheme } from '../theme';
import { useResponsive } from '../hooks/useResponsive';

interface Props {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

/** 登录 / 注册的公共外壳：手机端铺满，桌面端居中成一张卡片 */
export function AuthShell({ title, subtitle, children, footer }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { isWide } = useResponsive();

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: theme.colors.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          {
            paddingTop: insets.top + spacing.xl,
            paddingBottom: insets.bottom + spacing.xl,
          },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={[
            styles.card,
            isWide && {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              borderWidth: StyleSheet.hairlineWidth,
              padding: spacing.xxl,
              borderRadius: radius.lg,
            },
          ]}
        >
          <View style={[styles.logo, { backgroundColor: theme.colors.primary }]}>
            <Text style={styles.logoText}>聊</Text>
          </View>
          <Text style={[styles.title, { color: theme.colors.text }]}>{title}</Text>
          {!!subtitle && (
            <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>{subtitle}</Text>
          )}
          <View style={styles.form}>{children}</View>
          {!!footer && <View style={styles.footer}>{footer}</View>}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 420,
  },
  logo: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  logoText: {
    color: '#fff',
    fontSize: 26,
    fontWeight: '700',
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 14,
    marginTop: spacing.sm,
    lineHeight: 20,
  },
  form: {
    marginTop: spacing.xl,
  },
  footer: {
    marginTop: spacing.lg,
  },
});
