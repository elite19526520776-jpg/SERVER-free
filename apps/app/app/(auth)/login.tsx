import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { AuthShell } from '../../src/components/AuthShell';
import { Button } from '../../src/components/Button';
import { TextField } from '../../src/components/TextField';
import { ServerUrlField } from '../../src/components/ServerUrlField';
import { spacing, useTheme } from '../../src/theme';
import { useAuth } from '../../src/state/AuthContext';

export default function LoginScreen() {
  const theme = useTheme();
  const { login } = useAuth();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showServer, setShowServer] = useState(false);

  async function onSubmit() {
    if (busy) return;
    setError(null);
    if (!username.trim() || !password) {
      setError('请填写用户名和密码');
      return;
    }
    setBusy(true);
    try {
      await login({ username: username.trim(), password });
    } catch (err: any) {
      setError(err?.message ?? '登录失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="欢迎回来" subtitle="登录后即可在手机和电脑上同步你的消息。">
      <TextField
        label="用户名"
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username"
        placeholder="你的用户名"
        returnKeyType="next"
      />
      <TextField
        label="密码"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        placeholder="至少 6 位"
        returnKeyType="go"
        onSubmitEditing={onSubmit}
        error={error}
      />

      <Button title="登录" onPress={onSubmit} loading={busy} style={styles.submit} />

      <View style={styles.links}>
        <Link href="/register" asChild>
          <Pressable accessibilityRole="link">
            <Text style={[styles.link, { color: theme.colors.primary }]}>没有账号？注册一个</Text>
          </Pressable>
        </Link>
        <Pressable accessibilityRole="button" onPress={() => setShowServer((v) => !v)}>
          <Text style={[styles.link, { color: theme.colors.textMuted }]}>
            {showServer ? '收起服务器设置' : '服务器设置'}
          </Text>
        </Pressable>
      </View>

      {showServer && <ServerUrlField />}
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  submit: {
    marginTop: spacing.sm,
  },
  links: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.lg,
    gap: spacing.md,
  },
  link: {
    fontSize: 14,
    fontWeight: '500',
  },
});
