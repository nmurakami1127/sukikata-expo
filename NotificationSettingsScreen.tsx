// スキかた - 通知設定画面
// 日次リマインドのオン/オフと時刻変更のみを扱う（仕様書 2-5 準拠、最大1件/日）。

import React, { useEffect, useState, useRef } from 'react';
import { View, Text, Switch, Pressable, StyleSheet, Platform, Alert, Linking, AppState } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import {
  loadNotificationSettings,
  saveNotificationSettings,
  cancelAllNotifications,
  requestOsNotificationPermission,
  getOsNotificationPermissionStatus,
} from './storage';
import { NotificationSettings } from './types';
import { runDailyNotificationJob } from './dailyJob';

const COLORS = {
  background: '#F5F1E6',
  accent: '#8FA888',
  text: '#3E3A34',
  divider: '#E4DECE',
};

function timeStringToDate(time: string): Date {
  const [h, m] = time.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

function dateToTimeString(date: Date): string {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), ms)
  );
}

/**
 * OS通知権限を確認し、未許可なら許可を取りに行く共通処理。
 * 日次リマインド・タイマー終了通知、どちらのトグルをONにする場合も同じ確認が必要なため共通化している。
 * 権限が得られなかった場合は onDenied を呼んで呼び出し側にアラート表示を委ねる。
 */
async function ensureNotificationPermission(onDenied: () => void): Promise<boolean> {
  try {
    const currentStatus = await Promise.race([
      getOsNotificationPermissionStatus(),
      timeout(4000),
    ]);

    if (currentStatus === 'denied') {
      // Androidは一度拒否されると再リクエストしてもダイアログを出さないため、
      // ここで無駄なリクエストをせず、直接設定アプリへ誘導する
      onDenied();
      return false;
    }

    let granted = currentStatus === 'granted';
    if (!granted) {
      granted = await Promise.race([requestOsNotificationPermission(), timeout(4000)]);
    }

    if (!granted) {
      onDenied();
      return false;
    }
    return true;
  } catch (error) {
    const isTimeout = error instanceof Error && error.message === 'timeout';
    Alert.alert(
      '通知を有効にできませんでした',
      isTimeout
        ? '通知の確認に時間がかかっています。少し時間をおいて、もう一度お試しください。'
        : 'もう一度お試しいただくか、端末の設定から通知の許可状況をご確認ください。'
    );
    return false;
  }
}

export function NotificationSettingsScreen() {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  // state ではなく ref で二重発火を防ぐ。
  // state の更新は非同期で反映が遅れるため、Android の Switch コンポーネントが
  // 値のズレを検知して onValueChange を連続発火させるケースを止めきれないことがある。
  const busyRef = useRef(false);
  const timerBusyRef = useRef(false);

  useEffect(() => {
    loadNotificationSettings().then(setSettings);
  }, []);

  // 端末の設定アプリから戻ってきたときに、許可状況を自動で確認する。
  // 「許可された & ユーザーはONにしたがっていた」場合は自動でスイッチをONに同期する。
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    const sub = AppState.addEventListener('change', async (nextState) => {
      if (nextState !== 'active') return;
      const current = settingsRef.current;
      if (!current) return;

      try {
        const status = await Promise.race([
          getOsNotificationPermissionStatus(),
          timeout(4000),
        ]);
        if (status === 'granted' && !current.notificationsEnabled) {
          // 端末側で許可された直後に戻ってきた場合、ONにしたかった操作を完了させる
          const next = { ...current, notificationsEnabled: true };
          setSettings(next);
          await saveNotificationSettings(next);
          await runDailyNotificationJob(true);
        }
      } catch {
        // 復帰時の自動チェック失敗は静かに無視してよい（次回タップ時に改めて案内する）
      }
    });
    return () => sub.remove();
  }, []);

  if (!settings) return null;

  const updateSettings = async (next: NotificationSettings) => {
    setSettings(next);
    await saveNotificationSettings(next);
    if (next.notificationsEnabled) {
      await runDailyNotificationJob(true);
    } else {
      await cancelAllNotifications();
    }
  };

  // ポップアップを閉じた瞬間にロック解除する（表示直後に解除すると、
  // Android の Switch が値のズレで onValueChange を再発火させたときに
  // ロックが素通りしてポップアップが連続表示される不具合を防ぐため）
  const showPermissionAlert = (busy: React.MutableRefObject<boolean>) => {
    Alert.alert(
      '通知が許可されていません',
      '端末の設定から、スキかたの通知を許可してください。',
      [
        { text: '閉じる', style: 'cancel', onPress: () => { busy.current = false; } },
        {
          text: '設定を開く',
          onPress: () => {
            busy.current = false;
            Linking.openSettings();
          },
        },
      ],
      { onDismiss: () => { busy.current = false; } }
    );
  };

  const handleToggle = async (value: boolean) => {
    if (!value) {
      // オフにする場合は許可周りのチェック不要
      updateSettings({ ...settings, notificationsEnabled: value });
      return;
    }

    if (busyRef.current) return; // 二重タップ・多重発火防止
    busyRef.current = true;

    const granted = await ensureNotificationPermission(() => showPermissionAlert(busyRef));
    if (!granted) return;

    await updateSettings({ ...settings, notificationsEnabled: value });
    busyRef.current = false;
  };

  const handleTimerToggle = async (value: boolean) => {
    if (!value) {
      updateSettings({ ...settings, timerCompletionEnabled: value });
      return;
    }

    if (timerBusyRef.current) return;
    timerBusyRef.current = true;

    const granted = await ensureNotificationPermission(() => showPermissionAlert(timerBusyRef));
    if (!granted) return;

    await updateSettings({ ...settings, timerCompletionEnabled: value });
    timerBusyRef.current = false;
  };

  const handleTimeChange = (event: unknown, selectedDate?: Date) => {
    setShowPicker(Platform.OS === 'ios');
    if (selectedDate) {
      updateSettings({ ...settings, reminderTime: dateToTimeString(selectedDate) });
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.sectionLabel}>通知</Text>

      <View style={styles.row}>
        <Text style={styles.rowLabel}>通知を受け取る</Text>
        <Switch
          value={settings.notificationsEnabled}
          onValueChange={handleToggle}
          trackColor={{ true: COLORS.accent, false: '#ccc' }}
        />
      </View>

      <View style={styles.divider} />

      <Pressable
        style={styles.row}
        onPress={() => setShowPicker(true)}
        disabled={!settings.notificationsEnabled}
      >
        <Text
          style={[
            styles.rowLabel,
            !settings.notificationsEnabled && styles.rowLabelDisabled,
          ]}
        >
          通知時刻
        </Text>
        <Text
          style={[
            styles.timeValue,
            !settings.notificationsEnabled && styles.rowLabelDisabled,
          ]}
        >
          {settings.reminderTime}
        </Text>
      </Pressable>

      {showPicker && (
        <DateTimePicker
          value={timeStringToDate(settings.reminderTime)}
          mode="time"
          is24Hour
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={handleTimeChange}
        />
      )}

      <Text style={styles.footnote}>
        通知は1日最大1件です。やらなくて大丈夫な、そっとしたお知らせだけをお届けします。
      </Text>

      <Text style={[styles.sectionLabel, styles.timerSectionLabel]}>タイマー終了通知</Text>

      <View style={styles.row}>
        <Text style={styles.rowLabel}>タイマー終了を通知する</Text>
        <Switch
          value={settings.timerCompletionEnabled}
          onValueChange={handleTimerToggle}
          trackColor={{ true: COLORS.accent, false: '#ccc' }}
        />
      </View>

      <Text style={styles.footnote}>
        5分タイマーが終わるたびに届きます。日次リマインドとは別の通知で、1日1件ルールの対象外です。
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: 4,
  },
  sectionLabel: {
    fontSize: 13,
    color: COLORS.text,
    opacity: 0.6,
    marginBottom: 8,
  },
  timerSectionLabel: {
    marginTop: 24,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
  },
  rowLabel: {
    fontSize: 16,
    color: COLORS.text,
  },
  rowLabelDisabled: {
    opacity: 0.4,
  },
  timeValue: {
    fontSize: 16,
    color: COLORS.accent,
    fontWeight: '600',
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.divider,
  },
  footnote: {
    marginTop: 24,
    fontSize: 12,
    lineHeight: 18,
    color: COLORS.text,
    opacity: 0.5,
  },
});
