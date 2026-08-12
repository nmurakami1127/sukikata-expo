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
import { recordAppOpen, addNotificationOpenedListener } from "./storage";
import { runDailyNotificationJob } from "./dailyJob";
import { CATEGORIES, CATEGORY_STYLE } from "./taskData";
import { pickTaskForCategory } from "./taskPicker";
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

function Header({ title, onSettingsPress, onHistoryPress }) {
  const hasRightButtons = onSettingsPress || onHistoryPress;
  return (
    <View style={styles.header}>
      <View style={{ width: 34 }} />
      <Text style={styles.headerTitle}>{title}</Text>
      {hasRightButtons ? (
        <View style={styles.headerActions}>
          {onHistoryPress && (
            <TouchableOpacity onPress={onHistoryPress} style={styles.historyBtn}>
              <Text style={styles.historyBtnText}>記録</Text>
            </TouchableOpacity>
          )}
          {onSettingsPress && (
            <TouchableOpacity onPress={onSettingsPress} style={styles.settingsBtn}>
              <Text style={styles.settingsIcon}>⚙️</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <View style={{ width: 34 }} />
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

function GhostButton({ children, onPress }) {
  return (
    <TouchableOpacity style={styles.ghostBtn} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.ghostBtnText}>{children}</Text>
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
            <Text style={{ fontSize: 22 }}>📷</Text>
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

function HomeIllustration() {
  return (
    <View style={styles.illustrationWrap}>
      <Svg width={110} height={80} viewBox="0 0 168 122" fill="none">
        <Circle cx="24" cy="22" r="5" fill={C.mustard} opacity="0.3" />
        <Circle cx="146" cy="18" r="4" fill={C.coral} opacity="0.35" />
        <Circle cx="150" cy="96" r="6" fill={C.sage} opacity="0.22" />

        <Rect x="28" y="70" width="46" height="42" rx="9" fill={C.well} stroke={C.wellBorder} strokeWidth="2" />
        <Rect x="94" y="70" width="46" height="42" rx="9" fill={C.well} stroke={C.wellBorder} strokeWidth="2" />

        <Path d="M84 74 C84 54, 84 42, 84 22" stroke={C.sage} strokeWidth="4" strokeLinecap="round" />
        <Path d="M84 36 C84 26, 74 20, 62 22" stroke={C.sage} strokeWidth="4" strokeLinecap="round" fill="none" />
        <Path d="M84 48 C84 38, 96 33, 108 35" stroke={C.sage} strokeWidth="4" strokeLinecap="round" fill="none" />

        <Circle cx="84" cy="18" r="7" fill={C.coral} />
      </Svg>
    </View>
  );
}

function CategoryScreen({ onSelect, onSettingsPress, onHistoryPress }) {
  return (
    <View style={styles.flexCol}>
      <Header
        title="どこを片付ける？"
        onSettingsPress={onSettingsPress}
        onHistoryPress={onHistoryPress}
      />
      <Text style={styles.categoryIntro}>今いる場所を選んで、5分だけ片付けましょう。</Text>
      <HomeIllustration />
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
  );
}

function formatHistoryDate(dateString) {
  const [, m, d] = dateString.split("-");
  return `${parseInt(m, 10)}月${parseInt(d, 10)}日`;
}

function HistoryScreen({ onBack }) {
  const [days, setDays] = useState(null);

  useEffect(() => {
    getRecentHistoryByDay().then(setDays);
  }, []);

  return (
    <View style={styles.flexCol}>
      <Header title="これまでの記録" />
      <Text style={styles.taskHint}>直近30日に取り組んだ場所と回数です。写真は含まれません。</Text>
      {days && days.length === 0 && (
        <Text style={styles.historyEmpty}>
          まだ記録がありません。片付けをすると、ここに残っていきます。
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

/* ---------- app ---------- */

export default function App() {
  const [screen, setScreen] = useState("category");
  const [category, setCategory] = useState(null);
  const [task, setTask] = useState(null);
  const [beforePhoto, setBeforePhoto] = useState(null);
  const [afterPhoto, setAfterPhoto] = useState(null);
  const [quickPhoto, setQuickPhoto] = useState(null);

  const [timeLeft, setTimeLeft] = useState(300);
  const [extraTime, setExtraTime] = useState(0);
  const [phase, setPhase] = useState("running");
  const [finishKind, setFinishKind] = useState("complete");
  const [praiseMsg, setPraiseMsg] = useState("");
  const [photoMsg, setPhotoMsg] = useState("");
  const [timerPaused, setTimerPaused] = useState(false);
  const mementoRef = useRef(null);

  const notify = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, []);

  useEffect(() => {
    // アプリを開いたことを記録し、許可済みなら通知内容を最新化する
    initAnalytics();
    recordAppOpen();
    runDailyNotificationJob();

    const sub = addNotificationOpenedListener(() => {
      trackNotificationOpened();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (screen !== "timer" || phase !== "running" || timerPaused) return;
    if (timeLeft <= 0) {
      setPhase("ended");
      notify();
      return;
    }
    const id = setTimeout(() => setTimeLeft((t) => t - 1), 1000);
    return () => clearTimeout(id);
  }, [screen, phase, timeLeft, timerPaused, notify]);

  useEffect(() => {
    if (screen !== "timer" || phase !== "extending") return;
    const id = setTimeout(() => setExtraTime((t) => t + 1), 1000);
    return () => clearTimeout(id);
  }, [screen, phase, extraTime]);

  const resetAll = () => {
    setScreen("category");
    setCategory(null);
    setTask(null);
    setBeforePhoto(null);
    setAfterPhoto(null);
    setQuickPhoto(null);
    setTimeLeft(300);
    setExtraTime(0);
    setPhase("running");
    setFinishKind("complete");
    setTimerPaused(false);
  };

  const cancelTimer = () => {
    setTimeLeft(300);
    setExtraTime(0);
    setPhase("running");
    setTimerPaused(false);
    setScreen("before-photo");
  };

  const chooseCategory = async (c) => {
    setCategory(c);
    const t = await pickTaskForCategory(c.id);
    setTask(t);
    setScreen("task");
  };

  const rerollTask = async () => {
    if (!category) return;
    trackTaskSkipped();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const t = await pickTaskForCategory(category.id, task?.id);
    setTask(t);
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
    try {
      const uri =
        beforePhoto && afterPhoto
          ? await captureRef(mementoRef, { format: "jpg", quality: 0.9 })
          : beforePhoto || afterPhoto;
      if (!uri) return;
      const ok = await saveImageToLibrary(uri);
      Alert.alert(
        ok ? "保存しました" : "保存できません",
        ok ? "写真アプリに保存しました。" : "設定アプリから写真へのアクセスを許可してください。"
      );
    } catch {
      Alert.alert("保存できませんでした", "もう一度お試しください。");
    }
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaProvider>
    <SafeAreaView style={styles.outer}>
      <StatusBar style="dark" />
      <ScrollView
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
          />
        )}

        {/* ---------------- HISTORY ---------------- */}
        {screen === "history" && (
          <SwipeBack onSwipeBack={() => setScreen("category")}>
            <HistoryScreen onBack={() => setScreen("category")} />
          </SwipeBack>
        )}

        {/* ---------------- TASK ---------------- */}
        {screen === "task" && category && task && (
          <SwipeBack onSwipeBack={() => setScreen("category")}>
            <View style={styles.flexCol}>
              <Header title="今日のかたづけ" />
              <View style={styles.taskCard}>
                <CategoryChip id={category.id} label={category.label} />
                <Text style={styles.taskTitle}>{task.title}</Text>
                <Text style={styles.taskNote}>{task.note}</Text>
              </View>
              <View style={{ height: 20 }} />
              <Text style={styles.taskHint}>
                下のボタンを押すと、5分間のタイマーが始まります。
              </Text>
              <View style={{ gap: 10 }}>
                <PrimaryButton onPress={() => setScreen("before-photo")}>5分、はじめる</PrimaryButton>
                <GhostButton onPress={rerollTask}>ほかのかたづけをする</GhostButton>
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
              <Header title="設定" />
              <NotificationSettingsScreen />
              <View style={{ marginTop: 20 }}>
                <GhostButton onPress={() => setScreen("category")}>もどる</GhostButton>
              </View>
            </View>
          </SwipeBack>
        )}

        {/* ---------------- BEFORE PHOTO ---------------- */}
        {screen === "before-photo" && (
          <SwipeBack onSwipeBack={() => setScreen("task")}>
            <View style={styles.flexCol}>
              <Header title="はじめる前に" />
              <PhotoStep
                subheading="片付け前の状態を撮っておくと、あとで見比べられます。義務ではありません。"
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
                  <GhostButton
                    onPress={() => {
                      setFinishKind("early");
                      setScreen("after-photo");
                    }}
                  >
                    完了した
                  </GhostButton>
                  <GhostButton onPress={() => setTimerPaused((p) => !p)}>
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
            <Header title="おわったら" />
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
                  <Text style={styles.compareLabel}>撮る前</Text>
                </View>
                <View style={styles.compareCol}>
                  <View style={styles.compareThumb}>
                    {afterPhoto ? (
                      <Image source={{ uri: afterPhoto }} style={styles.compareImg} />
                    ) : (
                      <Text style={styles.emptyThumb}>—</Text>
                    )}
                  </View>
                  <Text style={styles.compareLabel}>撮った後</Text>
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
                <GhostButton onPress={saveMemento}>写真を記念に残す</GhostButton>
              )}
              <GhostButton onPress={resetAll}>ホームへ戻る</GhostButton>
            </View>
          </View>
        )}

        {/* ---------------- QUICK PHOTO-ONLY ---------------- */}
        {screen === "quick-photo" && (
          <SwipeBack onSwipeBack={() => setScreen("task")}>
            <View style={styles.flexCol}>
              <Header title="今日はここまで" />
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
  headerActions: { flexDirection: "row", gap: 16 },
  historyBtn: {
    height: 34,
    borderRadius: 17,
    borderWidth: 1.5,
    borderColor: C.ghostBorder,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  historyBtnText: { fontSize: 13, fontWeight: "800", color: C.ink },

  historyEmpty: { fontSize: 14, color: C.ink, opacity: 0.6, textAlign: "center", marginTop: 40, lineHeight: 21 },
  historyDayCard: { backgroundColor: C.card, borderRadius: 18, padding: 16, marginBottom: 12 },
  historyDate: { fontSize: 14, fontWeight: "800", color: C.ink, marginBottom: 10 },
  historyChipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },

  mementoComposite: { position: "absolute", top: -9999, left: 0, width: 600, height: 400, flexDirection: "row" },
  mementoHalf: { width: 300, height: 400 },

  illustrationWrap: { alignItems: "center", marginBottom: 10 },
  categoryIntro: {
    fontSize: 16,
    fontWeight: "700",
    color: C.ink,
    opacity: 0.85,
    lineHeight: 23,
    marginBottom: 6,
    textAlign: "center",
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

  taskCard: { backgroundColor: C.card, borderRadius: 24, padding: 20, marginBottom: 20 },
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
  cameraDot: { width: 60, height: 60, borderRadius: 30, backgroundColor: C.sage, alignItems: "center", justifyContent: "center" },
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
