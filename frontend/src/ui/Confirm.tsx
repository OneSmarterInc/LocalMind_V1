/**
 * One dialog for the whole product.
 *
 * The browser's own window.confirm and window.alert are never used: they sit
 * at the top of the viewport, carry the origin string, and cannot be styled,
 * so they look nothing like the rest of LocalMind. React Native's Alert.alert
 * is also a no-op on react-native-web, which used to leave web buttons
 * spinning forever on a promise that never resolved.
 *
 * Instead, <DialogHost/> is mounted once at the root of the app and every
 * call site uses the promise helpers below. The dialog renders in the centre
 * of the page on every platform, with a dimmed backdrop, an icon that matches
 * the tone, and Cancel / confirm buttons in a consistent order.
 */
import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { colors, font, radius, radiusSm, space } from "./theme";

type IconName = keyof typeof Ionicons.glyphMap;

export type DialogTone = "danger" | "primary" | "warning";

export interface DialogOptions {
  /** Colour and icon of the confirm button. Destructive actions use "danger". */
  tone?: DialogTone;
  /** Overrides the icon picked from the tone. */
  icon?: IconName;
  /** Extra line under the message, e.g. the exact record being removed. */
  detail?: string;
  /** Hides the cancel button; used by alertAsync. */
  acknowledge?: boolean;
}

interface DialogRequest extends DialogOptions {
  id: number;
  title: string;
  message: string;
  okLabel: string;
  cancelLabel: string;
  resolve: (value: boolean | "extra") => void;
  /** A third button between cancel and confirm (used by choiceAsync). */
  extraLabel?: string;
}

/* ------------------------------------------------------------------ */
/* Queue                                                               */
/* ------------------------------------------------------------------ */

let sequence = 0;
let pending: DialogRequest[] = [];
let notify: (() => void) | null = null;

function enqueue(request: DialogRequest) {
  pending = [...pending, request];
  notify?.();
}

function dequeue(id: number) {
  pending = pending.filter((r) => r.id !== id);
  notify?.();
}

/**
 * Ask the person to confirm something. Resolves true when they accept and
 * false when they cancel, dismiss with Escape, or tap the backdrop.
 */
export function confirmAsync(
  title: string,
  message = "",
  okLabel = "Confirm",
  cancelLabel = "Cancel",
  options: DialogOptions = {},
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    enqueue({
      id: ++sequence,
      title,
      message,
      okLabel,
      cancelLabel,
      tone: options.tone ?? "primary",
      icon: options.icon,
      detail: options.detail,
      acknowledge: options.acknowledge,
      resolve: (v) => resolve(v === true),
    });
  });
}

/** Destructive confirmation: red confirm button, warning icon, "Delete" verb. */
export function confirmDeleteAsync(
  title: string,
  message: string,
  options: DialogOptions & { okLabel?: string } = {},
): Promise<boolean> {
  const { okLabel = "Delete", ...rest } = options;
  return confirmAsync(title, message, okLabel, "Cancel", { tone: "danger", ...rest });
}

/** Single-button message. Replaces window.alert. */
/**
 * Three choices, e.g. Save / Discard / Stay when leaving unsaved work. Escape or the backdrop means `cancel`.
 */
export function choiceAsync(title: string, message: string, labels: { confirm: string; extra: string; cancel: string }): Promise<"confirm" | "extra" | "cancel"> {
  return new Promise((resolve) => {
    enqueue({
      id: ++sequence, title, message, okLabel: labels.confirm, cancelLabel: labels.cancel, extraLabel: labels.extra, tone: "primary",
      resolve: (v) => resolve(v === "extra" ? "extra" : v ? "confirm" : "cancel"),
    });
  });
}

export function alertAsync(title: string, message = "", okLabel = "OK"): Promise<boolean> {
  return confirmAsync(title, message, okLabel, "", { acknowledge: true });
}

/* ------------------------------------------------------------------ */
/* Host                                                                */
/* ------------------------------------------------------------------ */

const TONE: Record<DialogTone, { color: string; icon: IconName }> = {
  danger: { color: colors.danger, icon: "trash-outline" },
  warning: { color: colors.warning, icon: "warning-outline" },
  primary: { color: colors.primary, icon: "help-circle-outline" },
};

/** Mounted once in the root layout. Renders whatever the queue holds. */
export function DialogHost() {
  const [, force] = useState(0);
  const { width } = useWindowDimensions();
  useEffect(() => {
    notify = () => force((n) => n + 1);
    return () => { notify = null; };
  }, []);

  const current = pending[0];
  const answer = useCallback((value: boolean | "extra") => {
    if (!current) return;
    current.resolve(value);
    dequeue(current.id);
  }, [current]);

  // Keyboard shortcuts on the web build: Escape cancels, Enter confirms.
  const answerRef = useRef(answer);
  answerRef.current = answer;
  useEffect(() => {
    if (Platform.OS !== "web" || !current) return;
    const doc = (globalThis as unknown as { document?: { addEventListener: Function; removeEventListener: Function } }).document;
    if (!doc) return;
    const onKey = (e: { key?: string; preventDefault?: () => void }) => {
      if (e.key === "Escape") { e.preventDefault?.(); answerRef.current(false); }
      if (e.key === "Enter") { e.preventDefault?.(); answerRef.current(true); }
    };
    doc.addEventListener("keydown", onKey);
    return () => doc.removeEventListener("keydown", onKey);
  }, [current]);

  if (!current) return null;
  const tone = TONE[current.tone ?? "primary"];
  const icon = current.icon ?? tone.icon;
  const okColor = current.tone === "danger" ? colors.danger : colors.primary;
  const okText = current.tone === "danger" ? "#FFFFFF" : colors.primaryText;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => answer(false)}>
      <Pressable style={s.backdrop} onPress={() => answer(false)}>
        {/* Stops a tap inside the card from reaching the backdrop. */}
        <Pressable style={[s.dialog, { maxWidth: Math.min(460, width - 32) }]} onPress={() => {}}>
          <View style={s.head}>
            <View style={[s.iconWrap, { backgroundColor: `${tone.color}1F`, borderColor: `${tone.color}55` }]}>
              <Ionicons name={icon} size={22} color={tone.color} />
            </View>
            <Text style={s.title}>{current.title}</Text>
          </View>
          {current.message ? <Text style={s.message}>{current.message}</Text> : null}
          {current.detail ? (
            <View style={s.detail}>
              <Text style={s.detailText}>{current.detail}</Text>
            </View>
          ) : null}
          <View style={s.actions}>
            {current.acknowledge ? null : (
              <Pressable
                onPress={() => answer(false)}
                accessibilityRole="button"
                style={({ pressed }) => [s.btn, s.btnGhost, pressed && { opacity: 0.8 }]}
              >
                <Text style={[s.btnText, { color: colors.text }]}>{current.cancelLabel || "Cancel"}</Text>
              </Pressable>
            )}
            {current.extraLabel ? (
              <Pressable onPress={() => answer("extra")} accessibilityRole="button" style={({ pressed }) => [s.btn, s.btnGhost, pressed && { opacity: 0.8 }]}>
                <Text style={[s.btnText, { color: colors.danger }]}>{current.extraLabel}</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => answer(true)}
              accessibilityRole="button"
              style={({ pressed }) => [s.btn, { backgroundColor: okColor }, pressed && { opacity: 0.85 }]}
            >
              <Text style={[s.btnText, { color: okText }]}>{current.okLabel}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(22,40,30,0.35)",
    alignItems: "center",
    justifyContent: "center",
    padding: space.lg,
  },
  dialog: {
    width: "100%",
    backgroundColor: colors.surface,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    padding: space.xl,
    gap: space.md,
    ...(Platform.OS === "web"
      ? ({ boxShadow: "0 14px 40px rgba(22,40,30,0.18)" } as object)
      : { shadowColor: "#1B3B2A", shadowOpacity: 0.18, shadowRadius: 28, shadowOffset: { width: 0, height: 14 }, elevation: 16 }),
  },
  head: { flexDirection: "row", alignItems: "center", gap: space.md },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { ...font.h2, color: colors.text, flex: 1, minWidth: 0, fontSize: 18 },
  message: { ...font.body, color: colors.muted },
  detail: {
    backgroundColor: colors.surface2,
    borderRadius: radiusSm,
    borderLeftWidth: 3,
    borderLeftColor: colors.borderStrong,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  detailText: { ...font.small, color: colors.text, fontWeight: "600" },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: space.sm,
    marginTop: space.xs,
    flexWrap: "wrap",
  },
  btn: {
    minWidth: 104,
    borderRadius: radiusSm,
    paddingVertical: 11,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  btnGhost: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.borderStrong },
  btnText: { fontSize: 14, fontWeight: "700" },
});
