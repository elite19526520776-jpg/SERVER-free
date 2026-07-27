import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ApiClient } from '@chat/shared';
import { normalizeServerUrl } from '../config';
import { spacing, useTheme } from '../theme';
import { useAuth } from '../state/AuthContext';
import { Button } from './Button';
import { TextField } from './TextField';

type Probe = { state: 'idle' | 'checking' | 'ok' | 'fail'; detail?: string };

/**
 * 服务器地址设置。手机装在真机上时必须指向电脑的局域网 IP，
 * 所以这里带一个「测试连接」，省得用户对着白屏猜问题出在哪。
 */
export function ServerUrlField() {
  const theme = useTheme();
  const { serverUrl, changeServerUrl } = useAuth();
  const [value, setValue] = useState(serverUrl);
  const [probe, setProbe] = useState<Probe>({ state: 'idle' });

  useEffect(() => setValue(serverUrl), [serverUrl]);

  async function save() {
    const normalized = normalizeServerUrl(value);
    setValue(normalized);
    setProbe({ state: 'checking' });
    try {
      const probeClient = new ApiClient({ baseUrl: normalized });
      const res = await probeClient.health();
      await changeServerUrl(normalized);
      setProbe({ state: 'ok', detail: `已连接（服务端 v${res.version}）` });
    } catch (err: any) {
      // 连不通也保存，方便用户先填好地址再去开服务
      await changeServerUrl(normalized);
      setProbe({ state: 'fail', detail: err?.message ?? '连接失败' });
    }
  }

  const statusColor =
    probe.state === 'ok'
      ? theme.colors.success
      : probe.state === 'fail'
        ? theme.colors.danger
        : theme.colors.textFaint;

  return (
    <View style={styles.wrapper}>
      <TextField
        label="服务器地址"
        value={value}
        onChangeText={setValue}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        placeholder="http://192.168.1.10:4000"
        hint="手机连电脑上的服务时，填电脑的局域网 IP，不要用 localhost。"
      />
      <Button
        title={probe.state === 'checking' ? '测试中…' : '保存并测试连接'}
        variant="secondary"
        onPress={save}
        loading={probe.state === 'checking'}
      />
      {!!probe.detail && (
        <Text style={[styles.status, { color: statusColor }]}>{probe.detail}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginTop: spacing.lg,
  },
  status: {
    fontSize: 13,
    marginTop: spacing.sm,
  },
});
