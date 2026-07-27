// スキかた - 通知文言（仕様書 6-4 準拠）
// 文言は企画確定事項のため、変更する場合は仕様書側も更新すること。

export const PERMISSION_REQUEST_COPY = {
  title: '通知について',
  body:
    '毎日同じ時間に、そっと声をかけるだけです。\n' +
    '通知が来ても、やらなくて大丈夫。忘れずにいてくれるだけで十分です。',
  primaryButtonLabel: '通知を受け取る',
  secondaryButtonLabel: '今はしない',
};

/** 日次リマインド（ローテーション表示、3日連続で同じ文言は出さない） */
export interface DailyMessage {
  id: string;
  text: string;
}

export const DAILY_MESSAGES: DailyMessage[] = [
  { id: 'daily_1', text: '今日も5分だけ、いかがですか。' },
  { id: 'daily_2', text: 'すきま時間、見つかりましたか？' },
  { id: 'daily_3', text: '5分だけ、今いる場所から。' },
  { id: 'daily_4', text: '今日はどこにしましょうか。ちょっとだけ、片付けの時間です。' },
  {
    id: 'daily_5_after_rest',
    text: '昨日はお休みでも大丈夫。今日、また始めましょう。',
  },
];

/** 直近に未実施日があった翌日に優先表示する文言ID */
export const AFTER_REST_MESSAGE_ID = 'daily_5_after_rest';

export const ONBOARDING_FOLLOWUP_COPY = {
  day1: '昨日はインストールだけで十分です。今日、1つだけやってみませんか。',
  day3: '「片付けなきゃ」より先に、5分だけ試してみませんか。',
};

export const DORMANT_REENGAGEMENT_COPY = {
  day7: 'お久しぶりです。また、5分だけ始めてみませんか。',
  day14: '焦らなくて大丈夫。思い出した時が、はじめ時です。',
};

export const REST_TICKET_REFILL_COPY =
  '今週分のお休みチケットが補充されました。無理せず、いつでもどうぞ。';
