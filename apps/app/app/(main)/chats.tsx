import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '../../src/components/Button';
import { ConversationList } from '../../src/components/ConversationList';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { useChat } from '../../src/state/ChatContext';
import { useUi } from '../../src/state/UiContext';
import { useTheme } from '../../src/theme';

export default function ChatsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { conversations, connection } = useChat();
  const { selectedConversationId, selectConversation } = useUi();

  const subtitle =
    connection === 'online'
      ? `${conversations.length} 个会话`
      : connection === 'connecting'
        ? '连接中…'
        : '离线，显示的是本地缓存';

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.surface }]}>
      <ScreenHeader title="消息" subtitle={subtitle} />
      <ConversationList
        activeId={selectedConversationId}
        onSelect={(conv) => selectConversation(conv.id)}
        emptyAction={
          <Button title="去找人聊天" onPress={() => router.replace('/contacts')} />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
