// スキかた - 「使い方」ページの初回バッジ表示状態の永続化

import AsyncStorage from '@react-native-async-storage/async-storage';

const HELP_BADGE_SEEN_KEY = 'sukikata:helpBadgeSeen';

/** ホーム画面の「?」アイコンのバッジを、既に見た（タップ済み）かどうか */
export async function loadHelpBadgeSeen(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(HELP_BADGE_SEEN_KEY);
  return raw === 'true';
}

export async function markHelpBadgeSeen(): Promise<void> {
  await AsyncStorage.setItem(HELP_BADGE_SEEN_KEY, 'true');
}
