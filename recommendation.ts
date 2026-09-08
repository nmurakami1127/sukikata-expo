// スキかた - 「今日のおすすめ」推薦ロジック（時間帯 + 直近履歴の除外のみ / MVP）

import AsyncStorage from '@react-native-async-storage/async-storage';

const LAST_PLACE_KEY = 'sukikata:lastPlace';

/** 優先順リスト（全候補・固定順） */
export const RECOMMEND_ORDER: string[] = [
  'desk', // 0: 机
  'floor', // 1: 床
  'living', // 2: リビング
  'kitchen', // 3: キッチン
  'shelf', // 4: 棚・収納
  'entrance', // 5: 玄関
  'closet', // 6: クローゼット・衣類
  'digital', // 7: デジタル・カバン類
];

export interface LastPlace {
  placeId: string;
  selectedAt: string;
}

export async function loadLastPlace(): Promise<LastPlace | null> {
  const raw = await AsyncStorage.getItem(LAST_PLACE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function saveLastPlace(placeId: string): Promise<void> {
  const record: LastPlace = { placeId, selectedAt: new Date().toISOString() };
  await AsyncStorage.setItem(LAST_PLACE_KEY, JSON.stringify(record));
}

/**
 * 現在時刻から時間帯デフォルト候補のインデックスを返す。
 * 22:00–4:59 は「22:00以降 OR 4:59以前」の OR 条件（日付またぎ）。
 */
export function timeSlotIndex(date: Date = new Date()): number {
  const h = date.getHours();
  if (h >= 5 && h < 11) return 3; // キッチン
  if (h >= 11 && h < 17) return 0; // 机
  if (h >= 17 && h < 22) return 2; // リビング
  return 1; // 床（22:00–4:59）
}

/**
 * 初回表示用の推薦インデックスを計算する。
 * 履歴なし → 机(0)固定。時間帯候補が直近選択場所と一致する場合は次の候補にずらす。
 */
export function computeInitialRecommendation(
  lastPlaceId: string | null,
  now: Date = new Date()
): number {
  if (!lastPlaceId) return 0;
  const slot = timeSlotIndex(now);
  if (RECOMMEND_ORDER[slot] === lastPlaceId) return slot + 1;
  return slot;
}

/**
 * 「べつの場所にする」タップ時の次のインデックスを計算する。
 * 直近選択場所と一致する候補はスキップする。リスト終端(7)を超えたら null（案内文表示へ）。
 */
export function nextRecommendationIndex(
  currentIndex: number,
  lastPlaceId: string | null
): number | null {
  let idx = currentIndex + 1;
  if (idx > 7) return null;
  if (lastPlaceId && RECOMMEND_ORDER[idx] === lastPlaceId) {
    idx += 1;
    if (idx > 7) return null;
  }
  return idx;
}
