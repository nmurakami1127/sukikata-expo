import "react-native-gesture-handler";
import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  StyleSheet,
  Animated,
  Alert,
  ScrollView,
  AppState,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import {
  GestureHandlerRootView,
  Gesture,
  GestureDetector,
} from "react-native-gesture-handler";
import { StatusBar } from "expo-status-bar";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { captureRef } from "react-native-view-shot";
import { NotificationSettingsScreen } from "./NotificationSettingsScreen";
import { RobotVacuumSettingsScreen } from "./RobotVacuumSettingsScreen";
import { HiddenTasksSettingsScreen } from "./HiddenTasksSettingsScreen";
import {
  recordAppOpen,
  addNotificationOpenedListener,
  scheduleTimerCompletionNotification,
  cancelTimerCompletionNotification,
  loadRobotVacuumPreferences,
} from "./storage";
import { runDailyNotificationJob } from "./dailyJob";
import { CATEGORIES, CATEGORY_STYLE } from "./taskData";
import {
  pickTaskForCategory,
  hideTaskAndPickReplacement,
  NoEligibleTaskError,
  NO_ELIGIBLE_TASK_MESSAGE,
  NO_ELIGIBLE_TASK_OPTION_OTHER_PLACE,
  NO_ELIGIBLE_TASK_OPTION_REVIEW_HIDDEN,
} from "./taskPicker";
import {
  RECOMMEND_ORDER,
  loadLastPlace,
  saveLastPlace,
  computeInitialRecommendation,
  nextRecommendationIndex,
} from "./recommendation";
import { loadHelpBadgeSeen, markHelpBadgeSeen } from "./helpGuide";
import {
  initAnalytics,
  trackTaskCompleted,
  trackTaskSkipped,
  trackStreakDay,
  trackNotificationOpened,
} from "./analytics";
import { recordActivityAndGetStreak } from "./streakTracker";
import { recordTaskCompletion, getRecentHistoryByDay } from "./historyStore";
import { saveImageToLibrary } from "./memento";

/* ---------- colors (spec section 5-1) ---------- */
const C = {
  outerBg: "#EDE7D6",
  bg: "#F5F1E6",
  card: "#FFFFFF",
  sage: "#8FA888",
  sageDark: "#7E9578",
  coral: "#E7A08E",
  mustard: "#D9AE63",
  ink: "#3E3A34",
  well: "#EFEADC",
  wellBorder: "#C9C0A4",
  ghostBorder: "#D9D2BC",
};

/* ---------- content (spec section 6) ---------- */
const PRAISE = {
  complete: [
    "ここまでで、じゅうぶんです。",
    "少しだけ、部屋の空気が変わりましたね。",
    "今日はここまで。それで大丈夫。",
    "ちゃんと、5分やりました。",
  ],
  early: [
    "途中でも、やった分はちゃんと残ります。",
    "5分やりきらなくても大丈夫。今日はここまで。",
  ],
  photo: [
    "変化が、ちゃんと残りました。",
    "この1枚が、今日の記録です。",
    "見比べると、少し違いますね。",
  ],
  photoOnly: [
    "今日はこれだけでも、十分な一歩です。",
    "手が動かない日があっても、大丈夫。",
  ],
};
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/* ---------- photo helpers ----------
   Photos stay on-device only (ImagePicker writes to the app's local
   sandbox / cache). Nothing is uploaded anywhere. In production this
   uri would additionally be copied into FileSystem.documentDirectory
   for long-term local storage. */
async function takePhoto() {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    Alert.alert("カメラを使えません", "設定アプリからカメラの権限を許可してください。");
    return null;
  }
  const result = await ImagePicker.launchCameraAsync({
    quality: 0.6,
    allowsEditing: false,
  });
  if (result.canceled) return null;
  return result.assets[0].uri;
}

async function pickFromLibrary() {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    Alert.alert("写真を選べません", "設定アプリから写真へのアクセスを許可してください。");
    return null;
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    quality: 0.6,
    allowsEditing: false,
  });
  if (result.canceled) return null;
  return result.assets[0].uri;
}

function choosePhotoSource(onPicked) {
  Alert.alert("写真を追加", undefined, [
    {
      text: "撮影する",
      onPress: async () => {
        const uri = await takePhoto();
        if (uri) onPicked(uri);
      },
    },
    {
      text: "ライブラリから選ぶ",
      onPress: async () => {
        const uri = await pickFromLibrary();
        if (uri) onPicked(uri);
      },
    },
    { text: "キャンセル", style: "cancel" },
  ]);
}

/* ---------- shared UI pieces ---------- */

/** 画面を右向きにスワイプすると onSwipeBack を呼ぶ（タイマー画面以外で使用） */
function SwipeBack({ onSwipeBack, children }) {
  const swipe = Gesture.Pan()
    .activeOffsetX(20)
    .failOffsetY([-20, 20])
    .onEnd((e) => {
      if (e.translationX > 60) {
        onSwipeBack();
      }
    });

  return (
    <GestureDetector gesture={swipe}>
      <View style={{ flex: 1 }}>{children}</View>
    </GestureDetector>
  );
}

const HIT_SLOP = { top: 8, bottom: 8, left: 6, right: 6 };

function Header({ title, onSettingsPress, onHistoryPress, onHelpPress, showHelpBadge }) {
  const hasRightButtons = onSettingsPress || onHistoryPress || onHelpPress;
  return (
    <View style={styles.header}>
      <Text style={styles.headerTitle}>{title}</Text>
      {hasRightButtons && (
        <View style={styles.headerActions}>
          {onHistoryPress && (
            <TouchableOpacity onPress={onHistoryPress} style={styles.historyBtn} hitSlop={HIT_SLOP}>
              <Text style={styles.historyBtnText}>記録</Text>
            </TouchableOpacity>
          )}
          {onHelpPress && (
            <TouchableOpacity onPress={onHelpPress} style={styles.settingsBtn} hitSlop={HIT_SLOP}>
              <Text style={styles.helpIcon}>?</Text>
              {showHelpBadge && <View style={styles.helpBadgeDot} />}
            </TouchableOpacity>
          )}
          {onSettingsPress && (
            <TouchableOpacity onPress={onSettingsPress} style={styles.settingsBtn} hitSlop={HIT_SLOP}>
              <Text style={styles.settingsIcon}>⚙️</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

function PrimaryButton({ children, onPress }) {
  return (
    <TouchableOpacity style={styles.primaryBtn} onPress={onPress} activeOpacity={0.85}>
      <Text style={styles.primaryBtnIcon}>▶</Text>
      <Text style={styles.primaryBtnText}>{children}</Text>
    </TouchableOpacity>
  );
}

function GhostButton({ children, onPress, disabled }) {
  return (
    <TouchableOpacity
      style={[styles.ghostBtn, disabled && styles.ghostBtnDisabled]}
      onPress={onPress}
      activeOpacity={0.7}
      disabled={disabled}
    >
      <Text style={[styles.ghostBtnText, disabled && styles.ghostBtnTextDisabled]}>{children}</Text>
    </TouchableOpacity>
  );
}

function PhotoStep({ subheading, photo, setPhoto, onNext, nextLabel, onBack }) {
  const handlePick = () => choosePhotoSource(setPhoto);

  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.subheading}>{subheading}</Text>

      {!photo ? (
        <TouchableOpacity style={styles.cameraWell} onPress={handlePick} activeOpacity={0.8}>
          <View style={styles.cameraDot}>
            <Text style={{ fontSize: 34 }}>📷</Text>
          </View>
          <Text style={styles.cameraWellText}>タップして追加する</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.photoPreviewWrap}>
          <Image source={{ uri: photo }} style={styles.photoPreview} />
          <TouchableOpacity style={styles.retakeChip} onPress={handlePick}>
            <Text style={styles.retakeChipText}>↺ 選び直す</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={{ gap: 10, marginTop: 20 }}>
        <PrimaryButton onPress={onNext}>{nextLabel}</PrimaryButton>
        {onBack && <GhostButton onPress={onBack}>もどる</GhostButton>}
      </View>
    </View>
  );
}

function TimerRing({ progress, label, sublabel, pulse }) {
  const r = 92;
  const c = 2 * Math.PI * r;
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    let loop;
    if (pulse) {
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        ])
      );
      loop.start();
    } else {
      opacity.setValue(1);
    }
    return () => loop && loop.stop();
  }, [pulse]);

  return (
    <View style={styles.ringWrap}>
      <Animated.View style={{ opacity }}>
        <Svg width={220} height={220} viewBox="0 0 220 220">
          <Circle cx="110" cy="110" r={r} fill="none" stroke="#E7DFC9" strokeWidth="10" />
          <Circle
            cx="110"
            cy="110"
            r={r}
            fill="none"
            stroke={C.sage}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - progress)}
            transform="rotate(-90 110 110)"
          />
        </Svg>
      </Animated.View>
      <View style={styles.ringLabelWrap} pointerEvents="none">
        <Text style={styles.ringLabel}>{label}</Text>
        {sublabel ? <Text style={styles.ringSublabel}>{sublabel}</Text> : null}
      </View>
    </View>
  );
}

/* ---------- category pictogram icons ---------- */
function CategoryIcon({ id, color, size = 22 }) {
  const props = { width: size, height: size, viewBox: "0 0 24 24", fill: "none" };
  switch (id) {
    case "desk":
      return (
        <Svg {...props}>
          <Rect x="3" y="9" width="18" height="3" rx="1" fill={color} />
          <Path d="M6 12 L6 19 M18 12 L18 19" stroke={color} strokeWidth="2" strokeLinecap="round" />
        </Svg>
      );
    case "floor":
      return (
        <Svg {...props}>
          <Path d="M3 18 L21 18" stroke={color} strokeWidth="2" strokeLinecap="round" />
          <Rect x="9" y="10" width="6" height="6" rx="1.5" fill={color} opacity="0.85" />
        </Svg>
      );
    case "shelf":
      return (
        <Svg {...props}>
          <Rect x="4" y="3" width="16" height="18" rx="1.5" stroke={color} strokeWidth="2" />
          <Path d="M4 9 L20 9 M4 15 L20 15" stroke={color} strokeWidth="2" />
        </Svg>
      );
    case "kitchen":
      return (
        <Svg {...props}>
          <Path
            d="M6 8 h10 v8 a5 5 0 0 1 -5 5 h0 a5 5 0 0 1 -5 -5 Z"
            stroke={color}
            strokeWidth="2"
          />
          <Path d="M16 10 h2 a2 2 0 0 1 0 4 h-2" stroke={color} strokeWidth="2" />
        </Svg>
      );
    case "living":
      return (
        <Svg {...props}>
          <Rect x="4" y="11" width="16" height="7" rx="2" stroke={color} strokeWidth="2" />
          <Path d="M5 11 v-3 a2 2 0 0 1 2 -2 h10 a2 2 0 0 1 2 2 v3" stroke={color} strokeWidth="2" />
          <Path d="M4 15 v4 M20 15 v4" stroke={color} strokeWidth="2" strokeLinecap="round" />
        </Svg>
      );
    case "entrance":
      return (
        <Svg {...props}>
          <Rect x="6" y="3" width="12" height="18" rx="1" stroke={color} strokeWidth="2" />
          <Circle cx="15" cy="12" r="1.2" fill={color} />
        </Svg>
      );
    case "closet":
      return (
        <Svg {...props}>
          <Path d="M12 4 a2 2 0 1 1 -2 2" stroke={color} strokeWidth="2" strokeLinecap="round" />
          <Path d="M12 6 L4 14 h16 Z" stroke={color} strokeWidth="2" strokeLinejoin="round" />
        </Svg>
      );
    case "digital":
      return (
        <Svg {...props}>
          <Rect x="5" y="9" width="14" height="11" rx="2" stroke={color} strokeWidth="2" />
          <Path d="M8 9 v-2 a4 4 0 0 1 8 0 v2" stroke={color} strokeWidth="2" />
        </Svg>
      );
    default:
      return null;
  }
}

function CategoryChip({ id, label }) {
  const style = CATEGORY_STYLE[id];
  return (
    <View style={[styles.categoryChip, style && { backgroundColor: style.bg }]}>
      {style && <CategoryIcon id={id} color={style.accent} size={14} />}
      <Text style={styles.categoryChipText}>{label}</Text>
    </View>
  );
}

function RecommendationCard({ category, onStart, onReroll, guidance, onGuidancePress }) {
  const style = CATEGORY_STYLE[category.id];
  return (
    <View style={styles.recommendCard}>
      <Text style={styles.recommendLabel}>今日のおすすめ</Text>
      <View style={styles.recommendPlaceRow}>
        <View style={[styles.recommendIconBadge, { backgroundColor: style.bg }]}>
          <CategoryIcon id={category.id} color={style.accent} size={28} />
        </View>
        <Text style={styles.recommendPlaceName}>{category.label}</Text>
      </View>
      {!guidance && (
        <TouchableOpacity onPress={onReroll} activeOpacity={0.7} style={styles.taskRerollChip}>
          <Text style={styles.taskRerollChipText}>↺ べつの場所にする</Text>
        </TouchableOpacity>
      )}
      <PrimaryButton onPress={onStart}>この場所にする</PrimaryButton>
      {guidance && (
        <TouchableOpacity onPress={onGuidancePress} activeOpacity={0.7}>
          <Text style={styles.recommendGuidanceText}>気になる場所を下から選んでみましょう ↓</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function CategoryScreen({
  onSelect,
  onSettingsPress,
  onHistoryPress,
  onHelpPress,
  showHelpBadge,
  recommendedCategory,
  onRerollRecommendation,
  recommendGuidance,
  onGuidancePress,
  onGridLayout,
}) {
  return (
    <View style={styles.flexCol}>
      <Header
        title="どこをかたづける？"
        onSettingsPress={onSettingsPress}
        onHistoryPress={onHistoryPress}
        onHelpPress={onHelpPress}
        showHelpBadge={showHelpBadge}
      />
      <Text style={styles.categoryIntro}>5分だけ、かたづけをはじめましょう。</Text>
      {recommendedCategory && (
        <RecommendationCard
          category={recommendedCategory}
          onStart={() => onSelect(recommendedCategory)}
          onReroll={onRerollRecommendation}
          guidance={recommendGuidance}
          onGuidancePress={onGuidancePress}
        />
      )}
      <View onLayout={(e) => onGridLayout(e.nativeEvent.layout.y)}>
        <Text style={styles.gridHeading}>または好きな場所を選ぶ</Text>
        <View style={styles.categoryGrid}>
          {CATEGORIES.map((c) => {
            const style = CATEGORY_STYLE[c.id];
            return (
              <TouchableOpacity
                key={c.id}
                style={[styles.categoryCard, { backgroundColor: style.bg }]}
                onPress={() => onSelect(c)}
                activeOpacity={0.85}
              >
                <View style={styles.categoryIconBadge}>
                  <CategoryIcon id={c.id} color={style.accent} />
                </View>
                <Text style={styles.categoryCardText} numberOfLines={1}>
                  {c.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </View>
  );
}

function formatHistoryDate(dateString) {
  const [, m, d] = dateString.split("-");
  return `${parseInt(m, 10)}月${parseInt(d, 10)}日`;
}

function HistoryScreen({ onBack, onSettingsPress, onHelpPress }) {
  const [days, setDays] = useState(null);

  useEffect(() => {
    getRecentHistoryByDay().then(setDays);
  }, []);

  return (
    <View style={styles.flexCol}>
      <Header title="これまでの記録" onSettingsPress={onSettingsPress} onHelpPress={onHelpPress} />
      <Text style={styles.taskHint}>
        直近30日に取り組んだ場所と回数です。{"\n"}写真は含まれません。
      </Text>
      {days && days.length === 0 && (
        <Text style={styles.historyEmpty}>
          まだ記録がありません。かたづけをすると、ここに残っていきます。
        </Text>
      )}
      {days &&
        days.map((day) => (
          <View key={day.date} style={styles.historyDayCard}>
            <Text style={styles.historyDate}>{formatHistoryDate(day.date)}</Text>
            <View style={styles.historyChipRow}>
              {day.counts.map((c) => (
                <CategoryChip
                  key={c.categoryId}
                  id={c.categoryId}
                  label={`${c.categoryLabel} × ${c.count}`}
                />
              ))}
            </View>
          </View>
        ))}
      <View style={{ marginTop: 20 }}>
        <GhostButton onPress={onBack}>もどる</GhostButton>
      </View>
    </View>
  );
}

function SproutBadge() {
  return (
    <View style={styles.sproutBadge}>
      <Text style={{ fontSize: 22 }}>🌱</Text>
    </View>
  );
}

function HelpSection({ title, children }) {
  return (
    <View style={styles.helpSection}>
      <Text style={styles.helpSectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function HelpParagraph({ children }) {
  return <Text style={styles.helpBody}>{children}</Text>;
}

function HelpStep({ number, title, body }) {
  return (
    <View style={styles.helpStepRow}>
      <View style={styles.helpStepNumber}>
        <Text style={styles.helpStepNumberText}>{number}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.helpStepTitle}>{title}</Text>
        <Text style={styles.helpBody}>{body}</Text>
      </View>
    </View>
  );
}

function HelpScreen({ onBack, onHistoryPress, onSettingsPress }) {
  return (
    <View style={styles.flexCol}>
      <Header title="使い方" onHistoryPress={onHistoryPress} onSettingsPress={onSettingsPress} />

      <HelpSection title="① このアプリの考え方">
        <HelpParagraph>かたづけは、一気にやろうとすると疲れてしまいます。</HelpParagraph>
        <HelpParagraph>
          このアプリは「5分だけ」を積み重ねる場所です。完璧にかたづけることや、毎日続けることを目指さなくて大丈夫です。
        </HelpParagraph>
      </HelpSection>

      <HelpSection title="② 基本の流れ（4ステップ）">
        <HelpStep number="1" title="どこをかたづける？" body="かたづける場所を選びます(おすすめも出ます)" />
        <HelpStep
          number="2"
          title="はじめる前に"
          body="かたづけ前の状態を撮っておくと、あとで見比べられます(任意)"
        />
        <HelpStep number="3" title="5分、はじめる" body="タイマーが動いている間だけ、取り組んでみましょう" />
        <HelpStep number="4" title="おわったら" body="変化を撮って残せます(こちらも任意)" />
      </HelpSection>

      <HelpSection title="③ 写真について">
        <HelpParagraph>写真は、かたづけ前後の変化を見比べるためのものです。</HelpParagraph>
        <HelpParagraph>
          撮らなくてもかたづけは完了にできます。「タイマーをはじめる」「完了にする」は、写真なしでもそのまま押して進められます。
        </HelpParagraph>
        <HelpParagraph>
          両方撮ると、「やる前」「やった後」を並べて見比べられます。5分やりきれなくても、途中でも大丈夫。やった分はちゃんと記録に残ります。
        </HelpParagraph>
        <HelpParagraph>「写真を記念に残す」を押すと、カメラロールに保存されます。</HelpParagraph>
      </HelpSection>

      <HelpSection title="④ 記録について">
        <HelpParagraph>「記録」ボタンから、直近30日に取り組んだ場所と回数が見られます。</HelpParagraph>
        <HelpParagraph>
          これは日々の振り返り用で、写真は含まれません。完璧を目指すためではなく、「これだけやったんだ」と気づくためのものです。
        </HelpParagraph>
      </HelpSection>

      <HelpSection title="⑤ 通知について">
        <HelpParagraph>
          通知は2種類あります。ひとつは1日最大1件だけの日次リマインド。「やらなきゃ」と急かすものではなく、そっとしたお知らせです。設定 &gt; 通知時刻 から、届く時間を変更できます。
        </HelpParagraph>
        <HelpParagraph>
          もうひとつは、5分タイマーが終わったときの通知です。アプリを他の操作で離れていても届きます。こちらは日次リマインドとは別に、設定からオン/オフを切り替えられます。
        </HelpParagraph>
      </HelpSection>

      <View style={{ marginTop: 8 }}>
        <GhostButton onPress={onBack}>もどる</GhostButton>
      </View>
    </View>
  );
}

/* ---------- app ---------- */

export default function App() {
  const [screen, setScreen] = useState("category");
  const [category, setCategory] = useState(null);
  const [task, setTask] = useState(null);
  const [beforePhoto, setBeforePhoto] = useState(null);
  const [afterPhoto, setAfterPhoto] = useState(null);
  const [quickPhoto, setQuickPhoto] = useState(null);
  const [mementoSaved, setMementoSaved] = useState(false);

  const [timeLeft, setTimeLeft] = useState(300);
  const [extraTime, setExtraTime] = useState(0);
  const [phase, setPhase] = useState("running");
  const [finishKind, setFinishKind] = useState("complete");
  const [praiseMsg, setPraiseMsg] = useState("");
  const [photoMsg, setPhotoMsg] = useState("");
  const [timerPaused, setTimerPaused] = useState(false);
  const [timerEndAt, setTimerEndAt] = useState(null);
  const [extendStartAt, setExtendStartAt] = useState(null);
  const [tick, setTick] = useState(0);
  const mementoRef = useRef(null);
  const mementoSavingRef = useRef(false);

  const [lastPlace, setLastPlace] = useState(null);
  const [lastPlaceLoaded, setLastPlaceLoaded] = useState(false);
  const [recommendState, setRecommendState] = useState({ index: 0, rerollCount: 0, guidance: false });
  const scrollViewRef = useRef(null);
  const gridYRef = useRef(0);

  const [helpBadgeSeen, setHelpBadgeSeen] = useState(true);
  const [previousScreen, setPreviousScreen] = useState("category");

  // 「出さない設定を見直す」タップ時、設定画面へ遷移したあとHiddenTasksSettingsScreenの
  // 位置まで自動スクロールするための座標保持（カテゴリグリッドへのスクロールと同じ仕組み）
  const hiddenTasksSectionYRef = useRef(0);
  const [scrollToHiddenTasksPending, setScrollToHiddenTasksPending] = useState(false);

  const notify = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, []);

  useEffect(() => {
    // アプリを開いたことを記録し、許可済みなら通知内容を最新化する
    initAnalytics();
    recordAppOpen();
    runDailyNotificationJob();
    loadLastPlace().then((lp) => {
      setLastPlace(lp);
      setLastPlaceLoaded(true);
    });
    loadHelpBadgeSeen().then((seen) => setHelpBadgeSeen(seen));

    const sub = addNotificationOpenedListener(() => {
      trackNotificationOpened();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    // ホーム画面に遷移するたびに、おすすめ候補をセッション内で再計算する
    if (screen !== "category" || !lastPlaceLoaded) return;
    setRecommendState({
      index: computeInitialRecommendation(lastPlace?.placeId ?? null),
      rerollCount: 0,
      guidance: false,
    });
  }, [screen, lastPlaceLoaded, lastPlace]);

  const rerollRecommendation = () => {
    // 関数型更新を使い、素早い連続タップでも常に最新の状態から次の候補を計算する
    setRecommendState((prev) => {
      if (prev.guidance || prev.rerollCount >= 3) {
        return { ...prev, guidance: true };
      }
      const next = nextRecommendationIndex(prev.index, lastPlace?.placeId ?? null);
      if (next === null) {
        return { ...prev, guidance: true };
      }
      return { index: next, rerollCount: prev.rerollCount + 1, guidance: false };
    });
  };

  const scrollToPlaceGrid = () => {
    scrollViewRef.current?.scrollTo({ y: gridYRef.current, animated: true });
  };

  // NoEligibleTaskError（実装指示書2-7・9-3 Bケース：非表示設定による候補枯渇）の案内。
  // 圧をかけないメッセージ＋2つの選択肢のみ。hiddenTaskIdsの自動解除はしない。
  const showNoEligibleTaskAlert = () => {
    Alert.alert(NO_ELIGIBLE_TASK_MESSAGE, undefined, [
      { text: NO_ELIGIBLE_TASK_OPTION_OTHER_PLACE, onPress: () => setScreen("category") },
      {
        text: NO_ELIGIBLE_TASK_OPTION_REVIEW_HIDDEN,
        onPress: () => {
          setScrollToHiddenTasksPending(true);
          setScreen("settings");
        },
      },
    ]);
  };

  const onHiddenTasksSectionLayout = (y) => {
    hiddenTasksSectionYRef.current = y;
    if (scrollToHiddenTasksPending) {
      scrollViewRef.current?.scrollTo({ y, animated: true });
      setScrollToHiddenTasksPending(false);
    }
  };

  const recommendedCategory = lastPlaceLoaded
    ? CATEGORIES.find((c) => c.id === RECOMMEND_ORDER[recommendState.index]) || null
    : null;

  // タイマーが「動き始める」瞬間（開始・一時停止解除）に終了予定時刻を記録し、
  // アプリがバックグラウンドでも届くよう、その時点の残り時間でOS通知を予約し直す。
  // timeLeft をあえて依存配列から外し、開始/再開のときの値だけをスナップショットとして使う。
  useEffect(() => {
    if (screen !== "timer" || phase !== "running" || timerPaused) return;
    setTimerEndAt(Date.now() + timeLeft * 1000);
    scheduleTimerCompletionNotification(timeLeft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, phase, timerPaused]);

  useEffect(() => {
    if (screen !== "timer" || phase !== "extending") return;
    setExtendStartAt(Date.now());
  }, [screen, phase]);

  // 実時刻（終了予定時刻との差）から残り時間を計算し直す。バックグラウンドで
  // setTimeout が止まっていても、アプリに戻った瞬間に正しい残り時間へ補正される。
  useEffect(() => {
    if (screen !== "timer" || phase !== "running" || timerPaused || timerEndAt == null) return;
    const remaining = Math.max(0, Math.ceil((timerEndAt - Date.now()) / 1000));
    setTimeLeft(remaining);
    if (remaining <= 0) {
      setPhase("ended");
      notify();
      return;
    }
    const id = setTimeout(() => setTick((t) => t + 1), 1000);
    return () => clearTimeout(id);
  }, [screen, phase, timerPaused, timerEndAt, tick, notify]);

  useEffect(() => {
    if (screen !== "timer" || phase !== "extending" || extendStartAt == null) return;
    setExtraTime(Math.max(0, Math.floor((Date.now() - extendStartAt) / 1000)));
    const id = setTimeout(() => setTick((t) => t + 1), 1000);
    return () => clearTimeout(id);
  }, [screen, phase, extendStartAt, tick]);

  // アプリがバックグラウンドから復帰した瞬間に、経過時間の再計算を即座に走らせる
  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") setTick((t) => t + 1);
    });
    return () => sub.remove();
  }, []);

  const resetAll = () => {
    cancelTimerCompletionNotification();
    setScreen("category");
    setCategory(null);
    setTask(null);
    setBeforePhoto(null);
    setAfterPhoto(null);
    setQuickPhoto(null);
    setMementoSaved(false);
    setTimeLeft(300);
    setExtraTime(0);
    setPhase("running");
    setFinishKind("complete");
    setTimerPaused(false);
    setTimerEndAt(null);
    setExtendStartAt(null);
  };

  const cancelTimer = () => {
    cancelTimerCompletionNotification();
    setTimeLeft(300);
    setExtraTime(0);
    setPhase("running");
    setTimerPaused(false);
    setTimerEndAt(null);
    setExtendStartAt(null);
    setScreen("before-photo");
  };

  const finishEarly = () => {
    cancelTimerCompletionNotification();
    setFinishKind("early");
    setScreen("after-photo");
  };

  const toggleTimerPause = () => {
    setTimerPaused((p) => {
      const next = !p;
      if (next) cancelTimerCompletionNotification(); // 一時停止する瞬間は予約通知を取り消す（再開時に再スケジュールされる）
      return next;
    });
  };

  const chooseCategory = async (c) => {
    setCategory(c);
    // 選択のたびに最新の設定を読み直す（設定画面はApp.jsの状態を経由せず自分でstorageに保存するため）
    const { robotVacuumStatus, hiddenTaskIds } = await loadRobotVacuumPreferences();
    try {
      const t = await pickTaskForCategory(c.id, undefined, robotVacuumStatus, hiddenTaskIds);
      setTask(t);
      setScreen("task");
    } catch (e) {
      if (e instanceof NoEligibleTaskError) {
        // screenは既に"category"のまま。案内アラートだけ重ねて表示する。
        showNoEligibleTaskAlert();
        return;
      }
      throw e;
    }
  };

  const startTask = async () => {
    if (category) {
      await saveLastPlace(category.id);
      setLastPlace({ placeId: category.id, selectedAt: new Date().toISOString() });
    }
    setScreen("before-photo");
  };

  const openHelp = (from) => {
    setPreviousScreen(from);
    setScreen("help");
    if (from === "category" && !helpBadgeSeen) {
      setHelpBadgeSeen(true);
      markHelpBadgeSeen();
    }
  };

  const rerollTask = async () => {
    if (!category) return;
    trackTaskSkipped();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const { robotVacuumStatus, hiddenTaskIds } = await loadRobotVacuumPreferences();
    try {
      const t = await pickTaskForCategory(category.id, task?.id, robotVacuumStatus, hiddenTaskIds);
      setTask(t);
    } catch (e) {
      if (e instanceof NoEligibleTaskError) {
        setScreen("category");
        showNoEligibleTaskAlert();
        return;
      }
      throw e;
    }
  };

  // 「このタスクは今後出さない」（実装指示書2-6）。タスク画面のrerollチップを長押しすると
  // 確認ダイアログを出す（通常利用では目立たせない補助機能として配置）。
  const hideCurrentTask = async () => {
    if (!category || !task) return;
    try {
      const t = await hideTaskAndPickReplacement(category.id, task.id);
      setTask(t);
    } catch (e) {
      if (e instanceof NoEligibleTaskError) {
        setScreen("category");
        showNoEligibleTaskAlert();
        return;
      }
      throw e;
    }
  };

  const confirmHideCurrentTask = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    Alert.alert(
      "このタスクは今後出さない",
      "この操作はいつでも設定画面から取り消せます。",
      [
        { text: "キャンセル", style: "cancel" },
        { text: "今後出さない", style: "destructive", onPress: hideCurrentTask },
      ]
    );
  };

  const goComplete = (kind) => {
    setFinishKind(kind);
    setPraiseMsg(pick(PRAISE[kind]));
    setPhotoMsg(beforePhoto || afterPhoto ? pick(PRAISE.photo) : "");
    setScreen("complete");
    trackTaskCompleted(kind);
    recordActivityAndGetStreak().then(trackStreakDay);
    if (category && task) recordTaskCompletion(category.id, category.label, task.title);
  };

  const goQuickComplete = () => {
    setPraiseMsg(pick(PRAISE.photoOnly));
    setScreen("quick-complete");
    trackTaskCompleted("quick");
    recordActivityAndGetStreak().then(trackStreakDay);
    if (category && task) recordTaskCompletion(category.id, category.label, task.title);
  };

  const saveMemento = async () => {
    if (mementoSaved || mementoSavingRef.current) return; // 連打・多重保存を防ぐ
    mementoSavingRef.current = true;
    try {
      const uri =
        beforePhoto && afterPhoto
          ? await captureRef(mementoRef, { format: "jpg", quality: 0.9 })
          : beforePhoto || afterPhoto;
      if (!uri) return;
      const ok = await saveImageToLibrary(uri);
      if (ok) setMementoSaved(true);
      Alert.alert(
        ok ? "保存しました" : "保存できません",
        ok ? "写真アプリに保存しました。" : "設定アプリから写真へのアクセスを許可してください。"
      );
    } catch {
      Alert.alert("保存できませんでした", "もう一度お試しください。");
    } finally {
      mementoSavingRef.current = false;
    }
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaProvider>
    <SafeAreaView style={styles.outer}>
      <StatusBar style="dark" />
      <ScrollView
        ref={scrollViewRef}
        contentContainerStyle={styles.screen}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ---------------- CATEGORY ---------------- */}
        {screen === "category" && (
          <CategoryScreen
            onSelect={chooseCategory}
            onSettingsPress={() => setScreen("settings")}
            onHistoryPress={() => setScreen("history")}
            onHelpPress={() => openHelp("category")}
            showHelpBadge={!helpBadgeSeen}
            recommendedCategory={recommendedCategory}
            onRerollRecommendation={rerollRecommendation}
            recommendGuidance={recommendState.guidance}
            onGuidancePress={scrollToPlaceGrid}
            onGridLayout={(y) => (gridYRef.current = y)}
          />
        )}

        {/* ---------------- HISTORY ---------------- */}
        {screen === "history" && (
          <SwipeBack onSwipeBack={() => setScreen("category")}>
            <HistoryScreen
              onBack={() => setScreen("category")}
              onSettingsPress={() => setScreen("settings")}
              onHelpPress={() => openHelp("history")}
            />
          </SwipeBack>
        )}

        {/* ---------------- TASK ---------------- */}
        {screen === "task" && category && task && (
          <SwipeBack onSwipeBack={() => setScreen("category")}>
            <View style={styles.flexCol}>
              <Header
                title="今日のかたづけ"
                onHistoryPress={() => setScreen("history")}
                onSettingsPress={() => setScreen("settings")}
                onHelpPress={() => openHelp("task")}
              />
              <View style={styles.taskCard}>
                <CategoryChip id={category.id} label={category.label} />
                <Text style={styles.taskTitle}>{task.title}</Text>
                <Text style={styles.taskNote}>{task.note}</Text>
              </View>
              <TouchableOpacity
                onPress={rerollTask}
                onLongPress={confirmHideCurrentTask}
                activeOpacity={0.7}
                style={styles.taskRerollChip}
              >
                <Text style={styles.taskRerollChipText}>↺ ほかのかたづけをする</Text>
              </TouchableOpacity>
              <View style={{ gap: 10 }}>
                <PrimaryButton onPress={startTask}>5分、はじめる</PrimaryButton>
                <GhostButton onPress={() => setScreen("category")}>ほかの場所をかたづける</GhostButton>
                <GhostButton onPress={() => setScreen("quick-photo")}>
                  今日はここまで（写真だけで完了）
                </GhostButton>
              </View>
            </View>
          </SwipeBack>
        )}

        {/* ---------------- SETTINGS ---------------- */}
        {screen === "settings" && (
          <SwipeBack onSwipeBack={() => setScreen("category")}>
            <View style={styles.flexCol}>
              <Header title="設定" onHistoryPress={() => setScreen("history")} onHelpPress={() => openHelp("settings")} />
              <TouchableOpacity style={styles.settingsRow} onPress={() => openHelp("settings")} activeOpacity={0.7}>
                <Text style={styles.settingsRowLabel}>アプリの使い方</Text>
                <Text style={styles.settingsRowChevron}>›</Text>
              </TouchableOpacity>
              <View style={styles.settingsRowDivider} />
              <NotificationSettingsScreen />
              <RobotVacuumSettingsScreen />
              <View onLayout={(e) => onHiddenTasksSectionLayout(e.nativeEvent.layout.y)}>
                <HiddenTasksSettingsScreen />
              </View>
              <View style={{ marginTop: 20 }}>
                <GhostButton onPress={() => setScreen("category")}>もどる</GhostButton>
              </View>
            </View>
          </SwipeBack>
        )}

        {/* ---------------- HELP ---------------- */}
        {screen === "help" && (
          <SwipeBack onSwipeBack={() => setScreen(previousScreen)}>
            <HelpScreen
              onBack={() => setScreen(previousScreen)}
              onHistoryPress={() => setScreen("history")}
              onSettingsPress={() => setScreen("settings")}
            />
          </SwipeBack>
        )}

        {/* ---------------- BEFORE PHOTO ---------------- */}
        {screen === "before-photo" && (
          <SwipeBack onSwipeBack={() => setScreen("task")}>
            <View style={styles.flexCol}>
              <Header
                title="はじめる前に"
                onHistoryPress={() => setScreen("history")}
                onSettingsPress={() => setScreen("settings")}
                onHelpPress={() => openHelp("before-photo")}
              />
              <PhotoStep
                subheading="かたづけ前の状態を撮っておくと、あとで見比べられます。義務ではありません。"
                photo={beforePhoto}
                setPhoto={setBeforePhoto}
                onNext={() => setScreen("timer")}
                nextLabel="タイマーをはじめる"
                onBack={() => setScreen("task")}
              />
            </View>
          </SwipeBack>
        )}

        {/* ---------------- TIMER ---------------- */}
        {screen === "timer" && task && (
          <View style={[styles.flexCol, { alignItems: "center" }]}>
            <Header title={task.title} />

            {phase === "running" && (
              <>
                <TimerRing
                  progress={timeLeft / 300}
                  label={fmt(timeLeft)}
                  sublabel={timerPaused ? "一時停止中" : "のこり時間"}
                />
                <View style={{ flex: 1, minHeight: 20 }} />
                <View style={{ width: "100%", gap: 10 }}>
                  <GhostButton onPress={finishEarly}>完了した</GhostButton>
                  <GhostButton onPress={toggleTimerPause}>
                    {timerPaused ? "タイマーを再開する" : "タイマーを一時停止する"}
                  </GhostButton>
                  <GhostButton onPress={cancelTimer}>やっぱやめる</GhostButton>
                </View>
              </>
            )}

            {phase === "ended" && (
              <View style={styles.endedBox}>
                <View style={styles.mustardBadge}>
                  <Text style={{ fontSize: 22 }}>⏰</Text>
                </View>
                <Text style={styles.endedTitle}>5分、経ちました</Text>
                <Text style={styles.endedNote}>つづけても、ここで終えても、どちらでも大丈夫。</Text>
                <View style={{ width: "100%", gap: 10 }}>
                  <PrimaryButton
                    onPress={() => {
                      setFinishKind("complete");
                      setScreen("after-photo");
                    }}
                  >
                    ここで終わる
                  </PrimaryButton>
                  <GhostButton onPress={() => setPhase("extending")}>まだやる</GhostButton>
                  <GhostButton onPress={cancelTimer}>やっぱやめる</GhostButton>
                </View>
              </View>
            )}

            {phase === "extending" && (
              <>
                <TimerRing progress={1} label={`+${fmt(extraTime)}`} sublabel="延長中" pulse />
                <View style={{ flex: 1, minHeight: 20 }} />
                <View style={{ width: "100%", gap: 10 }}>
                  <PrimaryButton
                    onPress={() => {
                      setFinishKind("complete");
                      setScreen("after-photo");
                    }}
                  >
                    ここで終わる
                  </PrimaryButton>
                  <GhostButton onPress={cancelTimer}>やっぱやめる</GhostButton>
                </View>
              </>
            )}
          </View>
        )}

        {/* ---------------- AFTER PHOTO ---------------- */}
        {screen === "after-photo" && (
          <View style={styles.flexCol}>
            <Header
              title="おわったら"
              onHistoryPress={() => setScreen("history")}
              onSettingsPress={() => setScreen("settings")}
              onHelpPress={() => openHelp("after-photo")}
            />
            <PhotoStep
              subheading="変化が残せます。こちらも任意です。"
              photo={afterPhoto}
              setPhoto={setAfterPhoto}
              onNext={() => goComplete(finishKind)}
              nextLabel="完了にする"
            />
          </View>
        )}

        {/* ---------------- COMPLETE ---------------- */}
        {screen === "complete" && (
          <View style={[styles.flexCol, { alignItems: "center" }]}>
            <View style={{ flex: 1, minHeight: 20 }} />
            <SproutBadge />
            <Text style={styles.praiseMain}>{praiseMsg}</Text>
            {photoMsg ? <Text style={styles.praiseSub}>{photoMsg}</Text> : null}

            {(beforePhoto || afterPhoto) && (
              <View style={styles.compareRow}>
                <View style={styles.compareCol}>
                  <View style={styles.compareThumb}>
                    {beforePhoto ? (
                      <Image source={{ uri: beforePhoto }} style={styles.compareImg} />
                    ) : (
                      <Text style={styles.emptyThumb}>—</Text>
                    )}
                  </View>
                  <Text style={styles.compareLabel}>やる前</Text>
                </View>
                <View style={styles.compareCol}>
                  <View style={styles.compareThumb}>
                    {afterPhoto ? (
                      <Image source={{ uri: afterPhoto }} style={styles.compareImg} />
                    ) : (
                      <Text style={styles.emptyThumb}>—</Text>
                    )}
                  </View>
                  <Text style={styles.compareLabel}>やった後</Text>
                </View>
              </View>
            )}

            {beforePhoto && afterPhoto && (
              <View ref={mementoRef} collapsable={false} style={styles.mementoComposite}>
                <Image source={{ uri: beforePhoto }} style={styles.mementoHalf} />
                <Image source={{ uri: afterPhoto }} style={styles.mementoHalf} />
              </View>
            )}

            <View style={{ flex: 1, minHeight: 20 }} />
            <View style={{ width: "100%", gap: 10 }}>
              {(beforePhoto || afterPhoto) && (
                <GhostButton onPress={saveMemento} disabled={mementoSaved}>
                  {mementoSaved ? "保存しました ✓" : "写真を記念に残す"}
                </GhostButton>
              )}
              <GhostButton onPress={resetAll}>ホームへ戻る</GhostButton>
            </View>
          </View>
        )}

        {/* ---------------- QUICK PHOTO-ONLY ---------------- */}
        {screen === "quick-photo" && (
          <SwipeBack onSwipeBack={() => setScreen("task")}>
            <View style={styles.flexCol}>
              <Header
                title="今日はここまで"
                onHistoryPress={() => setScreen("history")}
                onSettingsPress={() => setScreen("settings")}
                onHelpPress={() => openHelp("quick-photo")}
              />
              <PhotoStep
                subheading="写真を1枚撮るだけでも、記録になります。かたづけしなくても大丈夫です。"
                photo={quickPhoto}
                setPhoto={setQuickPhoto}
                onNext={goQuickComplete}
                nextLabel="これで完了にする"
                onBack={() => setScreen("task")}
              />
            </View>
          </SwipeBack>
        )}

        {/* ---------------- QUICK COMPLETE ---------------- */}
        {screen === "quick-complete" && (
          <View style={[styles.flexCol, { alignItems: "center" }]}>
            <View style={{ flex: 1, minHeight: 20 }} />
            <SproutBadge />
            <Text style={styles.praiseMain}>{praiseMsg}</Text>
            {quickPhoto ? (
              <Image source={{ uri: quickPhoto }} style={styles.quickPhoto} />
            ) : null}
            <View style={{ flex: 1, minHeight: 20 }} />
            <View style={{ width: "100%" }}>
              <GhostButton onPress={resetAll}>ホームへ戻る</GhostButton>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
    </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/* ---------- styles ---------- */
const styles = StyleSheet.create({
  outer: { flex: 1, backgroundColor: C.outerBg },
  screen: { flexGrow: 1, backgroundColor: C.bg, padding: 22, paddingBottom: 36 },
  flexCol: { flex: 1 },

  header: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 22 },
  headerTitle: { fontSize: 17, fontWeight: "800", color: C.ink, flex: 1 },
  settingsBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1.5,
    borderColor: C.ghostBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  settingsIcon: { fontSize: 16 },
  helpIcon: { fontSize: 16, fontWeight: "800", color: C.ink },
  helpBadgeDot: {
    position: "absolute",
    top: -2,
    right: -2,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: C.coral,
    borderWidth: 1.5,
    borderColor: C.bg,
  },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 12 },
  historyBtn: {
    height: 34,
    borderRadius: 17,
    borderWidth: 1.5,
    borderColor: C.ghostBorder,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  historyBtnText: { fontSize: 13, fontWeight: "800", color: C.ink },

  historyEmpty: { fontSize: 14, color: C.ink, opacity: 0.6, textAlign: "center", marginTop: 40, lineHeight: 21 },
  historyDayCard: { backgroundColor: C.card, borderRadius: 18, padding: 16, marginBottom: 12 },
  historyDate: { fontSize: 14, fontWeight: "800", color: C.ink, marginBottom: 10 },
  historyChipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },

  settingsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
  },
  settingsRowLabel: { fontSize: 16, color: C.ink },
  settingsRowChevron: { fontSize: 20, color: C.ink, opacity: 0.4 },
  settingsRowDivider: { height: 1, backgroundColor: C.ghostBorder, marginBottom: 4 },

  helpSection: { marginBottom: 26 },
  helpSectionTitle: { fontSize: 17, fontWeight: "800", color: C.ink, marginBottom: 10 },
  helpBody: { fontSize: 14, color: C.ink, opacity: 0.65, lineHeight: 21, marginBottom: 8 },
  helpStepRow: { flexDirection: "row", gap: 12, marginBottom: 16, alignItems: "flex-start" },
  helpStepNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: C.well,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  helpStepNumberText: { fontSize: 12, fontWeight: "800", color: C.sageDark },
  helpStepTitle: { fontSize: 15, fontWeight: "800", color: C.ink, marginBottom: 4 },

  mementoComposite: { position: "absolute", top: -9999, left: 0, width: 600, height: 400, flexDirection: "row" },
  mementoHalf: { width: 300, height: 400 },

  categoryIntro: {
    fontSize: 16,
    fontWeight: "700",
    color: C.ink,
    opacity: 0.85,
    lineHeight: 23,
    marginBottom: 6,
    textAlign: "center",
  },

  recommendCard: {
    backgroundColor: C.card,
    borderRadius: 24,
    padding: 20,
    marginTop: 16,
    marginBottom: 24,
  },
  recommendLabel: {
    fontSize: 18,
    fontWeight: "800",
    color: C.sageDark,
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  recommendPlaceRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  recommendIconBadge: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  recommendPlaceName: { fontSize: 21, fontWeight: "800", color: C.ink },
  recommendGuidanceText: {
    fontSize: 16,
    fontWeight: "700",
    color: C.sageDark,
    textAlign: "center",
    marginTop: 16,
  },

  gridHeading: {
    fontSize: 18,
    fontWeight: "800",
    color: C.ink,
    opacity: 0.85,
    marginBottom: 10,
  },
  categoryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  categoryCard: {
    width: "47%",
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.card,
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 10,
  },
  categoryIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.7)",
    alignItems: "center",
    justifyContent: "center",
  },
  categoryCardText: { fontSize: 16, fontWeight: "800", color: C.ink, flexShrink: 1 },

  taskHint: {
    fontSize: 14,
    fontWeight: "600",
    color: C.ink,
    opacity: 0.75,
    lineHeight: 20,
    marginBottom: 14,
    textAlign: "center",
  },

  taskCard: { backgroundColor: C.card, borderRadius: 24, padding: 20, marginBottom: 14 },
  taskRerollChip: {
    alignSelf: "center",
    backgroundColor: C.well,
    borderWidth: 1.5,
    borderColor: C.wellBorder,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 9,
    marginBottom: 20,
  },
  taskRerollChipText: { fontSize: 15, fontWeight: "700", color: C.ink },
  categoryChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    backgroundColor: C.well,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginBottom: 12,
  },
  categoryChipText: { fontSize: 12, fontWeight: "800", color: C.ink },
  taskTitle: { fontSize: 20, fontWeight: "800", color: C.ink, marginBottom: 8, lineHeight: 27 },
  taskNote: { fontSize: 14, color: C.ink, opacity: 0.65, lineHeight: 20 },

  primaryBtn: {
    width: "100%",
    backgroundColor: C.sage,
    borderRadius: 18,
    paddingVertical: 19,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    shadowColor: C.sageDark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 5,
  },
  primaryBtnIcon: { color: C.bg, fontSize: 16 },
  primaryBtnText: { color: C.bg, fontSize: 23, fontWeight: "900" },
  ghostBtn: {
    width: "100%",
    backgroundColor: "transparent",
    borderWidth: 1.5,
    borderColor: C.ghostBorder,
    borderRadius: 18,
    paddingVertical: 14,
    alignItems: "center",
  },
  ghostBtnText: { color: C.ink, fontSize: 15, fontWeight: "700" },
  ghostBtnDisabled: { opacity: 0.5 },
  ghostBtnTextDisabled: { opacity: 0.8 },

  subheading: { fontSize: 14, color: C.ink, opacity: 0.7, lineHeight: 20, marginBottom: 18 },
  cameraWell: {
    height: 190,
    borderRadius: 24,
    backgroundColor: C.well,
    borderWidth: 1.5,
    borderColor: C.wellBorder,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  cameraDot: { width: 76, height: 76, borderRadius: 38, backgroundColor: C.sage, alignItems: "center", justifyContent: "center" },
  cameraWellText: { fontSize: 14, fontWeight: "700", color: C.ink, opacity: 0.75 },

  photoPreviewWrap: { height: 190, borderRadius: 24, overflow: "hidden" },
  photoPreview: { width: "100%", height: "100%" },
  retakeChip: {
    position: "absolute",
    bottom: 12,
    right: 12,
    backgroundColor: "rgba(62,58,52,0.65)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  retakeChipText: { color: C.bg, fontSize: 13, fontWeight: "700" },

  ringWrap: { width: 220, height: 220, alignItems: "center", justifyContent: "center", marginVertical: 28 },
  ringLabelWrap: { position: "absolute", alignItems: "center" },
  ringLabel: { fontSize: 38, fontWeight: "800", color: C.ink },
  ringSublabel: { fontSize: 13, fontWeight: "600", color: C.ink, opacity: 0.55, marginTop: 4 },

  endedBox: { flex: 1, width: "100%", alignItems: "center", justifyContent: "center" },
  mustardBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: C.mustard,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  endedTitle: { fontSize: 17, fontWeight: "800", color: C.ink, marginBottom: 4 },
  endedNote: { fontSize: 14, color: C.ink, opacity: 0.6, marginBottom: 30, textAlign: "center" },

  sproutBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: C.coral,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  praiseMain: { fontSize: 18, fontWeight: "800", color: C.ink, textAlign: "center", lineHeight: 26, marginBottom: 8 },
  praiseSub: { fontSize: 14, color: C.ink, opacity: 0.6, textAlign: "center", marginBottom: 18 },

  compareRow: { flexDirection: "row", gap: 12, width: "100%", marginTop: 6, marginBottom: 20 },
  compareCol: { flex: 1 },
  compareThumb: {
    aspectRatio: 1,
    borderRadius: 18,
    backgroundColor: C.well,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  compareImg: { width: "100%", height: "100%" },
  emptyThumb: { color: C.ink, opacity: 0.3, fontSize: 18 },
  compareLabel: { fontSize: 12, fontWeight: "700", color: C.ink, opacity: 0.5, marginTop: 6, textAlign: "center" },

  quickPhoto: { width: 160, height: 160, borderRadius: 18, marginBottom: 16 },
});
