import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { LIMITS, USERNAME_RE } from '@chat/shared';
import { AuthShell } from '../../src/components/AuthShell';
import { Button } from '../../src/components/Button';
import { TextField } from '../../src/components/TextField';
import { ServerUrlField } from '../../src/components/ServerUrlField';
import { spacing, useTheme } from '../../src/theme';
import { useAuth } from '../../src/state/AuthContext';

export default function RegisterScreen() {
  const theme = useTheme();
  const { register } = useAuth();

  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showServer, setShowServer] = useState(false);

  async function onSubmit() {
    if (busy) return;
    setError(null);

    const name = username.trim();
    if (!USERNAME_RE.test(name)) {
      setError(
        `用户名需 ${LIMITS.usernameMin}-${LIMITS.usernameMax} 位，字母开头，只能含字母、数字和下划线`,
      );
      return;
    }
    if (password.length < LIMITS.passwordMin) {
      setError(`密码至少 ${LIMITS.passwordMin} 位`);
      return;
    }

    setBusy(true);
    try {
      await register({
        username: name,
        password,
        displayName: displayName.trim() || name,
      });
    } catch (err: any) {
      setError(err?.message ?? '注册失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="创建账号" subtitle="用户名是别人搜索你的凭据，注册后不可修改。">
      <TextField
        label="用户名"
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="字母开头，如 alice_2026"
      />
      <TextField
        label="昵称"
        value={displayName}
        onChangeText={setDisplayName}
        placeholder="别人看到的名字，可留空"
        maxLength={LIMITS.displayNameMax}
      />
      <TextField
        label="密码"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
        placeholder={`至少 ${LIMITS.passwordMin} 位`}
        returnKeyType="go"
        onSubmitEditing={onSubmit}
        error={error}
      />

      <Button title="注册并登录" onPress={onSubmit} loading={busy} style={styles.submit} />

      <View style={styles.links}>
        <Link href="/login" asChild>
          <Pressable accessibilityRole="link">
            <Text style={[styles.link, { color: theme.colors.primary }]}>已有账号，去登录</Text>
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
