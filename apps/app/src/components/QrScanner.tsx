import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { PAIRING_URI_SCHEME } from '@chat/shared';
import { radius, spacing, useTheme } from '../theme';
import { Button } from './Button';

interface Props {
  onScanned: (value: string) => void;
  onError: (message: string) => void;
}

/**
 * 扫码取对方的配对码。
 * 桌面端没有摄像头，这个组件只在手机端渲染（pair.tsx 里已按平台判断）。
 */
export function QrScanner({ onScanned, onError }: Props) {
  const theme = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [ready, setReady] = useState(false);
  // 连续扫到同一个码时只处理一次
  const handled = useRef(false);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [permission, requestPermission]);

  if (!permission) {
    return <ActivityIndicator style={styles.loading} color={theme.colors.primary} />;
  }

  if (!permission.granted) {
    return (
      <View style={[styles.notice, { borderColor: theme.colors.border }]}>
        <Text style={[styles.noticeText, { color: theme.colors.textMuted }]}>
          需要相机权限才能扫码。也可以让对方复制配对码发给你，粘贴到下面的输入框。
        </Text>
        {permission.canAskAgain && (
          <Button title="授予相机权限" variant="secondary" onPress={() => void requestPermission()} />
        )}
      </View>
    );
  }

  return (
    <View style={[styles.frame, { borderColor: theme.colors.border }]}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onCameraReady={() => setReady(true)}
        onMountError={() => onError('相机启动失败')}
        onBarcodeScanned={({ data }) => {
          if (handled.current) return;
          if (typeof data !== 'string' || !data) return;
          // 只认我们自己的配对码，扫到别的二维码直接忽略
          if (!data.startsWith(PAIRING_URI_SCHEME)) return;
          handled.current = true;
          onScanned(data);
        }}
      />
      {!ready && <ActivityIndicator style={styles.loading} color="#fff" />}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    height: 260,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    marginBottom: spacing.lg,
    backgroundColor: '#000',
  },
  loading: { paddingVertical: spacing.xl },
  notice: {
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing.lg,
    gap: spacing.md,
  },
  noticeText: { fontSize: 13, lineHeight: 19 },
});
