import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { initialsOf } from '@chat/shared';
import { useTheme } from '../theme';

interface Props {
  name: string;
  color: string;
  size?: number;
  /** 右下角在线状态小圆点；不传则不显示 */
  online?: boolean;
}

export function Avatar({ name, color, size = 46, online }: Props) {
  const theme = useTheme();
  const dotSize = Math.max(10, Math.round(size * 0.26));

  return (
    <View style={{ width: size, height: size }}>
      <View
        style={[
          styles.circle,
          { width: size, height: size, borderRadius: size / 2, backgroundColor: color },
        ]}
      >
        <Text style={[styles.initials, { fontSize: size * 0.42 }]} numberOfLines={1}>
          {initialsOf(name)}
        </Text>
      </View>
      {online !== undefined && (
        <View
          style={[
            styles.dot,
            {
              width: dotSize,
              height: dotSize,
              borderRadius: dotSize / 2,
              backgroundColor: online ? theme.colors.success : theme.colors.textFaint,
              borderColor: theme.colors.surface,
            },
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    color: '#fff',
    fontWeight: '600',
  },
  dot: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    borderWidth: 2,
  },
});
