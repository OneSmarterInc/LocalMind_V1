/**
 * Timed messages ("toasts") replace the banners that used to sit at the top
 * of pages. One <ToastHost/> is mounted at the root; anything can call
 * showToast(). Rules:
 *   success and info close after 6 seconds, warnings after 10,
 *   errors (danger) stay until closed because they need an action;
 *   hovering (web) pauses the countdown; at most three show at once.
 *
 * Page explanations are also registered with the page they belong to, so
 * PageHeading can offer "About this page" to show them again later.
 */
import Ionicons from "@expo/vector-icons/Ionicons";
import { NavigationContext } from "@react-navigation/native";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { dismissToast, showToast, useToasts, type Toast, type ToastInput, type ToastTone } from "./toastStore";

export { dismissToast, showToast, useToasts } from "./toastStore";
export type { ToastInput, ToastTone } from "./toastStore";
export const TOAST_TONES: Record<ToastTone, { bg: string; border: string; fg: string; icon: keyof typeof Ionicons.glyphMap }> = {
  info: { bg: "#F1F6FC", border: "#DAE5F1", fg: "#3B5E7E", icon: "information-circle-outline" },
  success: { bg: "#F0F7F1", border: "#DBE9DE", fg: "#336655", icon: "checkmark-circle-outline" },
  warning: { bg: "#FFFAEC", border: "#EBDFBD", fg: "#866028", icon: "warning-outline" },
  danger: { bg: "#FFF3F1", border: "#EDD5D0", fg: "#923C35", icon: "alert-circle-outline" },
};

export function useToast() { return useMemo(() => ({ show: showToast, dismiss: dismissToast }), []); }

/* ------------------------------------------------------------------ */
/* Page messages ("About this page")                                   */
/* ------------------------------------------------------------------ */

type PageMessage = { key: string; input: ToastInput };
type PageMessages = { list: PageMessage[]; add: (m: PageMessage) => () => void; version: number };
const PageContext = createContext<PageMessages | null>(null);

/** Wraps one screen so its explanations can be shown again from the heading. */
export function PageMessagesProvider({ children }: { children: React.ReactNode }) {
  const [list, setList] = useState<PageMessage[]>([]);
  const add = useCallback((m: PageMessage) => {
    setList((prev) => (prev.some((x) => x.key === m.key) ? prev : [...prev, m]));
    return () => setList((prev) => prev.filter((x) => x.key !== m.key));
  }, []);
  const value = useMemo(() => ({ list, add, version: list.length }), [list, add]);
  return <PageContext.Provider value={value}>{children}</PageContext.Provider>;
}
export function usePageMessages() { return useContext(PageContext); }

/** True while the screen is the visible one. Outside navigation (sign-in), always true. */
export function useScreenFocused() {
  const nav = useContext(NavigationContext);
  const [focused, setFocused] = useState(() => (nav ? nav.isFocused() : true));
  useEffect(() => {
    if (!nav) return;
    setFocused(nav.isFocused());
    const a = nav.addListener("focus", () => setFocused(true));
    const b = nav.addListener("blur", () => setFocused(false));
    return () => { a(); b(); };
  }, [nav]);
  return focused;
}

// Page explanations show once per session; "About this page" shows them again.
const explained = new Set<string>();

/**
 * Called by Notice for messages that no longer sit on the page. Explanations
 * (info) show once per session; results and warnings show each time the
 * message changes while the page is visible.
 */
export function useTimedMessage(input: ToastInput, enabled: boolean) {
  const focused = useScreenFocused();
  const page = usePageMessages();
  const key = `${input.tone ?? "info"}|${input.title ?? ""}|${input.message}`;
  const last = useRef<string | null>(null);
  const addRef = useRef(page?.add);
  addRef.current = page?.add;
  const inputRef = useRef(input);
  inputRef.current = input;
  useEffect(() => {
    if (!enabled || (input.tone ?? "info") !== "info" || !addRef.current) return;
    return addRef.current({ key, input: inputRef.current });
  }, [enabled, key, input.tone]);
  useEffect(() => {
    if (!enabled || !focused || !input.message || last.current === key) return;
    last.current = key;
    if ((input.tone ?? "info") === "info") { if (explained.has(key)) return; explained.add(key); }
    showToast(inputRef.current);
  }, [enabled, focused, key, input.message, input.tone]);
}

/* ------------------------------------------------------------------ */
/* Host                                                                */
/* ------------------------------------------------------------------ */

export function ToastHost() {
  const list = useToasts();
  const { width } = useWindowDimensions();
  const narrow = width < 640;
  if (!list.length) return null;
  return (
    <View pointerEvents="box-none" style={[st.host, narrow ? { left: 12, right: 12, top: 84 } : { right: 24, top: 88, width: 360 }]} accessibilityLiveRegion="polite">
      {list.map((t) => <ToastCard key={t.id} toast={t} />)}
    </View>
  );
}

function ToastCard({ toast }: { toast: Toast }) {
  const tone = TOAST_TONES[toast.tone];
  const [paused, setPaused] = useState(false);
  const [left, setLeft] = useState(toast.duration);
  const bar = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!toast.duration || paused) return;
    const started = Date.now(), from = left;
    Animated.timing(bar, { toValue: 0, duration: from, useNativeDriver: false }).start();
    const tick = setInterval(() => {
      const remaining = from - (Date.now() - started);
      setLeft(remaining);
      if (remaining <= 0) { clearInterval(tick); dismissToast(toast.id); }
    }, 250);
    return () => { clearInterval(tick); bar.stopAnimation(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);
  const hover = Platform.OS === "web" ? { onHoverIn: () => setPaused(true), onHoverOut: () => setPaused(false) } : {};
  return (
    <Pressable {...hover} onLongPress={() => setPaused((p) => !p)} accessibilityRole={toast.tone === "danger" ? "alert" : "summary"}
      style={[st.card, { backgroundColor: tone.bg, borderColor: tone.border }]}>
      <Ionicons name={tone.icon} size={18} color={tone.fg} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, minWidth: 0 }}>
        {toast.title ? <Text style={{ color: tone.fg, fontWeight: "600", fontSize: 13, marginBottom: 2 }}>{toast.title}</Text> : null}
        <Text style={{ color: tone.fg, fontSize: 12.5, lineHeight: 19 }}>{toast.message}</Text>
      </View>
      {toast.duration ? <Text style={{ color: tone.fg, fontSize: 11, opacity: 0.8 }}>{paused ? "Paused" : `${Math.max(1, Math.ceil(left / 1000))}s`}</Text> : null}
      <Pressable onPress={() => dismissToast(toast.id)} accessibilityRole="button" accessibilityLabel="Close message" hitSlop={10} style={st.close}>
        <Ionicons name="close" size={16} color={tone.fg} />
      </Pressable>
      {toast.duration ? (
        <Animated.View style={[st.bar, { backgroundColor: tone.fg, width: bar.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) }]} />
      ) : null}
    </Pressable>
  );
}

const st = StyleSheet.create({
  host: { position: "absolute", zIndex: 1000, gap: 8 },
  card: {
    flexDirection: "row", alignItems: "flex-start", gap: 10, paddingHorizontal: 12, paddingTop: 11, paddingBottom: 13,
    borderRadius: 10, borderWidth: 1, overflow: "hidden",
    shadowColor: "#21382E", shadowOpacity: 0.12, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 4,
  },
  close: { padding: 2, borderRadius: 6 },
  bar: { position: "absolute", left: 0, bottom: 0, height: 3, opacity: 0.35 },
});

