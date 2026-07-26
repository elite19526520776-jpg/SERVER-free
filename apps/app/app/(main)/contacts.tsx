import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import type { User } from '@chat/shared';
import { Avatar } from '../../src/components/Avatar';
import { EmptyState } from '../../src/components/EmptyState';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { TextField } from '../../src/components/TextField';
import { useAuth } from '../../src/state/AuthContext';
import { useChat } from '../../src/state/ChatContext';
import { useUi } from '../../src/state/UiContext';
import { radius, spacing, useTheme } from '../../src/theme';

export default function ContactsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { api } = useAuth();
  const { openDirect, onlineUserIds } = useChat();
  const { selectConversation } = useUi();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  // 输入停 300ms 再发请求，避免每敲一个字都打一次接口
  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setResults([]);
      setError(null);
      setSearching(false);
      return;
    }

    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const found = await api.searchUsers(term);
        if (!cancelled) {
          setResults(found);
          setError(null);
        }
      } catch (err: any) {
        if (!cancelled) {
          setResults([]);
          setError(err?.message ?? '搜索失败');
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, query]);

  const startChat = useCallback(
    async (user: User) => {
      setOpeningId(user.id);
      try {
        const conv = await openDirect(user.id);
        selectConversation(conv.id);
      } catch (err: any) {
        setError(err?.message ?? '无法创建会话');
      } finally {
        setOpeningId(null);
      }
    },
    [openDirect, selectConversation],
  );

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.surface }]}>
      <ScreenHeader
        title="通讯录"
        subtitle="按用户名或昵称搜索"
        right={
          <Pressable accessibilityRole="button" onPress={() => router.push('/pair')} hitSlop={8}>
            <Text style={[styles.pairLink, { color: theme.colors.primary }]}>面对面配对</Text>
          </Pressable>
        }
      />

      <View style={styles.searchBox}>
        <TextField
          value={query}
          onChangeText={setQuery}
          placeholder="输入用户名，如 alice"
          autoCapitalize="none"
          autoCorrect={false}
          error={error}
        />
      </View>

      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={results.length ? undefined : styles.emptyContent}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => startChat(item)}
            disabled={openingId === item.id}
            style={({ pressed, hovered }: any) => [
              styles.row,
              {
                backgroundColor: pressed || hovered ? theme.colors.ripple : 'transparent',
                opacity: openingId === item.id ? 0.6 : 1,
              },
            ]}
          >
            <Avatar
              name={item.displayName}
              color={item.avatarColor}
              size={42}
              online={onlineUserIds.has(item.id)}
            />
            <View style={styles.rowText}>
              <Text style={[styles.name, { color: theme.colors.text }]} numberOfLines={1}>
                {item.displayName}
              </Text>
              <Text style={[styles.username, { color: theme.colors.textFaint }]} numberOfLines={1}>
                @{item.username}
              </Text>
            </View>
            {openingId === item.id ? (
              <ActivityIndicator size="small" color={theme.colors.primary} />
            ) : (
              <View style={[styles.chatChip, { borderColor: theme.colors.border }]}>
                <Text style={[styles.chatChipText, { color: theme.colors.primary }]}>聊天</Text>
              </View>
            )}
          </Pressable>
        )}
        ListEmptyComponent={
          searching ? (
            <ActivityIndicator style={styles.loading} color={theme.colors.textFaint} />
          ) : query.trim() ? (
            <EmptyState icon="🔍" title="没找到这个人" description="确认一下用户名有没有打错。" />
          ) : (
            <EmptyState
              icon="👥"
              title="搜索用户开始聊天"
              description="输入对方注册时用的用户名，或者昵称的一部分。"
            />
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  searchBox: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  emptyContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md - 2,
    marginHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  rowText: {
    flex: 1,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
  },
  username: {
    fontSize: 13,
    marginTop: 2,
  },
  chatChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chatChipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  loading: {
    paddingVertical: spacing.xl,
  },
  pairLink: {
    fontSize: 14,
    fontWeight: '600',
  },
});
