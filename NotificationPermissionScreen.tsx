// スキかた - 通知許可のリクエスト画面
// OS標準の許可ダイアログを呼ぶ前に、優しいトーンの説明画面を挟む。

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { PERMISSION_REQUEST_COPY } from './messages';
import { requestOsNotificationPermission } from './storage';

const COLORS = {
  background: '#F5F1E6', // 生成りベージュ
  accent: '#8FA888', // セージグリーン
  text: '#3E3A34', // 墨インク
};

interface Props {
  /** ユーザーが「通知を受け取る」を選び、OSダイアログの結果が出た後に呼ばれる */
  onDone: (granted: boolean) => void;
  /** ユーザーが「今はしない」を選んだときに呼ばれる */
  onSkip: () => void;
}

export function NotificationPermissionScreen({ onDone, onSkip }: Props) {
  const handleRequest = async () => {
    const granted = await requestOsNotificationPermission();
    onDone(granted);
  };

  return (
    <View style={styles.container}>
      <View style={styles.motif} />
      <Text style={styles.title}>{PERMISSION_REQUEST_COPY.title}</Text>
      <Text style={styles.body}>{PERMISSION_REQUEST_COPY.body}</Text>

      <Pressable style={styles.primaryButton} onPress={handleRequest}>
        <Text style={styles.primaryButtonText}>
          {PERMISSION_REQUEST_COPY.primaryButtonLabel}
        </Text>
      </Pressable>

      <Pressable style={styles.secondaryButton} onPress={onSkip}>
        <Text style={styles.secondaryButtonText}>
          {PERMISSION_REQUEST_COPY.secondaryButtonLabel}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  motif: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: COLORS.accent,
    marginBottom: 24,
    opacity: 0.85,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 16,
  },
  body: {
    fontSize: 15,
    lineHeight: 26,
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 40,
  },
  primaryButton: {
    backgroundColor: COLORS.accent,
    borderRadius: 999,
    paddingVertical: 14,
    paddingHorizontal: 32,
    marginBottom: 12,
    width: '100%',
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    paddingVertical: 10,
  },
  secondaryButtonText: {
    color: COLORS.text,
    fontSize: 14,
    opacity: 0.6,
  },
});
