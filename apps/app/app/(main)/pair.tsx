import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import {
  decodePairingPayload,
  encodePairingPayload,
  fingerprintOf,
  formatHostPort,
  type PairingPayload,
  type PeerAddress,
} from '@chat/shared';
import { Button } from '../../src/components/Button';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { TextField } from '../../src/components/TextField';
import { QrScanner } from '../../src/components/QrScanner';
import { useAuth } from '../../src/state/AuthContext';
import { useChat } from '../../src/state/ChatContext';
import { useUi } from '../../src/state/UiContext';
import { radius, spacing, useTheme } from '../../src/theme';

/**
 * 面对面配对。
 *
 * 不依赖服务器发现对方：一方出示二维码，另一方扫一下，
 * 就拿到了对端的设备公钥和可尝试的地址，之后直接连过去。
 */
export default function PairScreen() {
  const theme = useTheme();
  const { user } = useAuth();
  const {
    p2pAvailable,
    p2pUnavailableReason,
    deviceIdPub,
    localPeerAddresses,
    pairWithPayload,
    conversations,
  } = useChat();
  const { selectConversation } = useUi();

  const [addresses, setAddresses] = useState<PeerAddress[]>([]);
  const [mine, setMine] = useState<string>('');
  const [input, setInput] = useState('');
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const addrs = await localPeerAddresses();
      if (cancelled || !user || !deviceIdPub) return;
      setAddresses(addrs);
      setMine(
        encodePairingPayload({
          v: 1,
          userId: user.id,
          username: user.username,
          displayName: user.displayName,
          avatarColor: user.avatarColor,
          idPub: deviceIdPub,
          addrs,
          ts: Date.now(),
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [user, deviceIdPub, localPeerAddresses]);

  const applyPayload = useCallback(
    async (payload: PairingPayload) => {
      setBusy(true);
      setError(null);
      try {
        await pairWithPayload(payload);
        setDone(`已和 ${payload.displayName} 配对，正在尝试直连…`);
        setInput('');
        // 配对后会话应该已经建好，跳过去
        const conv = conversations.find((c) =>
          c.members.some((m) => m.id === payload.userId),
        );
        if (conv) selectConversation(conv.id);
      } catch (err: any) {
        setError(err?.message ?? '配对失败');
      } finally {
        setBusy(false);
      }
    },
    [conversations, pairWithPayload, selectConversation],
  );

  const submitText = useCallback(async () => {
    try {
      await applyPayload(decodePairingPayload(input));
    } catch (err: any) {
      setError(err?.message ?? '配对码无法解析');
    }
  }, [applyPayload, input]);

  if (!p2pAvailable) {
    return (
      <View style={[styles.root, { backgroundColor: theme.colors.surface }]}>
        <ScreenHeader title="面对面配对" />
        <View style={styles.notice}>
          <Text style={[styles.noticeText, { color: theme.colors.textMuted }]}>
            {p2pUnavailableReason || '当前环境不支持直连。'}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.surface }]}>
      <ScreenHeader title="面对面配对" subtitle="不经过服务器，直接连对方设备" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.sectionTitle, { color: theme.colors.textFaint }]}>我的配对码</Text>

        {mine ? (
          <View style={[styles.qrCard, { backgroundColor: '#ffffff' }]}>
            <QRCode value={mine} size={196} backgroundColor="#ffffff" color="#000000" />
          </View>
        ) : (
          <ActivityIndicator style={styles.loading} color={theme.colors.primary} />
        )}

        {!!deviceIdPub && (
          <View style={[styles.fingerprintBox, { borderColor: theme.colors.border }]}>
            <Text style={[styles.fingerprintLabel, { color: theme.colors.textFaint }]}>
              本机设备指纹（请当面核对）
            </Text>
            <Text style={[styles.fingerprint, { color: theme.colors.text }]}>
              {fingerprintOf(deviceIdPub)}
            </Text>
          </View>
        )}

        {addresses.length ? (
          <View style={styles.addrList}>
            {addresses.map((a) => (
              <Text key={`${a.host}:${a.port}`} style={[styles.addr, { color: theme.colors.textMuted }]}>
                {a.kind === 'ipv6' ? '公网 IPv6' : '局域网'} · {formatHostPort(a.host, a.port)}
              </Text>
            ))}
          </View>
        ) : (
          <Text style={[styles.addr, { color: theme.colors.danger }]}>
            没拿到可对外公布的地址。局域网内仍可自动发现，跨网络需要公网 IPv6。
          </Text>
        )}

        <Button
          title={copied ? '已复制' : '复制配对码'}
          variant="secondary"
          onPress={async () => {
            await Clipboard.setStringAsync(mine);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          disabled={!mine}
          style={styles.copyButton}
        />

        <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />

        <Text style={[styles.sectionTitle, { color: theme.colors.textFaint }]}>添加对方</Text>

        {Platform.OS !== 'web' && (
          <Button
            title={scanning ? '关闭扫码' : '扫描对方二维码'}
            onPress={() => setScanning((v) => !v)}
            style={styles.scanButton}
          />
        )}

        {scanning && (
          <QrScanner
            onScanned={(value) => {
              setScanning(false);
              try {
                void applyPayload(decodePairingPayload(value));
              } catch (err: any) {
                setError(err?.message ?? '二维码无法识别');
              }
            }}
            onError={(message) => {
              setScanning(false);
              setError(message);
            }}
          />
        )}

        <TextField
          label="或粘贴对方的配对码"
          value={input}
          onChangeText={setInput}
          placeholder="chatapp://pair?..."
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          style={styles.input}
          error={error}
        />
        <Pressable
          accessibilityRole="button"
          onPress={async () => setInput(await Clipboard.getStringAsync())}
        >
          <Text style={[styles.pasteLink, { color: theme.colors.primary }]}>从剪贴板粘贴</Text>
        </Pressable>

        <Button title="配对并连接" onPress={submitText} loading={busy} disabled={!input.trim()} />

        {!!done && <Text style={[styles.done, { color: theme.colors.success }]}>{done}</Text>}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: spacing.md,
  },
  qrCard: {
    alignSelf: 'center',
    padding: spacing.lg,
    borderRadius: radius.lg,
  },
  loading: { paddingVertical: spacing.xl },
  fingerprintBox: {
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  fingerprintLabel: { fontSize: 11 },
  fingerprint: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginTop: 4,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  },
  addrList: { marginTop: spacing.md, gap: 3 },
  addr: { fontSize: 12, lineHeight: 18 },
  copyButton: { marginTop: spacing.lg },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: spacing.xl },
  scanButton: { marginBottom: spacing.lg },
  input: { minHeight: 88, textAlignVertical: 'top', paddingTop: spacing.md },
  pasteLink: { fontSize: 13, fontWeight: '500', marginBottom: spacing.lg },
  done: { fontSize: 13, marginTop: spacing.md },
  notice: { padding: spacing.lg },
  noticeText: { fontSize: 14, lineHeight: 21 },
});
