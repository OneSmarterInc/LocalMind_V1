import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  ActivityIndicator, Keyboard, Modal, Platform, Pressable, PressableStateCallbackType, RefreshControl, ScrollView, StyleProp, StyleSheet, Text,
  TextInput, TextInputProps, TextStyle, View, ViewStyle, useWindowDimensions,
} from "react-native";
import { OfflineBanner } from "@/offline/OfflineBanner";
import { Gradient } from "./Gradient";
import { Tone, bp, colors, font, gradients, radius, radiusSm, space, statusTone, tones } from "./theme";

export { Gradient };
export { colors, gradients, space, radius, radiusSm, bp, font, tones };
export type { Tone };
// Every popup in the product goes through this one centred dialog, so nothing
// falls back to the browser's own confirm box.
export { DialogHost, alertAsync, choiceAsync, confirmAsync, confirmDeleteAsync } from "./Confirm";
export type { DialogOptions, DialogTone } from "./Confirm";

type IconName = keyof typeof Ionicons.glyphMap;
/** react-native-web adds `hovered` to the press state; native never sets it. */
type PressState = PressableStateCallbackType & { hovered?: boolean };

export const SIDEBAR_WIDTH = 238;
const CONTENT_MAX = 1370;
const shadow: ViewStyle = Platform.OS === "web"
  ? ({ boxShadow: "0 8px 30px rgba(27,59,42,0.03)" } as ViewStyle)
  : { shadowColor: "#1B3B2A", shadowOpacity: 0.04, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 1 };

/** Horizontal page padding for the current window. */
export function useGutter() {
  const { width } = useWindowDimensions();
  return width >= bp.desktop ? 32 : width >= bp.tablet ? 24 : 16;
}

/** True when the window is wide enough for side-by-side layouts. */
export function useWide(min = 900) {
  const { width } = useWindowDimensions();
  const sidebar = width >= bp.desktop ? SIDEBAR_WIDTH : 0;
  return width - sidebar >= min;
}

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

export function Screen({ children, scroll = true, refreshing, onRefresh, padded = true, wide, toolbar, actions }: {
  children: React.ReactNode; scroll?: boolean; refreshing?: boolean; onRefresh?: () => void; padded?: boolean; wide?: boolean;
  toolbar?: React.ReactNode; actions?: React.ReactNode;
}) {
  const gutter = useGutter();
  const bar = toolbar || actions ? <Toolbar right={actions}>{toolbar}</Toolbar> : null;
  const inner = (
    <View style={[padded && { paddingHorizontal: gutter, paddingTop: 28, gap: space.lg }, { maxWidth: wide ? 1600 : CONTENT_MAX + gutter * 2, width: "100%", alignSelf: "center" }, !scroll && { flex: 1, minHeight: 0 }]}>
      {bar}
      {children}
    </View>
  );
  if (!scroll) return <View style={{ flex: 1, minHeight: 0, backgroundColor: colors.bg }}>{inner}</View>;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 48 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={Platform.OS === "web"}
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} /> : undefined}>
      {inner}
    </ScrollView>
  );
}

export function Card({ children, style, onPress, accent, flush }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; accent?: string; flush?: boolean }) {
  const body = (hovered = false) => (
    <View style={[s.card, flush && { padding: 0, gap: 0 }, accent ? { borderLeftWidth: 3, borderLeftColor: accent } : null, hovered && onPress && s.cardHover, style]}>
      {children}
    </View>
  );
  if (!onPress) return body();
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      {(st: PressState) => <View style={st.pressed ? { opacity: 0.9 } : null}>{body(!!st.hovered)}</View>}
    </Pressable>
  );
}

/** Equal-width columns that wrap on narrow screens. */
export function Grid({ children, min = 300, gap = 20 }: { children: React.ReactNode; min?: number; gap?: number }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap }}>{React.Children.map(children, (c) => (c ? <View style={{ flex: 1, minWidth: min }}>{c}</View> : null))}</View>;
}

/** As many equal columns as the window holds, at least `min` wide each. */
export function CardGrid({ children, min = 300, gap = 20, max, fill }: { children: React.ReactNode; min?: number; gap?: number; max?: number; fill?: boolean }) {
  const { width } = useWindowDimensions();
  const gutter = useGutter();
  const items = React.Children.toArray(children).filter(Boolean);
  if (items.length === 0) return null;
  const sidebar = width >= bp.desktop ? SIDEBAR_WIDTH : 0;
  const available = Math.min(width - sidebar - gutter * 2, CONTENT_MAX);
  const columns = Math.max(1, Math.min(max ?? 99, fill ? items.length : 99, Math.floor((available + gap) / (min + gap))));
  if (columns === 1) return <View style={{ gap }}>{items}</View>;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", margin: -gap / 2 }}>
      {items.map((child, i) => <View key={i} style={{ width: `${100 / columns}%`, padding: gap / 2 }}>{child}</View>)}
    </View>
  );
}

/** Main column plus a narrower side column; stacks below `min`. */
export function Split({ main, side, sideWidth = 320, min = 980, gap = 24 }: { main: React.ReactNode; side: React.ReactNode; sideWidth?: number; min?: number; gap?: number }) {
  const wide = useWide(min);
  if (!wide) return <View style={{ gap }}>{main}{side}</View>;
  return (
    <View style={{ flexDirection: "row", gap, alignItems: "flex-start" }}>
      <View style={{ flex: 1, minWidth: 0, gap }}>{main}</View>
      <View style={{ width: sideWidth, gap }}>{side}</View>
    </View>
  );
}

export function Panel({ children, width = 760, style }: { children: React.ReactNode; width?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ width: "100%", maxWidth: width, gap: space.lg }, style]}>{children}</View>;
}

export function Row({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: "row", alignItems: "center", gap: space.md, flexWrap: "wrap" }, style]}>{children}</View>;
}

export function Divider() { return <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 8 }} />; }

export function Toolbar({ children, right }: { children?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={s.toolbar}>
      <View style={s.toolbarGroup}>{children}</View>
      {right ? <View style={s.toolbarActions}>{right}</View> : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Typography                                                          */
/* ------------------------------------------------------------------ */

export function H1({ children }: { children: React.ReactNode }) { return <Text style={s.h1} accessibilityRole="header">{children}</Text>; }
export function H2({ children, icon }: { children: React.ReactNode; icon?: IconName }) {
  return (
    <View style={s.h2Row}>
      {icon ? <Ionicons name={icon} size={18} color={colors.primary} /> : null}
      <Text style={s.h2} accessibilityRole="header">{children}</Text>
    </View>
  );
}
export function H3({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) { return <Text style={[s.h3, style]}>{children}</Text>; }
export function P({ children, muted, small, style, numberOfLines }: { children: React.ReactNode; muted?: boolean; small?: boolean; style?: StyleProp<TextStyle>; numberOfLines?: number }) {
  return <Text numberOfLines={numberOfLines} style={[s.p, muted && { color: colors.muted }, small && font.small, style]}>{children}</Text>;
}
export function Label({ children }: { children: React.ReactNode }) { return <Text style={s.label}>{children}</Text>; }
export function Eyebrow({ children, color }: { children: React.ReactNode; color?: string }) { return <Text style={[s.eyebrow, color ? { color } : null]}>{children}</Text>; }
export function TextLink({ title, onPress, icon, iconLeft }: { title: string; onPress: () => void; icon?: IconName; iconLeft?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="link" accessibilityLabel={title} hitSlop={6}>
      {(st: PressState) => (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {icon && iconLeft ? <Ionicons name={icon} size={14} color={colors.primary} /> : null}
          <Text style={[s.textLink, st.hovered && { textDecorationLine: "underline" }]}>{title}</Text>
          {icon && !iconLeft ? <Ionicons name={icon} size={14} color={colors.primary} /> : null}
        </View>
      )}
    </Pressable>
  );
}

/** Page title block: optional eyebrow, the title, one line of lead text, actions on the right. */
export function PageHeading({ title, subtitle, eyebrow, icon, right }: { title: string; subtitle?: string | null; eyebrow?: string; icon?: IconName; right?: React.ReactNode }) {
  const wide = useWide(760);
  return (
    <View>
    <View style={[s.heading, !wide && { flexDirection: "column", alignItems: "stretch" }]}>
      <View style={{ flex: 1, minWidth: 0, flexDirection: "row", gap: 14, alignItems: "flex-start" }}>
        {icon ? <TileIcon icon={icon} size={44} /> : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
          <Text style={[s.h1, { marginTop: eyebrow ? 5 : 0 }, !wide && { fontSize: 25, lineHeight: 31 }]} accessibilityRole="header">{title}</Text>
          {subtitle ? <Text style={s.headingSub}>{subtitle}</Text> : null}
        </View>
      </View>
      {right ? <View style={[s.actions, wide && { paddingTop: 9 }]}>{right}</View> : null}
    </View>
      <OfflineBanner />
    </View>
  );
}

/** Title row at the top of a card. */
export function CardHead({ title, subtitle, action, icon }: { title: string; subtitle?: string | null; action?: React.ReactNode; icon?: IconName }) {
  return (
    <View style={s.cardHead}>
      {icon ? <TileIcon icon={icon} /> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.h2}>{title}</Text>
        {subtitle ? <Text style={[font.small, { color: colors.muted, marginTop: 4 }]}>{subtitle}</Text> : null}
      </View>
      {action}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Controls                                                            */
/* ------------------------------------------------------------------ */

export function Button({ title, onPress, variant = "primary", disabled, busy, small, icon, full, accessibilityLabel }: {
  title: string; onPress: () => void; variant?: "primary" | "secondary" | "danger" | "ghost"; disabled?: boolean; busy?: boolean; small?: boolean; icon?: IconName; full?: boolean; accessibilityLabel?: string;
}) {
  const off = disabled || busy;
  const fg = variant === "primary" ? "#FFFFFF" : variant === "danger" ? colors.danger : variant === "ghost" ? colors.primary : colors.ink;
  return (
    <Pressable onPress={onPress} disabled={off} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? title} accessibilityState={{ disabled: !!off, busy: !!busy }} style={full ? { alignSelf: "stretch" } : undefined}>
      {(st: PressState) => (
        <View style={[
          s.btn, small && s.btnSmall,
          variant === "primary" && { backgroundColor: st.hovered ? colors.primaryDark : colors.primary, borderColor: colors.primary },
          variant === "secondary" && { backgroundColor: st.hovered ? "#F4F7F1" : "#FFFFFF", borderColor: st.hovered ? "#BDCDBF" : colors.border },
          variant === "danger" && { backgroundColor: st.hovered ? "#FFF6F4" : "#FFFFFF", borderColor: "#EBC9C5" },
          variant === "ghost" && { backgroundColor: st.hovered ? colors.pale : "transparent", borderColor: "transparent" },
          off && { opacity: 0.5 }, st.pressed && { opacity: 0.85 },
        ]}>
          {busy ? <ActivityIndicator size="small" color={fg} /> : icon ? <Ionicons name={icon} size={small ? 14 : 16} color={fg} /> : null}
          <Text style={{ color: fg, fontWeight: "600", fontSize: small ? 12 : 13 }} numberOfLines={1}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function IconButton({ icon, onPress, label, disabled }: { icon: IconName; onPress: () => void; label: string; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label}>
      {(st: PressState) => (
        <View style={[s.iconBtn, st.hovered && { backgroundColor: "#F4F7F1" }, disabled && { opacity: 0.5 }]}>
          <Ionicons name={icon} size={18} color={colors.ink} />
        </View>
      )}
    </Pressable>
  );
}

export function Input(props: TextInputProps & { label?: string; error?: string | null; hint?: string; required?: boolean; containerStyle?: StyleProp<ViewStyle>; compact?: boolean; icon?: IconName }) {
  const { label, error, hint, required, style, containerStyle, compact, icon, ...rest } = props;
  return (
    <View style={[{ gap: 7 }, containerStyle]}>
      {label ? <Text style={s.fieldLabel}>{label}{required ? <Text style={{ color: colors.danger, fontWeight: "400" }}> *</Text> : null}</Text> : null}
      <View>
        {icon ? <Ionicons name={icon} size={17} color={colors.muted} style={{ position: "absolute", left: 12, top: compact ? 10 : 12, zIndex: 1 }} /> : null}
        <TextInput placeholderTextColor={colors.faint} selectionColor={colors.primary} accessibilityLabel={label} {...rest}
          style={[s.input, compact && s.inputCompact, icon && { paddingLeft: 38 }, rest.multiline && { minHeight: 116, textAlignVertical: "top", lineHeight: 21 }, error && { borderColor: colors.danger }, style]} />
      </View>
      {error ? <Text style={{ color: colors.danger, fontSize: 11 }}>{error}</Text> : hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

/** Status label. `value` is shown with underscores turned into spaces. */
export function Badge({ value, color, tone, icon }: { value: string; color?: string; tone?: Tone; icon?: IconName }) {
  const t = tones[tone ?? (color ? toneForColor(color) : statusTone[value] ?? "neutral")];
  const label = value.replace(/_/g, " ");
  return (
    <View style={[s.badge, { backgroundColor: t.bg }]}>
      {icon ? <Ionicons name={icon} size={11} color={t.fg} /> : null}
      <Text style={{ color: t.fg, fontSize: 10, fontWeight: "600" }}>{label.charAt(0).toUpperCase() + label.slice(1)}</Text>
    </View>
  );
}

function toneForColor(c: string): Tone {
  const k = c.toUpperCase();
  if (k === colors.danger.toUpperCase()) return "red";
  if (k === colors.warning.toUpperCase()) return "amber";
  if (k === colors.accent.toUpperCase()) return "blue";
  if (k === colors.purple.toUpperCase()) return "purple";
  if (k === colors.muted.toUpperCase() || k === colors.faint.toUpperCase()) return "neutral";
  return "green";
}

/** A filter pill. */
export function Chip({ label, selected, onPress, count }: { label: string; selected?: boolean; onPress?: () => void; count?: number }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: !!selected }}>
      {(st: PressState) => (
        <View style={[s.pill, selected && s.pillOn, st.hovered && !selected && { borderColor: "#C6DBC9" }]}>
          <Text style={{ color: selected ? colors.primary : colors.muted, fontSize: 11, fontWeight: selected ? "600" : "400" }}>{label}{count !== undefined ? ` (${count})` : ""}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function Pills<T extends string>({ options, value, onChange }: { options: { value: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>{options.map((o) => <Chip key={o.value} label={o.label} count={o.count} selected={o.value === value} onPress={() => onChange(o.value)} />)}</View>;
}

/** A selectable card with a radio or checkbox mark. */
export function OptionCard({ title, text, selected, onPress, multi, disabled, right, letter }: { title: string; text?: string | null; selected?: boolean; onPress: () => void; multi?: boolean; disabled?: boolean; right?: React.ReactNode; letter?: string }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole={multi ? "checkbox" : "radio"} accessibilityLabel={title || undefined} accessibilityState={{ checked: !!selected, disabled: !!disabled }} aria-checked={!!selected}>
      {(st: PressState) => (
        <View style={[s.option, selected && s.optionOn, st.hovered && !selected && { borderColor: "#BDCDBF" }, disabled && { opacity: 0.55 }]}>
          <View style={[multi ? s.checkbox : s.radio, selected && (multi ? s.checkboxOn : s.radioOn)]}>
            {selected && multi ? <Ionicons name="checkmark" size={12} color="#FFFFFF" /> : null}
          </View>
          {letter ? <View style={{ width: 24, height: 24, borderRadius: 5, borderWidth: 1, borderColor: colors.border, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", marginTop: -3 }}><Text style={{ fontSize: 11, color: colors.muted }}>{letter}</Text></View> : null}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 13, color: colors.ink, fontWeight: selected ? "600" : "400" }}>{title}</Text>
            {text ? <Text style={{ fontSize: 11, color: colors.muted, marginTop: 3 }}>{text}</Text> : null}
          </View>
          {right}
        </View>
      )}
    </Pressable>
  );
}

/** Underlined page tabs. */
export function PageTabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string; icon?: IconName; count?: number | null }[]; value: T; onChange: (k: T) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ flexGrow: 1 }}>
      <View style={s.tabs} accessibilityRole="tablist">
        {tabs.map((tb) => {
          const on = tb.key === value;
          return (
            <Pressable key={tb.key} onPress={() => onChange(tb.key)} accessibilityRole="tab" accessibilityLabel={tb.label} accessibilityState={{ selected: on }} aria-selected={on}>
              {(st: PressState) => (
                <View style={[s.tab, on && s.tabOn]}>
                  <Text style={{ fontSize: 12, color: on || st.hovered ? colors.primary : colors.muted, fontWeight: on ? "600" : "400" }}>{tb.label}</Text>
                  {tb.count != null ? <View style={s.tabCount}><Text style={{ fontSize: 11, color: colors.muted }}>{tb.count}</Text></View> : null}
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

/* ------------------------------------------------------------------ */
/* Feedback                                                            */
/* ------------------------------------------------------------------ */

export function ErrorBanner({ message, onRetry }: { message?: string | null; onRetry?: () => void }) {
  if (!message) return null;
  return <Notice tone="danger" title="Something went wrong" message={message} action={onRetry ? <Button title="Try again" small variant="secondary" icon="refresh" onPress={onRetry} /> : undefined} />;
}

export function Notice({ message, tone = "info", title, action, icon }: { message: string; tone?: "info" | "warning" | "success" | "danger"; title?: string; action?: React.ReactNode; icon?: IconName }) {
  const t = tone === "warning" ? { bg: "#FFFAEC", border: "#EBDFBD", fg: "#866028" } : tone === "success" ? { bg: "#F0F7F1", border: "#DBE9DE", fg: "#336655" } : tone === "danger" ? { bg: "#FFF3F1", border: "#EDD5D0", fg: "#923C35" } : { bg: "#F1F6FC", border: "#DAE5F1", fg: "#3B5E7E" };
  const ic: IconName = icon ?? (tone === "warning" ? "warning-outline" : tone === "success" ? "checkmark-circle-outline" : tone === "danger" ? "alert-circle-outline" : "information-circle-outline");
  return (
    <View style={[s.notice, { backgroundColor: t.bg, borderColor: t.border }]} accessibilityRole={tone === "danger" ? "alert" : undefined}>
      <Ionicons name={ic} size={18} color={t.fg} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, minWidth: 0 }}>
        {title ? <Text style={{ color: t.fg, fontWeight: "600", fontSize: 12, marginBottom: 2 }}>{title}</Text> : null}
        <Text style={{ color: t.fg, fontSize: 12, lineHeight: 19 }}>{message}</Text>
      </View>
      {action ? <View style={{ alignSelf: "center" }}>{action}</View> : null}
    </View>
  );
}

/** Placeholder blocks while a screen loads. */
export function Loading({ lines = 3 }: { lines?: number }) {
  return (
    <View style={{ gap: 12 }} accessibilityLabel="Loading" accessibilityRole="progressbar">
      <View style={[s.skeleton, { height: 130 }]} />
      {Array.from({ length: lines }).map((_, i) => <View key={i} style={[s.skeleton, i === lines - 1 && { width: "40%" }]} />)}
    </View>
  );
}
export function Spinner() { return <View style={{ padding: space.xl, alignItems: "center" }}><ActivityIndicator color={colors.primary} /></View>; }

export function Empty({ text, icon = "file-tray-outline", title, action }: { text: string; icon?: IconName; title?: string; action?: React.ReactNode }) {
  return (
    <View style={s.empty}>
      <TileIcon icon={icon} size={52} />
      {title ? <Text style={[s.h2, { fontSize: 21, textAlign: "center" }]}>{title}</Text> : null}
      <Text style={{ color: colors.muted, textAlign: "center", fontSize: 13, lineHeight: 20, maxWidth: 500 }}>{text}</Text>
      {action ? <View style={{ marginTop: 8 }}>{action}</View> : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Data display                                                        */
/* ------------------------------------------------------------------ */

export function TileIcon({ icon, tone = "green", size = 36 }: { icon: IconName; tone?: Tone; size?: number }) {
  const t = tone === "green" ? { bg: colors.pale, fg: colors.primary } : tones[tone];
  return <View style={{ width: size, height: size, borderRadius: size / 4, backgroundColor: t.bg, alignItems: "center", justifyContent: "center" }}><Ionicons name={icon} size={Math.round(size / 2)} color={t.fg} /></View>;
}

export function Avatar({ name, size = 35, tone = "green" }: { name?: string | null; size?: number; tone?: "green" | "blue" }) {
  const initials = (name ?? "?").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";
  const blue = tone === "blue";
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: blue ? tones.blue.bg : "#E5EBE1", borderWidth: 1, borderColor: blue ? tones.blue.border : "#DCE4D9", alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: blue ? tones.blue.fg : colors.primaryDark, fontWeight: "600", fontSize: Math.round(size * 0.36) }}>{initials}</Text>
    </View>
  );
}

export function Stat({ label, value, icon, helper, positive }: { label: string; value: string | number | null | undefined; icon?: IconName; color?: string; helper?: string | null; positive?: boolean }) {
  return (
    <View style={s.stat}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <Text style={s.statLabel} numberOfLines={1}>{label}</Text>
        {icon ? <Ionicons name={icon} size={17} color="#829B85" /> : null}
      </View>
      <Text style={s.statValue} numberOfLines={1}>{value ?? "—"}</Text>
      {helper ? <Text style={[s.statHelper, positive && { color: "#437753" }]} numberOfLines={2}>{helper}</Text> : null}
    </View>
  );
}

export function StatRow({ children }: { children: React.ReactNode }) {
  return <CardGrid min={200} gap={16} fill>{children}</CardGrid>;
}

export function ProgressBar({ value, height = 6, tone = "green" }: { value: number | null | undefined; height?: number; tone?: "green" | "amber" }) {
  const v = Math.max(0, Math.min(100, Math.round(value ?? 0)));
  return (
    <View style={[s.track, { height, borderRadius: height }]} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: v }}>
      <View style={{ width: `${v}%`, height: "100%", borderRadius: height, backgroundColor: tone === "amber" ? "#C3974A" : "#518965" }} />
    </View>
  );
}

/** A pressable row with an icon tile, two lines of text and something on the right. */
export function ListRow({ title, subtitle, right, onPress, badge, icon, tone, plain }: { title: string; subtitle?: string | null; right?: React.ReactNode; onPress?: () => void; badge?: string; icon?: IconName; tone?: Tone; plain?: boolean }) {
  const inner = (hovered: boolean) => (
    <View style={[plain ? s.listItem : s.listCard, hovered && onPress && { backgroundColor: "#FCFDFB", borderColor: "#C6D6C7" }]}>
      {icon ? <TileIcon icon={icon} tone={tone} /> : null}
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text style={s.listTitle} numberOfLines={2}>{title}</Text>
        {subtitle ? <Text style={s.listSub} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {badge ? <Badge value={badge} /> : null}
      {right}
      {onPress ? <Ionicons name="chevron-forward" size={17} color={colors.muted} /> : null}
    </View>
  );
  if (!onPress) return inner(false);
  return <Pressable onPress={onPress} accessibilityRole="button">{(st: PressState) => <View style={st.pressed ? { opacity: 0.9 } : null}>{inner(!!st.hovered)}</View>}</Pressable>;
}

export type Column<T> = { key: string; label: string; flex?: number; width?: number; align?: "left" | "right" | "center"; render: (row: T) => React.ReactNode };

/** A data table. Rows scroll sideways on narrow screens rather than squashing. */
export function Table<T>({ columns, rows, keyOf, onRowPress, empty, minWidth = 640, footer, noun = "record" }: {
  columns: Column<T>[]; rows: T[]; keyOf: (row: T) => string; onRowPress?: (row: T) => void; empty?: React.ReactNode; minWidth?: number;
  /** false hides the footer; a node replaces it. Default: "Showing N records". */
  footer?: React.ReactNode | false; noun?: string;
}) {
  // A column without a heading holds the row's buttons. As in the design it sits
  // right after the data, left-aligned, instead of being pushed to the far edge.
  const cell = (c: Column<T>): ViewStyle => {
    const action = !c.label;
    // Wider than its buttons, so the buttons start right after the data, as an HTML table would place them.
    return { flex: c.width ? undefined : action ? (c.flex ?? 1.1) * 1.7 : c.flex ?? 1, width: c.width, paddingHorizontal: 18, minWidth: 0,
      alignItems: action ? "flex-start" : c.align === "right" ? "flex-end" : c.align === "center" ? "center" : "flex-start" };
  };
  // Real table semantics for screen readers: table, rows, column headers and cells.
  const body = (
    <View style={{ minWidth, flex: 1 }} role="table">
      <View style={s.thead} role="row">
        {columns.map((c) => <View key={c.key} style={cell(c)} role="columnheader" aria-label={c.label || "Actions"}><Text style={s.th} numberOfLines={1}>{c.label}</Text></View>)}
      </View>
      {rows.length === 0 ? (empty ?? null) : rows.map((row, i) => {
        const content = (hovered: boolean) => (
          <View style={[s.tr, i === rows.length - 1 && { borderBottomWidth: 0 }, hovered && { backgroundColor: "#FCFDFB" }]} role="row">
            {columns.map((c) => <View key={c.key} style={cell(c)} role="cell">{wrapText(c.render(row))}</View>)}
          </View>
        );
        return onRowPress
          // No button role: rows hold their own buttons, and a button inside a button is invalid HTML.
          ? <Pressable key={keyOf(row)} onPress={() => onRowPress(row)} accessibilityRole="none">{(st: PressState) => content(!!st.hovered)}</Pressable>
          : <View key={keyOf(row)}>{content(false)}</View>;
      })}
    </View>
  );
  const foot = footer === false || rows.length === 0 ? null : footer ?? (
    <TableFooter><Text style={{ fontSize: 11, color: colors.muted }}>Showing {rows.length === 1 ? "1" : `all ${rows.length}`} {rows.length === 1 ? noun : noun.endsWith("z") ? `${noun}zes` : noun.endsWith("y") ? `${noun.slice(0, -1)}ies` : `${noun}s`}</Text></TableFooter>
  );
  return (
    <View>
      <ScrollView horizontal contentContainerStyle={{ flexGrow: 1 }} showsHorizontalScrollIndicator={Platform.OS === "web"}>{body}</ScrollView>
      {foot}
    </View>
  );
}

function wrapText(node: React.ReactNode) {
  return typeof node === "string" || typeof node === "number" ? <Text style={s.td}>{node}</Text> : node;
}

/** Primary + secondary text for a table cell. */
export function CellText({ title, sub, strong = true, avatar, icon }: { title: string; sub?: string | null; strong?: boolean; avatar?: string | null; icon?: IconName }) {
  const text = (
    <View style={{ minWidth: 0, flexShrink: 1 }}>
      <Text style={[s.td, strong && { color: colors.ink, fontWeight: "600" }]} numberOfLines={2}>{title}</Text>
      {sub ? <Text style={{ fontSize: 11, color: colors.muted, marginTop: 3 }} numberOfLines={2}>{sub}</Text> : null}
    </View>
  );
  if (!avatar && !icon) return text;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, minWidth: 0 }}>
      {avatar ? <Avatar name={avatar.includes("@") ? avatar.split("@")[0].replace(/[._-]+/g, " ").replace(/(\d+)/g, " $1") : avatar} size={32} /> : <TileIcon icon={icon!} size={32} />}
      {text}
    </View>
  );
}

export function TableFooter({ children }: { children: React.ReactNode }) {
  return <View style={s.tableFooter}>{children}</View>;
}

/** Numbered steps; `active` is the current one, earlier steps show as done. */
export function Stepper({ steps, active }: { steps: string[]; active: number }) {
  const wide = useWide(640);
  return (
    <View style={{ flexDirection: wide ? "row" : "column", gap: 8, marginBottom: 8 }} accessibilityRole="list">
      {steps.map((label, i) => {
        const done = i < active, on = i === active;
        return (
          <View key={label} style={{ flexDirection: "row", alignItems: "center", gap: 9, flex: wide ? 1 : undefined }}>
            <View style={[s.stepNum, done && { backgroundColor: colors.pale, borderColor: "#C9DAC7" }, on && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
              {done ? <Ionicons name="checkmark" size={13} color={colors.primary} /> : <Text style={{ fontSize: 11, color: on ? "#FFFFFF" : colors.muted }}>{i + 1}</Text>}
            </View>
            <Text style={{ fontSize: 11, color: on ? colors.primary : colors.muted, fontWeight: on ? "600" : "400" }}>{label}</Text>
            {wide && i < steps.length - 1 ? <View style={{ flex: 1, height: 1, backgroundColor: colors.border, marginHorizontal: 8 }} /> : null}
          </View>
        );
      })}
    </View>
  );
}

/** Label/value pairs, values right-aligned. */
export function DetailList({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <View style={{ gap: 13 }}>
      {items.map(([label, value]) => (
        <View key={label} style={{ flexDirection: "row", justifyContent: "space-between", gap: 18 }}>
          <Text style={{ fontSize: 12, color: colors.muted }}>{label}</Text>
          {typeof value === "string" || typeof value === "number" ? <Text style={{ fontSize: 12, color: colors.ink, fontWeight: "500", textAlign: "right", flexShrink: 1 }}>{value}</Text> : value}
        </View>
      ))}
    </View>
  );
}

export function ScoreRing({ value, caption }: { value: string; caption?: string }) {
  return (
    <View style={s.scoreRing}>
      <Text style={{ fontSize: 30, letterSpacing: -1, color: colors.ink, fontWeight: "600" }}>{value}</Text>
      {caption ? <Text style={{ color: colors.muted, fontSize: 10 }}>{caption}</Text> : null}
    </View>
  );
}

/** The small stylised book used on the welcome and overview screens. */
export function BookArt({ title = "A little more\nknowledge.\nEvery day." }: { title?: string }) {
  return (
    <View style={{ width: 176, height: 160, alignItems: "center", justifyContent: "center" }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={{ position: "absolute", width: 170, height: 170, borderRadius: 85, borderWidth: 1, borderColor: "#CADAC4" }} />
      <View style={{ position: "absolute", width: 130, height: 130, borderRadius: 65, borderWidth: 1, borderColor: "#CADAC4" }} />
      <View style={s.bookShape}>
        <Text style={{ fontSize: 7, letterSpacing: 1.5, color: "#E4F0E6" }}>LOCALMIND LIBRARY</Text>
        <Text style={{ fontFamily: Platform.OS === "web" ? "Georgia, serif" : undefined, fontSize: 15, lineHeight: 18, color: "#FFFFFF" }}>{title}</Text>
        <Ionicons name="leaf-outline" size={24} color="#E4F0E6" />
      </View>
    </View>
  );
}

export function HeroCard({ eyebrow, title, text, action, art = true }: { eyebrow?: string; title: string; text?: string | null; action?: React.ReactNode; art?: boolean | React.ReactNode }) {
  const wide = useWide(760);
  return (
    <View style={s.hero}>
      <View style={{ flex: 1, minWidth: 0 }}>
        {eyebrow ? <Eyebrow color="#4D7154">{eyebrow}</Eyebrow> : null}
        <Text style={[s.h2, { fontSize: wide ? 26 : 21, lineHeight: wide ? 33 : 27, marginTop: 11, marginBottom: 9, maxWidth: 450, letterSpacing: -0.5 }]}>{title}</Text>
        {text ? <Text style={{ fontSize: 12, color: "#5B705A", maxWidth: 430, lineHeight: 19 }}>{text}</Text> : null}
        {action ? <View style={{ marginTop: 18, flexDirection: "row", gap: 9, flexWrap: "wrap" }}>{action}</View> : null}
      </View>
      {art && wide ? (art === true ? <BookArt /> : art) : null}
    </View>
  );
}

/** Says when a list shows only part of its records (offline, or more than the app loads at once). */
export function IncompleteNote({ rows, noun = "records" }: { rows: unknown; noun?: string }) {
  const info = (rows as { incomplete?: { loaded: number; total: number | null; reason: "offline" | "limit" } } | null)?.incomplete;
  if (!info) return null;
  return (
    <Notice tone="warning" title={`Showing ${info.loaded}${info.total ? ` of ${info.total}` : ""} ${noun}.`}
      message={info.reason === "offline" ? "Only the records saved on this device are shown while you are offline. The rest appear when the LocalMind server can be reached." : "This list is too long to load at once. Use search or filters to narrow it."} />
  );
}

/** In place of a page's content when its request failed: what happened and a way to try again. */
export function RequestFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <Card>
      <Empty icon="refresh" title="Let’s try that again." text="The request could not be completed. Check the connection to the LocalMind server, then try again. Anything already saved is safe."
        action={<Button title="Try again" icon="refresh" onPress={onRetry} />} />
    </Card>
  );
}

/** A simple dropdown select: the current choice with a chevron, opening a short list. */
export function Dropdown<T extends string>({ value, options, onChange, label, placeholder = "Choose…", width, accessibilityLabel }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label?: string; placeholder?: string; width?: number | string; accessibilityLabel?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [box, setBox] = React.useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const ref = React.useRef<View>(null);
  const win = useWindowDimensions();
  const current = options.find((o) => o.value === value);
  // Opens below the field when there is room, otherwise above, and always inside the visible screen
  // (above the keyboard on a phone).
  const show = () => {
    ref.current?.measureInWindow((x, y, w, h) => {
      const keyboard = Keyboard.isVisible?.() ? Keyboard.metrics()?.height ?? 0 : 0;
      const wanted = Math.min(options.length * 38 + 8, 320);
      const below = win.height - keyboard - (y + h) - 12;
      const above = y - 12;
      const up = below < wanted && above > below;
      const maxHeight = Math.max(96, Math.min(wanted, up ? above : below));
      const width = Math.min(Math.max(w, 180), win.width - 16);
      setBox({ left: Math.max(8, Math.min(x, win.width - width - 8)), top: up ? Math.max(8, y - maxHeight - 4) : y + h + 4, width, maxHeight });
      setOpen(true);
    });
  };
  return (
    <View style={[{ gap: 7 }, width !== undefined ? { width: width as number } : null]}>
      {label ? <Text style={s.fieldLabel}>{label}</Text> : null}
      <Pressable ref={ref} onPress={show} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label ?? current?.label ?? placeholder} accessibilityState={{ expanded: open }}>
        {(st: PressState) => (
          <View style={[s.input, s.inputCompact, { flexDirection: "row", alignItems: "center", gap: 8, minWidth: 140 }, st.hovered && { borderColor: "#BDCDBF" }]}>
            <Text style={{ flex: 1, fontSize: 12, color: current ? colors.ink : colors.faint }} numberOfLines={1}>{current?.label ?? placeholder}</Text>
            <Ionicons name="chevron-down" size={14} color={colors.muted} />
          </View>
        )}
      </Pressable>
      <Modal visible={open} transparent animationType="none" onRequestClose={() => setOpen(false)}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} accessibilityLabel="Close list" />
        {box ? (
          <View style={[s.menu, { left: box.left, top: box.top, width: box.width }]}>
            <ScrollView style={{ maxHeight: box.maxHeight - 8 }}>
              {options.map((o) => (
                <Pressable key={o.value || "_"} onPress={() => { onChange(o.value); setOpen(false); }} accessibilityRole="menuitem" accessibilityState={{ selected: o.value === value }}>
                  {(st: PressState) => (
                    <View style={[{ paddingHorizontal: 12, paddingVertical: 9, flexDirection: "row", alignItems: "center", gap: 8 }, (st.hovered || o.value === value) && { backgroundColor: colors.pale }]}>
                      <Text style={{ flex: 1, fontSize: 12, color: colors.ink, fontWeight: o.value === value ? "600" : "400" }}>{o.label}</Text>
                      {o.value === value ? <Ionicons name="checkmark" size={14} color={colors.primary} /> : null}
                    </View>
                  )}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}
      </Modal>
    </View>
  );
}

/** Bottom of a form or card: a short note on the left, the buttons grouped on the right. */
export function FormFooter({ note, children }: { note?: string | null; children: React.ReactNode }) {
  return (
    <View style={s.formFooter}>
      <Text style={{ fontSize: 11, color: colors.muted, flex: 1, minWidth: 160 }}>{note ?? ""}</Text>
      <View style={{ flexDirection: "row", gap: 9, flexWrap: "wrap", alignItems: "center" }}>{children}</View>
    </View>
  );
}

/** Numbered steps with round markers ("A few things to know", "What comes next"). */
export function StepList({ steps }: { steps: [string, string][] }) {
  return (
    <View style={{ gap: 14 }}>
      {steps.map(([title, text], i) => (
        <View key={title} style={{ flexDirection: "row", gap: 12 }}>
          <View style={s.stepCircle}><Text style={{ fontSize: 11, color: colors.primary, fontWeight: "600" }}>{i + 1}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>{title}</Text>
            {text ? <Text style={{ fontSize: 11, color: colors.muted, marginTop: 3, lineHeight: 17 }}>{text}</Text> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

/** Full-width red-edged box at the bottom of a page for destructive actions. */
export function DangerZone({ title, text, children }: { title: string; text: string; children: React.ReactNode }) {
  return (
    <View style={s.danger}>
      <Text style={{ fontSize: 15, fontWeight: "600", color: colors.danger }}>{title}</Text>
      <Text style={{ fontSize: 11, color: colors.muted, marginTop: 6, marginBottom: 14 }}>{text}</Text>
      <View style={{ flexDirection: "row", gap: 9, flexWrap: "wrap" }}>{children}</View>
    </View>
  );
}

/** A filter/search bar placed at the top of a table card: search left, selects right. */
export function TableToolbar({ children, right }: { children?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 22, paddingTop: 22, paddingBottom: 18 }}>
      <View style={{ flex: 1, minWidth: 220, maxWidth: 350 }}>{children}</View>
      {right ? <View style={{ flexDirection: "row", gap: 9, flexWrap: "wrap", alignItems: "center" }}>{right}</View> : null}
    </View>
  );
}

export const fmtSeconds = (sec: number | null | undefined) => { const t = Math.max(0, Math.round(sec ?? 0)); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60); return h ? `${h}h ${m}m` : m ? `${m}m ${t % 60}s` : `${t}s`; };
export const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
export const fmtDay = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—");
export const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${Math.round(v)}%`);

const s = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius, borderWidth: 1, borderColor: colors.border, padding: 23, gap: 12, minWidth: 0, ...shadow },
  cardHover: { borderColor: "#C6D6C7" },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 15, marginBottom: 8 },
  h1: { ...font.h1, color: colors.ink },
  h2: { ...font.h2, color: colors.ink },
  h3: { ...font.h3, color: colors.ink },
  h2Row: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.sm },
  p: { ...font.body, color: colors.text },
  label: { ...font.label, color: colors.ink },
  eyebrow: { ...font.eyebrow, color: colors.muted },
  textLink: { color: colors.primary, fontWeight: "600", fontSize: 12 },
  heading: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 24, marginBottom: 10 },
  headingSub: { fontSize: 13, lineHeight: 20, color: colors.muted, marginTop: 9, maxWidth: 680 },
  actions: { flexDirection: "row", gap: 9, flexWrap: "wrap", alignItems: "center" },
  toolbar: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: space.md },
  toolbarGroup: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.md, flexGrow: 1, flexShrink: 1 },
  toolbarActions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 9 },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderRadius: radiusSm, paddingHorizontal: 15, minHeight: 39 },
  btnSmall: { paddingHorizontal: 11, minHeight: 33 },
  iconBtn: { width: 38, height: 38, borderRadius: radiusSm, borderWidth: 1, borderColor: colors.border, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  fieldLabel: { fontSize: 12, fontWeight: "600", color: colors.ink },
  hint: { fontSize: 11, color: colors.muted },
  input: { borderWidth: 1, borderColor: "#D8E0D7", borderRadius: 7, paddingHorizontal: 12, paddingVertical: 10, minHeight: 41, backgroundColor: "#FFFFFF", color: colors.ink, fontSize: 13 },
  inputCompact: { minHeight: 37, paddingVertical: 7 },
  badge: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 5, paddingHorizontal: 8, paddingVertical: 3, alignSelf: "flex-start" },
  pill: { borderWidth: 1, borderColor: colors.border, backgroundColor: "#FFFFFF", borderRadius: 7, paddingHorizontal: 12, paddingVertical: 7 },
  pillOn: { backgroundColor: colors.pale, borderColor: "#C6DBC9" },
  option: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 15, borderWidth: 1, borderColor: colors.border, borderRadius: 9, backgroundColor: "#FFFFFF" },
  optionOn: { borderColor: "#82A58B", backgroundColor: "#F1F6EF" },
  radio: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: "#9AAA9D", marginTop: 1 },
  radioOn: { borderWidth: 5, borderColor: colors.primary },
  checkbox: { width: 16, height: 16, borderRadius: 4, borderWidth: 1.5, borderColor: "#9AAA9D", marginTop: 1, alignItems: "center", justifyContent: "center" },
  checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: 11, borderRadius: 9, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 14 },
  tabs: { flexDirection: "row", gap: 24, borderBottomWidth: 1, borderBottomColor: colors.border, flexGrow: 1 },
  tab: { flexDirection: "row", alignItems: "center", gap: 7, paddingBottom: 13, paddingHorizontal: 1, borderBottomWidth: 2, borderBottomColor: "transparent", marginBottom: -1 },
  tabOn: { borderBottomColor: colors.primary },
  tabCount: { borderWidth: 1, borderColor: colors.border, borderRadius: 5, paddingHorizontal: 5, backgroundColor: "#FFFFFF" },
  skeleton: { backgroundColor: "#EAF0E6", borderRadius: 7, height: 14 },
  empty: { alignItems: "center", gap: 10, paddingVertical: 48, paddingHorizontal: 22 },
  stat: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 18, flex: 1 },
  statLabel: { fontSize: 12, color: colors.muted, flexShrink: 1 },
  statValue: { fontSize: 29, letterSpacing: -1, color: colors.ink, fontWeight: "600", marginTop: 8, marginBottom: 5, lineHeight: 35 },
  statHelper: { fontSize: 11, color: colors.muted },
  track: { backgroundColor: "#E9EEE8", overflow: "hidden", width: "100%" },
  listCard: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: colors.border, borderRadius: 11 },
  listItem: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.rowLine },
  listTitle: { color: colors.ink, fontSize: 13, fontWeight: "600" },
  listSub: { color: colors.muted, fontSize: 11 },
  thead: { flexDirection: "row", backgroundColor: "#F7F9F5", borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border, paddingVertical: 12 },
  th: { fontSize: 11, fontWeight: "600", letterSpacing: 0.2, color: "#708071" },
  tr: { flexDirection: "row", alignItems: "center", paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.rowLine },
  td: { fontSize: 12, color: colors.text },
  menu: { position: "absolute", backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: colors.border, borderRadius: 9, paddingVertical: 4, ...shadow },
  formFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap", paddingTop: 18, marginTop: 6, borderTopWidth: 1, borderTopColor: colors.border },
  stepCircle: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.pale, alignItems: "center", justifyContent: "center" },
  danger: { borderWidth: 1, borderColor: "#EAD1CD", backgroundColor: "#FFFCFB", borderRadius: 10, padding: 18 },
  tableFooter: { paddingHorizontal: 20, paddingVertical: 13, borderTopWidth: 1, borderTopColor: colors.border, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" },
  stepNum: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  scoreRing: { width: 126, height: 126, borderRadius: 63, borderWidth: 9, borderColor: "#BED8B8", borderTopColor: colors.primary, alignItems: "center", justifyContent: "center" },
  bookShape: { width: 104, height: 138, borderTopLeftRadius: 3, borderBottomLeftRadius: 3, borderTopRightRadius: 9, borderBottomRightRadius: 9, backgroundColor: "#37694C", transform: [{ rotate: "-10deg" }], padding: 14, justifyContent: "space-between" },
  hero: { flexDirection: "row", alignItems: "center", gap: 24, paddingHorizontal: 30, paddingVertical: 28, borderRadius: 14, backgroundColor: "#EAF1E5", borderWidth: 1, borderColor: "#D9E6D5", overflow: "hidden" },
});
