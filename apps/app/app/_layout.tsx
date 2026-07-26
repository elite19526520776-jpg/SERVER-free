import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../src/state/AuthContext';
import { ChatProvider } from '../src/state/ChatContext';
import { UiProvider } from '../src/state/UiContext';
import { useTheme } from '../src/theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <ChatProvider>
          <UiProvider>
            <RootNavigator />
          </UiProvider>
        </ChatProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

function RootNavigator() {
  const theme = useTheme();
  const { status } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  // 登录态与路由分组的守卫：未登录只能待在 (auth) 里，已登录不能回到 (auth)
  useEffect(() => {
    if (status === 'loading') return;
    const inAuthGroup = segments[0] === '(auth)';

    if (status === 'signedOut' && !inAuthGroup) {
      router.replace('/login');
    } else if (status === 'signedIn' && inAuthGroup) {
      router.replace('/chats');
    }
  }, [status, segments, router]);

  if (status === 'loading') {
    return (
      <View style={[styles.splash, { backgroundColor: theme.colors.bg }]}>
        <StatusBar style={theme.dark ? 'light' : 'dark'} />
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <>
      <StatusBar style={theme.dark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.bg },
          animation: 'slide_from_right',
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
