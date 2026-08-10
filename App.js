import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  StyleSheet,
  SafeAreaView,
  Animated,
  Alert,
  ScrollView,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { NotificationSettingsScreen } from "./NotificationSettingsScreen";
import { recordAppOpen, addNotificationOpenedListener } from "./storage";
import { runDailyNotificationJob } from "./dailyJob";
import { CATEGORIES } from "./taskData";
import { pickTaskForCategory } from "./taskPicker";
import {
  initAnalytics,
  trackTaskCompleted,
  trackTaskSkipped,
  trackStreakDay,
  trackNotificationOpened,
} from "./analytics";
import { recordActivityAndGetStreak } from "./streakTracker";

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

function Header({ title, onBack, onSettingsPress }) {
  return (
    <View style={styles.header}>
      {onBack ? (
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>
      ) : (
        <View style={{ width: 34 }} />
      )}
      <Text style={styles.headerTitle}>{title}</Text>
      {onSettingsPress ? (
        <TouchableOpacity onPress={onSettingsPress} style={styles.settingsBtn}>
          <Text style={styles.settingsIcon}>⚙️</Text>
        </TouchableOpacity>
      ) : (
        <View style={{ width: 34 }} />
      )}
    </View>
  );
}

function PrimaryButton({ children, onPress }) {
  return (
    <TouchableOpacity style={styles.primaryBtn} onPress={onPress} activeOpacity={0.85}>
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

function PhotoStep({ subheading, photo, setPhoto, onSkip, onNext, nextLabel }) {
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
        {!photo && <GhostButton onPress={onSkip}>スキップ</GhostButton>}
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

function HomeIllustration() {
  return (
    <View style={styles.illustrationWrap}>
      <Svg width={168} height={122} viewBox="0 0 168 122" fill="none">
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

function CategoryScreen({ onSelect, onSettingsPress }) {
  return (
    <View style={styles.flexCol}>
      <Header title="どこを片付ける？" onSettingsPress={onSettingsPress} />
      <HomeIllustration />
      <Text style={styles.categoryIntro}>今いる場所を選んで、5分だけ片付けましょう。</Text>
      <View style={styles.categoryGrid}>
        {CATEGORIES.map((c) => (
          <TouchableOpacity
            key={c.id}
            style={styles.categoryCard}
            onPress={() => onSelect(c)}
            activeOpacity={0.85}
          >
            <View style={styles.categoryDot} />
            <Text style={styles.categoryCardText}>{c.label}</Text>
          </TouchableOpacity>
        ))}
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
    if (screen !== "timer" || phase !== "running") return;
    if (timeLeft <= 0) {
      setPhase("ended");
      notify();
      return;
    }
    const id = setTimeout(() => setTimeLeft((t) => t - 1), 1000);
    return () => clearTimeout(id);
  }, [screen, phase, timeLeft, notify]);

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
    const t = await pickTaskForCategory(category.id);
    setTask(t);
  };

  const goComplete = (kind) => {
    setFinishKind(kind);
    setPraiseMsg(pick(PRAISE[kind]));
    setPhotoMsg(beforePhoto || afterPhoto ? pick(PRAISE.photo) : "");
    setScreen("complete");
    trackTaskCompleted(kind);
    recordActivityAndGetStreak().then(trackStreakDay);
  };

  const goQuickComplete = () => {
    setPraiseMsg(pick(PRAISE.photoOnly));
    setScreen("quick-complete");
    trackTaskCompleted("quick");
    recordActivityAndGetStreak().then(trackStreakDay);
  };

  return (
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
          />
        )}

        {/* ---------------- TASK ---------------- */}
        {screen === "task" && category && task && (
          <View style={styles.flexCol}>
            <Header title="今日のタスク" onBack={() => setScreen("category")} />
            <View style={styles.taskCard}>
              <View style={styles.categoryChip}>
                <Text style={styles.categoryChipText}>{category.label}</Text>
              </View>
              <Text style={styles.taskTitle}>{task.title}</Text>
              <Text style={styles.taskNote}>{task.note}</Text>
            </View>
            <View style={{ flex: 1, minHeight: 40 }} />
            <View style={{ gap: 10 }}>
              <PrimaryButton onPress={() => setScreen("before-photo")}>5分、はじめる</PrimaryButton>
              <GhostButton onPress={rerollTask}>べつのタスクにする</GhostButton>
              <GhostButton onPress={() => setScreen("quick-photo")}>
                今日はここまで（写真だけで完了）
              </GhostButton>
            </View>
          </View>
        )}

        {/* ---------------- SETTINGS ---------------- */}
        {screen === "settings" && (
          <View style={styles.flexCol}>
            <Header title="設定" onBack={() => setScreen("category")} />
            <NotificationSettingsScreen />
          </View>
        )}

        {/* ---------------- BEFORE PHOTO ---------------- */}
        {screen === "before-photo" && (
          <View style={styles.flexCol}>
            <Header title="はじめる前に" onBack={() => setScreen("task")} />
            <PhotoStep
              subheading="撮っておくと、あとで見比べられます。義務ではありません。"
              photo={beforePhoto}
              setPhoto={setBeforePhoto}
              onSkip={() => setScreen("timer")}
              onNext={() => setScreen("timer")}
              nextLabel="タイマーをはじめる"
            />
          </View>
        )}

        {/* ---------------- TIMER ---------------- */}
        {screen === "timer" && task && (
          <View style={[styles.flexCol, { alignItems: "center" }]}>
            <Header title={task.title} onBack={() => setScreen("before-photo")} />

            {phase === "running" && (
              <>
                <TimerRing progress={timeLeft / 300} label={fmt(timeLeft)} sublabel="のこり時間" />
                <View style={{ flex: 1, minHeight: 20 }} />
                <View style={{ width: "100%" }}>
                  <GhostButton
                    onPress={() => {
                      setFinishKind("early");
                      setScreen("after-photo");
                    }}
                  >
                    完了した
                  </GhostButton>
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
                </View>
              </View>
            )}

            {phase === "extending" && (
              <>
                <TimerRing progress={1} label={`+${fmt(extraTime)}`} sublabel="延長中" pulse />
                <View style={{ flex: 1, minHeight: 20 }} />
                <View style={{ width: "100%" }}>
                  <PrimaryButton
                    onPress={() => {
                      setFinishKind("complete");
                      setScreen("after-photo");
                    }}
                  >
                    ここで終わる
                  </PrimaryButton>
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
              onSkip={() => goComplete(finishKind)}
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

            <View style={{ flex: 1, minHeight: 20 }} />
            <View style={{ width: "100%" }}>
              <GhostButton onPress={resetAll}>ホームへ戻る</GhostButton>
            </View>
          </View>
        )}

        {/* ---------------- QUICK PHOTO-ONLY ---------------- */}
        {screen === "quick-photo" && (
          <View style={styles.flexCol}>
            <Header title="今日はここまで" onBack={() => setScreen("task")} />
            <PhotoStep
              subheading="写真を1枚撮るだけでも、記録になります。タスクをこなせなくても大丈夫です。"
              photo={quickPhoto}
              setPhoto={setQuickPhoto}
              onSkip={goQuickComplete}
              onNext={goQuickComplete}
              nextLabel="これで完了にする"
            />
          </View>
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
  );
}

/* ---------- styles ---------- */
const styles = StyleSheet.create({
  outer: { flex: 1, backgroundColor: C.outerBg },
  screen: { flexGrow: 1, backgroundColor: C.bg, padding: 22, paddingBottom: 36 },
  flexCol: { flex: 1 },

  header: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 22 },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1.5,
    borderColor: C.ghostBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  backArrow: { fontSize: 20, color: C.ink, marginTop: -2 },
  headerTitle: { fontSize: 15, fontWeight: "800", color: C.ink, flex: 1 },
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

  illustrationWrap: { alignItems: "center", marginBottom: 14 },
  categoryIntro: { fontSize: 13, color: C.ink, opacity: 0.65, marginBottom: 18, textAlign: "center" },
  categoryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  categoryCard: {
    width: "47%",
    backgroundColor: C.card,
    borderRadius: 20,
    padding: 18,
    gap: 10,
  },
  categoryDot: { width: 10, height: 10, borderRadius: 4, backgroundColor: C.sage, opacity: 0.6 },
  categoryCardText: { fontSize: 15, fontWeight: "800", color: C.ink },

  taskCard: { backgroundColor: C.card, borderRadius: 24, padding: 20, marginBottom: 20 },
  categoryChip: {
    alignSelf: "flex-start",
    backgroundColor: C.well,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 12,
  },
  categoryChipText: { fontSize: 11, fontWeight: "800", color: C.ink },
  taskTitle: { fontSize: 19, fontWeight: "800", color: C.ink, marginBottom: 8, lineHeight: 26 },
  taskNote: { fontSize: 13, color: C.ink, opacity: 0.65, lineHeight: 19 },

  primaryBtn: { width: "100%", backgroundColor: C.sage, borderRadius: 18, paddingVertical: 16, alignItems: "center" },
  primaryBtnText: { color: C.bg, fontSize: 15, fontWeight: "800" },
  ghostBtn: {
    width: "100%",
    backgroundColor: "transparent",
    borderWidth: 1.5,
    borderColor: C.ghostBorder,
    borderRadius: 18,
    paddingVertical: 14,
    alignItems: "center",
  },
  ghostBtnText: { color: C.ink, fontSize: 14, fontWeight: "700" },

  subheading: { fontSize: 13, color: C.ink, opacity: 0.7, lineHeight: 19, marginBottom: 18 },
  cameraWell: {
    flex: 1,
    minHeight: 220,
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
  cameraWellText: { fontSize: 13, fontWeight: "700", color: C.ink, opacity: 0.75 },

  photoPreviewWrap: { flex: 1, minHeight: 220, borderRadius: 24, overflow: "hidden" },
  photoPreview: { width: "100%", height: "100%", minHeight: 220 },
  retakeChip: {
    position: "absolute",
    bottom: 12,
    right: 12,
    backgroundColor: "rgba(62,58,52,0.65)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  retakeChipText: { color: C.bg, fontSize: 12, fontWeight: "700" },

  ringWrap: { width: 220, height: 220, alignItems: "center", justifyContent: "center", marginVertical: 28 },
  ringLabelWrap: { position: "absolute", alignItems: "center" },
  ringLabel: { fontSize: 36, fontWeight: "800", color: C.ink },
  ringSublabel: { fontSize: 12, fontWeight: "600", color: C.ink, opacity: 0.55, marginTop: 4 },

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
  endedTitle: { fontSize: 16, fontWeight: "800", color: C.ink, marginBottom: 4 },
  endedNote: { fontSize: 13, color: C.ink, opacity: 0.6, marginBottom: 30, textAlign: "center" },

  sproutBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: C.coral,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  praiseMain: { fontSize: 17, fontWeight: "800", color: C.ink, textAlign: "center", lineHeight: 25, marginBottom: 8 },
  praiseSub: { fontSize: 13, color: C.ink, opacity: 0.6, textAlign: "center", marginBottom: 18 },

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
  compareLabel: { fontSize: 11, fontWeight: "700", color: C.ink, opacity: 0.5, marginTop: 6, textAlign: "center" },

  quickPhoto: { width: 160, height: 160, borderRadius: 18, marginBottom: 16 },
});
