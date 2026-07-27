import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import type { TextInputProps } from 'react-native';
import { radius, spacing, useTheme } from '../theme';

interface Props extends TextInputProps {
  label?: string;
  hint?: string;
  error?: string | null;
}

export function TextField({ label, hint, error, style, ...rest }: Props) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);

  const borderColor = error
    ? theme.colors.danger
    : focused
      ? theme.colors.primary
      : theme.colors.border;

  return (
    <View style={styles.wrapper}>
      {!!label && <Text style={[styles.label, { color: theme.colors.textMuted }]}>{label}</Text>}
      <TextInput
        {...rest}
        onFocus={(e) => {
          setFocused(true);
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          rest.onBlur?.(e);
        }}
        placeholderTextColor={theme.colors.textFaint}
        style={[
          styles.input,
          {
            backgroundColor: theme.colors.elevated,
            borderColor,
            color: theme.colors.text,
          },
          // Web 上默认的聚焦描边和自绘边框会重叠，去掉
          { outlineStyle: 'none' } as any,
          style,
        ]}
      />
      {!!error && <Text style={[styles.helper, { color: theme.colors.danger }]}>{error}</Text>}
      {!error && !!hint && (
        <Text style={[styles.helper, { color: theme.colors.textFaint }]}>{hint}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: spacing.md,
  },
  label: {
    fontSize: 13,
    marginBottom: spacing.xs + 2,
    fontWeight: '500',
  },
  input: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    fontSize: 16,
  },
  helper: {
    fontSize: 12,
    marginTop: spacing.xs + 1,
  },
});
