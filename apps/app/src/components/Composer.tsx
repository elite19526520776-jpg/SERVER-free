import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View, Text } from 'react-native';
import { LIMITS } from '@chat/shared';
import { radius, spacing, useTheme } from '../theme';

interface Props {
  onSend: (body: string) => void;
  onTypingChange: (on: boolean) => void;
  disabled?: boolean;
}

const TYPING_IDLE_MS = 2500;

export function Composer({ onSend, onTypingChange, disabled }: Props) {
  const theme = useTheme();
  const [text, setText] = useState('');
  const [height, setHeight] = useState(0);
  const inputRef = useRef<TextInput>(null);
  const typingRef = useRef(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopTyping = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = null;
    if (typingRef.current) {
      typingRef.current = false;
      onTypingChange(false);
    }
  }, [onTypingChange]);

  const handleChange = useCallback(
    (value: string) => {
      setText(value);
      if (!value.trim()) {
        stopTyping();
        return;
      }
      if (!typingRef.current) {
        typingRef.current = true;
        onTypingChange(true);
      }
      if (idleTimer.current) clearTimeout(idleTimer.current);
      // 停手 2.5 秒就撤掉「正在输入」，不然对方会一直看到
      idleTimer.current = setTimeout(stopTyping, TYPING_IDLE_MS);
    },
    [onTypingChange, stopTyping],
  );

  const submit = useCallback(() => {
    const body = text.trim();
    if (!body || disabled) return;
    onSend(body);
    setText('');
    setHeight(0);
    stopTyping();
    // 桌面端连续发消息时保持焦点，手机端保留键盘
    inputRef.current?.focus();
  }, [disabled, onSend, stopTyping, text]);

  useEffect(() => stopTyping, [stopTyping]);

  const canSend = text.trim().length > 0 && !disabled;
  const inputHeight = Math.min(Math.max(height, 24), 120);

  return (
    <View
      style={[
        styles.wrapper,
        { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border },
      ]}
    >
      <View style={[styles.inputBox, { backgroundColor: theme.colors.elevated }]}>
        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={handleChange}
          multiline
          maxLength={LIMITS.messageMax}
          placeholder={disabled ? '连接断开，消息会在恢复后自动发送' : '说点什么…'}
          placeholderTextColor={theme.colors.textFaint}
          onContentSizeChange={(e) => setHeight(e.nativeEvent.contentSize.height)}
          // 桌面端：Enter 发送，Shift+Enter 换行；手机端保持系统换行行为
          onKeyPress={(e: any) => {
            if (Platform.OS !== 'web') return;
            if (e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) {
              e.preventDefault?.();
              submit();
            }
          }}
          style={[
            styles.input,
            { color: theme.colors.text, height: inputHeight },
            { outlineStyle: 'none' } as any,
          ]}
        />
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="发送"
        onPress={submit}
        disabled={!canSend}
        style={({ pressed }) => [
          styles.sendButton,
          {
            backgroundColor: canSend ? theme.colors.primary : theme.colors.elevated,
            opacity: pressed && canSend ? 0.85 : 1,
          },
        ]}
      >
        <Text
          style={[
            styles.sendLabel,
            { color: canSend ? theme.colors.primaryText : theme.colors.textFaint },
          ]}
        >
          发送
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: spacing.sm + 2,
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  inputBox: {
    flex: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    justifyContent: 'center',
  },
  input: {
    fontSize: 15.5,
    lineHeight: 21,
    textAlignVertical: 'center',
  },
  sendButton: {
    height: 42,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
});
