// スキかた - ロボット掃除機利用状況の設定画面
// 「使っている／購入を検討している／未設定に戻す」の3択のみ。いつでも変更可能。
// オンボーディングには一切追加しない（要求定義4-1）。

import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import {
  loadRobotVacuumPreferences,
  saveRobotVacuumPreferences,
  updateRobotVacuumStatus,
} from './storage';
import { RobotVacuumPreferences, RobotVacuumStatus } from './types';
import { trackRobotStatusSet } from './analytics';

const COLORS = {
  text: '#3E3A34',
  accent: '#8FA888',
  divider: '#E4DECE',
};

const OPTIONS: { status: RobotVacuumStatus; label: string }[] = [
  { status: 'owner', label: '使っている' },
  { status: 'considering', label: '購入を検討している' },
  { status: 'unset', label: '未設定に戻す' },
];

export function RobotVacuumSettingsScreen() {
  const [prefs, setPrefs] = useState<RobotVacuumPreferences | null>(null);

  useEffect(() => {
    loadRobotVacuumPreferences().then(setPrefs);
  }, []);

  if (!prefs) return null;

  const handleSelect = async (status: RobotVacuumStatus) => {
    // 「未設定に戻す」を選んでもバナー側の再表示制御用状態には触れない
    // （updateRobotVacuumStatusがrobotVacuumStatus/robotVacuumStatusUpdatedAtのみ更新する）
    const next = updateRobotVacuumStatus(prefs, status);
    setPrefs(next);
    await saveRobotVacuumPreferences(next);
    trackRobotStatusSet(status);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.sectionLabel}>ロボット掃除機</Text>
      <Text style={styles.description}>
        ロボット掃除機を使っていますか？{'\n'}
        使っている場合は、床のタスクを少し合わせられます。
      </Text>

      {OPTIONS.map((option, index) => (
        <React.Fragment key={option.status}>
          {index > 0 && <View style={styles.divider} />}
          <Pressable style={styles.row} onPress={() => handleSelect(option.status)}>
            <Text style={styles.rowLabel}>{option.label}</Text>
            {prefs.robotVacuumStatus === option.status && (
              <Text style={styles.checkMark}>✓</Text>
            )}
          </Pressable>
        </React.Fragment>
      ))}

      <Text style={styles.footnote}>
        回答しなくても、これまでどおりすべての機能を使えます。
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: 24,
  },
  sectionLabel: {
    fontSize: 13,
    color: COLORS.text,
    opacity: 0.6,
    marginBottom: 8,
  },
  description: {
    fontSize: 13,
    lineHeight: 19,
    color: COLORS.text,
    opacity: 0.7,
    marginBottom: 12,
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
  checkMark: {
    fontSize: 16,
    color: COLORS.accent,
    fontWeight: '600',
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.divider,
  },
  footnote: {
    marginTop: 16,
    fontSize: 12,
    lineHeight: 18,
    color: COLORS.text,
    opacity: 0.5,
  },
});
