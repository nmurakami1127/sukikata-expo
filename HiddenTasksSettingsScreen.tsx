// スキかた - 「出さない設定にしたタスク」一覧（実装指示書2-5・2-6）
// 「今後出さない」を選んだタスクをいつでも個別に解除できる。
// 出さない設定を候補不足を理由にアプリ側から自動解除することはない。

import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { loadRobotVacuumPreferences, saveRobotVacuumPreferences, unhideTask } from './storage';
import { RobotVacuumPreferences } from './types';
import { findTaskById } from './taskData';

const COLORS = {
  text: '#3E3A34',
  accent: '#8FA888',
  divider: '#E4DECE',
};

export function HiddenTasksSettingsScreen() {
  const [prefs, setPrefs] = useState<RobotVacuumPreferences | null>(null);

  useEffect(() => {
    loadRobotVacuumPreferences().then(setPrefs);
  }, []);

  // 「出さない設定」が1件も無い間は、通常利用者にとって空のセクションになるため表示しない
  if (!prefs || prefs.hiddenTaskIds.length === 0) return null;

  const handleUnhide = async (taskId: string) => {
    const next = unhideTask(prefs, taskId);
    setPrefs(next);
    await saveRobotVacuumPreferences(next);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.sectionLabel}>出さない設定にしたタスク</Text>

      {prefs.hiddenTaskIds.map((taskId, index) => {
        const task = findTaskById(taskId);
        return (
          <React.Fragment key={taskId}>
            {index > 0 && <View style={styles.divider} />}
            <View style={styles.row}>
              <Text style={styles.rowLabel} numberOfLines={1}>
                {task ? task.title : taskId}
              </Text>
              <Pressable onPress={() => handleUnhide(taskId)} hitSlop={8}>
                <Text style={styles.unhideText}>解除</Text>
              </Pressable>
            </View>
          </React.Fragment>
        );
      })}
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
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 12,
  },
  rowLabel: {
    flex: 1,
    fontSize: 15,
    color: COLORS.text,
  },
  unhideText: {
    fontSize: 14,
    color: COLORS.accent,
    fontWeight: '600',
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.divider,
  },
});
