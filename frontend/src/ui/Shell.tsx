import { Ionicons } from "@expo/vector-icons";
import type { BottomTabBarProps, BottomTabHeaderProps, BottomTabNavigationOptions } from "@react-navigation/bottom-tabs";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Modal, Platform, Pressable, PressableStateCallbackType, ScrollView, StyleSheet, Text, TextInput, TouchableWithoutFeedback, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/auth/AuthContext";
import { confirmLeave } from "@/hooks/unsavedGuard";
import { useOnline } from "@/offline/connectivity";
import { Avatar, SIDEBAR_WIDTH } from "./index";
import { bp, colors } from "./theme";

export type IconName = keyof typeof Ionicons.glyphMap;
type PressState = PressableStateCallbackType & { hovered?: boolean };

/* ------------------------------------------------------------------ */
/* Drawer state (phones and tablets)                                   */
/* ------------------------------------------------------------------ */

let navOpen = false;
const navListeners = new Set<() => void>();
const emitNav = () => navListeners.forEach((fn) => fn());
export const openNav = () => { navOpen = true; emitNav(); };
export const closeNav = () => { navOpen = false; emitNav(); };
let helpOpen = false;
const helpListeners = new Set<() => void>();
/** Opens "Your first three steps" from anywhere (sidebar card, profile page). */
export const openHelp = () => { helpOpen = true; helpListeners.forEach((fn) => fn()); };
const closeHelp = () => { helpOpen = false; helpListeners.forEach((fn) => fn()); };
function useHelpOpen() {
  const [open, setOpen] = useState(helpOpen);
  useEffect(() => { const l = () => setOpen(helpOpen); helpListeners.add(l); return () => { helpListeners.delete(l); }; }, []);
  return open;
}

export function useNavDrawer() {
  const [open, setOpen] = useState(navOpen);
  useEffect(() => {
    const listener = () => setOpen(navOpen);
    navListeners.add(listener);
    return () => { navListeners.delete(listener); };
  }, []);
  return open;
}

/**
 * Options the shell reads but React Navigation does not declare.
 * `backTo`/`backLabel` put a link to the parent page in the breadcrumb.
 */
export interface ShellExtras { backTo?: string; backLabel?: string; subtitle?: string; section?: string }
/** `section` is the sidebar item a detail page belongs to (from its parent link unless given). */
export const shellScreen = <T,>(options: T, extras: ShellExtras): T =>
  ({ ...options, ...extras, section: extras.section ?? (extras.backTo ? extras.backTo.split("?")[0].split("/").filter(Boolean).slice(1).join("/") || "index" : undefined) }) as T;

export type FinderEntry = { title: string; section: string; path: string };
export type HelpStep = { title: string; text: string; path: string };

export type PortalMeta = {
  /** Shown under the brand and at the start of the breadcrumb, e.g. "Faculty workspace". */
  name: string;
  /** Small uppercase label above the navigation. */
  navLabel: string;
  /** Where "My profile" at the bottom of the sidebar goes. */
  profilePath: string;
  /** Extra links under the main navigation (e.g. admin -> content workspace). */
  links?: { label: string; icon: IconName; path: string }[];
  /** Pages offered by "Find a page". */
  finder: FinderEntry[];
  /** The three steps in "New to LocalMind?". */
  help: HelpStep[];
};

/* ------------------------------------------------------------------ */
/* Brand                                                               */
/* ------------------------------------------------------------------ */

export function Brand({ size = 23 }: { size?: number }) {
  const cell = Math.round(size * 0.62);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }} accessibilityLabel="LocalMind">
      <View style={{ width: cell * 2 + 3, flexDirection: "row", flexWrap: "wrap", gap: 3, transform: [{ rotate: "-6deg" }] }}>
        <View style={[s.markCell, { width: cell, height: cell, backgroundColor: colors.primary }]} />
        <View style={[s.markCell, { width: cell, height: cell, backgroundColor: "#79A289", borderTopRightRadius: 10 }]} />
        <View style={[s.markCell, { width: cell, height: cell, backgroundColor: "#ADC4A8" }]} />
        <View style={[s.markCell, { width: cell, height: cell, backgroundColor: colors.primary }]} />
      </View>
      <Text style={{ fontSize: size, letterSpacing: -0.8, color: colors.ink, fontWeight: "700" }}>Localmind<Text style={{ color: "#8DAB91" }}>.</Text></Text>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Sidebar                                                             */
/* ------------------------------------------------------------------ */

function visibleRoutes({ state, descriptors }: BottomTabBarProps) {
  return state.routes.filter((r) => {
    const o = descriptors[r.key].options as BottomTabNavigationOptions & { href?: string | null };
    if (o.href === null) return false;
    const st = o.tabBarItemStyle as { display?: string } | undefined;
    return st?.display !== "none";
  });
}
const routeTitle = (o: BottomTabNavigationOptions, fallback: string) => (typeof o.tabBarLabel === "string" ? o.tabBarLabel : o.title ?? fallback);

export function ShellTabBar(props: BottomTabBarProps & { meta: PortalMeta }) {
  const { width } = useWindowDimensions();
  const open = useNavDrawer();
  if (width >= bp.desktop) return <Sidebar {...props} />;
  if (!open) return <View style={{ height: 0 }} />;
  return (
    <Modal transparent animationType="fade" visible onRequestClose={closeNav}>
      <TouchableWithoutFeedback onPress={closeNav} accessibilityLabel="Close navigation"><View style={s.scrim} /></TouchableWithoutFeedback>
      <View style={s.drawer}><Sidebar {...props} onNavigate={closeNav} /></View>
    </Modal>
  );
}

function Sidebar({ state, descriptors, navigation, meta, onNavigate }: BottomTabBarProps & { meta: PortalMeta; onNavigate?: () => void }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const routes = visibleRoutes({ state, descriptors, navigation } as BottomTabBarProps);
  const current = state.routes[state.index]?.name;
  // A detail page (a quiz, a book, an account) keeps its section highlighted in the sidebar.
  const section = (descriptors[state.routes[state.index]?.key]?.options as { section?: string } | undefined)?.section;
  const main = routes.filter((r) => r.name !== "profile");
  const go = async (path: string) => { if (!(await confirmLeave())) return; onNavigate?.(); router.push(path as never); };
  return (
    <ScrollView style={s.sidebar} contentContainerStyle={[s.sidebarInner, { paddingTop: insets.top + 24 }]}>
      <Pressable onPress={() => go(meta.finder[0]?.path ?? "/")} accessibilityRole="link" style={{ marginHorizontal: 11, marginBottom: 25 }}><Brand /></Pressable>
      <View style={s.portalLabel}><View style={s.portalDot} /><Text style={{ color: colors.muted, fontSize: 12 }}>{meta.name}</Text></View>
      <Text style={s.navLabel}>{meta.navLabel}</Text>
      <View accessibilityRole="menu">
        {main.map((route) => {
          const o = descriptors[route.key].options;
          const focused = current === route.name || section === route.name;
          const onPress = () => {
            const e = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
            if (e.defaultPrevented) return;
            // Unsaved work asks Save / Discard / Stay before the sidebar leaves the page.
            void confirmLeave().then((ok) => { if (ok) navigation.navigate(route.name, route.params); });
            onNavigate?.();
          };
          return <NavItem key={route.key} label={routeTitle(o, route.name)} icon={o.tabBarIcon} focused={focused} onPress={onPress} />;
        })}
      </View>
      <View style={{ flex: 1, minHeight: 28 }} />
      {meta.links?.map((l) => <NavItem key={l.path} label={l.label} iconName={l.icon} focused={current === l.path.split("/").pop()} onPress={() => go(l.path)} />)}
      <NavItem label="My profile" iconName="person-circle-outline" focused={current === "profile"} onPress={() => go(meta.profilePath)} />
      <View style={s.helpCard}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Ionicons name="sparkles-outline" size={15} color={colors.primary} />
          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>New to LocalMind?</Text>
        </View>
        <Text style={{ fontSize: 12, color: colors.text, marginVertical: 8 }}>Find your way around in three simple steps.</Text>
        <Pressable onPress={() => { onNavigate?.(); openHelp(); }} accessibilityRole="button" accessibilityLabel="Show me how" style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <Text style={{ color: colors.primary, fontSize: 12, fontWeight: "600" }}>Show me how</Text>
          <Ionicons name="arrow-forward" size={13} color={colors.primary} />
        </Pressable>
      </View>
    </ScrollView>
  );
}

function NavItem({ label, icon, iconName, focused, onPress }: { label: string; icon?: BottomTabNavigationOptions["tabBarIcon"]; iconName?: IconName; focused: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="menuitem" accessibilityLabel={label} accessibilityState={{ selected: focused }} aria-selected={focused} aria-current={focused ? "page" : undefined}>
      {(st: PressState) => {
        const c = focused ? colors.primaryDark : st.hovered ? colors.ink : "#66746B";
        return (
          <View style={[s.navItem, st.hovered && !focused && { backgroundColor: "#F3F6F2" }, focused && s.navItemOn]}>
            {icon ? icon({ focused, color: c, size: 20 }) : iconName ? <Ionicons name={iconName} size={20} color={c} /> : null}
            <Text style={{ color: c, fontSize: 13, fontWeight: focused ? "600" : "400" }}>{label}</Text>
          </View>
        );
      }}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/* Dialogs                                                             */
/* ------------------------------------------------------------------ */

function Sheet({ visible, title, onClose, children, width = 520 }: { visible: boolean; title: string; onClose: () => void; children: React.ReactNode; width?: number }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}><View style={s.overlay} /></TouchableWithoutFeedback>
      <View style={[s.sheetWrap, { pointerEvents: "box-none" }]}>
        <View style={[s.sheet, { maxWidth: width }]} accessibilityRole="none" accessibilityViewIsModal>
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 16 }}>
            <Text style={{ flex: 1, fontSize: 18, fontWeight: "600", color: colors.ink }} accessibilityRole="header">{title}</Text>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8}><Ionicons name="close" size={20} color={colors.muted} /></Pressable>
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}

function HelpDialog({ visible, steps, onClose, onGo }: { visible: boolean; steps: HelpStep[]; onClose: () => void; onGo: (path: string) => void }) {
  return (
    <Sheet visible={visible} title="Your first three steps" onClose={onClose}>
      <View style={{ gap: 18 }}>
        {steps.map((st, i) => (
          <View key={st.title} style={{ flexDirection: "row", gap: 14 }}>
            <View style={s.stepNum}><Text style={{ color: colors.primary, fontWeight: "600", fontSize: 12 }}>{i + 1}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: "600", color: colors.ink }}>{st.title}</Text>
              <Text style={{ fontSize: 12, color: colors.muted, marginTop: 4, lineHeight: 19 }}>{st.text}</Text>
              <Pressable onPress={() => onGo(st.path)} accessibilityRole="link" style={{ marginTop: 10 }}>
                <Text style={{ color: colors.primary, fontWeight: "600", fontSize: 12 }}>Take me there →</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </View>
    </Sheet>
  );
}

function FinderDialog({ visible, entries, onClose, onGo }: { visible: boolean; entries: FinderEntry[]; onClose: () => void; onGo: (path: string) => void }) {
  const [q, setQ] = useState("");
  useEffect(() => { if (visible) setQ(""); }, [visible]);
  const list = useMemo(() => entries.filter((e) => `${e.title} ${e.section}`.toLowerCase().includes(q.trim().toLowerCase())), [entries, q]);
  return (
    <Sheet visible={visible} title="Find a page" onClose={onClose}>
      <View>
        <Ionicons name="search" size={17} color={colors.muted} style={{ position: "absolute", left: 12, top: 12, zIndex: 1 }} />
        <TextInput autoFocus value={q} onChangeText={setQ} placeholder="Try books, results, people, or quiz…" placeholderTextColor={colors.faint}
          accessibilityLabel="Search pages" style={s.finderInput} onSubmitEditing={() => list[0] && onGo(list[0].path)} />
      </View>
      <ScrollView style={{ maxHeight: 360, marginTop: 12 }}>
        {list.length === 0 ? <Text style={{ fontSize: 12, color: colors.muted, padding: 20 }}>No page matches that search. Try a simpler word.</Text> : list.map((e) => (
          <Pressable key={e.path + e.title} onPress={() => onGo(e.path)} accessibilityRole="link">
            {(st: PressState) => (
              <View style={[s.finderRow, st.hovered && { backgroundColor: colors.pale }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>{e.title}</Text>
                  <Text style={{ fontSize: 11, color: colors.muted }}>{e.section}</Text>
                </View>
                <Ionicons name="arrow-forward" size={15} color={colors.muted} />
              </View>
            )}
          </Pressable>
        ))}
      </ScrollView>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/* Top bar                                                             */
/* ------------------------------------------------------------------ */

export function ShellHeader({ route, options, meta }: BottomTabHeaderProps & { meta: PortalMeta }) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const online = useOnline();
  const desktop = width >= bp.desktop;
  const narrow = width < bp.tablet;
  const [finder, setFinder] = useState(false);
  const help = useHelpOpen();
  const extras = options as ShellExtras;

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setFinder(true); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = async (path: string) => { setFinder(false); if (!(await confirmLeave())) return; router.push(path as never); };
  return (
    <View style={[s.topbar, { paddingTop: insets.top, height: 76 + insets.top, paddingHorizontal: narrow ? 14 : 28 }]}>
      {!desktop ? (
        <Pressable onPress={openNav} accessibilityRole="button" accessibilityLabel="Open navigation menu" style={s.iconBtn}>
          <Ionicons name="menu" size={19} color={colors.ink} />
        </Pressable>
      ) : null}
      <View style={s.crumb} accessibilityRole="header">
        {/* Two levels, as in the design: the workspace, then the section this page belongs to. */}
        {!narrow ? <Text style={s.crumbText} numberOfLines={1}>{meta.name}</Text> : null}
        {!narrow ? <Ionicons name="chevron-forward" size={12} color={colors.muted} /> : null}
        {extras.backTo && extras.backLabel ? (
          <Pressable onPress={() => { void confirmLeave().then((ok) => { if (ok) router.replace(extras.backTo as never); }); }} accessibilityRole="link" accessibilityLabel={`Back to ${extras.backLabel}`}>
            {(st: PressState) => <Text style={[s.crumbText, { color: colors.ink, fontWeight: "600" }, st.hovered && { textDecorationLine: "underline", color: colors.primary }]} numberOfLines={1}>{narrow ? `‹ ${extras.backLabel}` : extras.backLabel}</Text>}
          </Pressable>
        ) : (
          <Text style={[s.crumbText, { color: colors.ink, fontWeight: "600" }]} numberOfLines={1}>{options.title ?? route.name}</Text>
        )}
      </View>
      <View style={{ flex: 1 }} />
      <Pressable onPress={() => setFinder(true)} accessibilityRole="button" accessibilityLabel="Find a page">
        {(st: PressState) => narrow ? (
          <View style={s.iconBtn}><Ionicons name="search" size={17} color={colors.ink} /></View>
        ) : (
          <View style={[s.search, st.hovered && { borderColor: "#BDCDBF" }]}>
            <Ionicons name="search" size={16} color={colors.muted} />
            <Text style={{ color: colors.muted, fontSize: 12, flex: 1 }}>Find a page…</Text>
            {Platform.OS === "web" ? <Text style={s.kbd}>Ctrl K</Text> : null}
          </View>
        )}
      </Pressable>
      {!narrow ? (
        <View style={s.status} accessibilityLiveRegion="polite">
          <View style={[s.statusDot, !online && { backgroundColor: colors.warning }]} />
          <Text style={{ fontSize: 11, color: colors.muted }}>{online ? "Connected" : "Offline"}</Text>
        </View>
      ) : null}
      <UserMenu compact={narrow} profilePath={meta.profilePath} />
      <FinderDialog visible={finder} entries={meta.finder} onClose={() => setFinder(false)} onGo={go} />
      <HelpDialog visible={help} steps={meta.help} onClose={closeHelp} onGo={(p) => { closeHelp(); void confirmLeave().then((ok) => { if (ok) router.push(p as never); }); }} />
    </View>
  );
}

export function UserMenu({ compact, profilePath }: { compact?: boolean; profilePath: string }) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  if (!user) return null;

  const go = async (path: string) => { setOpen(false); if (!(await confirmLeave())) return; router.push(path as never); };
  return (
    <>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel="Open account menu" style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
        <Avatar name={user.full_name} />
        {!compact ? <Text style={{ fontSize: 12, color: colors.ink, maxWidth: 160 }} numberOfLines={1}>{user.full_name}</Text> : null}
        {!compact ? <Ionicons name="chevron-down" size={14} color={colors.muted} /> : null}
      </Pressable>
      <Sheet visible={open} title="Your account" onClose={() => setOpen(false)} width={420}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <Avatar name={user.full_name} size={44} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 14, fontWeight: "600", color: colors.ink }} numberOfLines={1}>{user.full_name}</Text>
            <Text style={{ fontSize: 12, color: colors.muted }} numberOfLines={1}>{user.email} · {user.role.charAt(0).toUpperCase() + user.role.slice(1)}</Text>
          </View>
        </View>
        <View style={{ gap: 8 }}>
          <MenuLink icon="person-outline" label="My profile" onPress={() => go(profilePath)} />
          <MenuLink icon="key-outline" label="Change password" onPress={() => go("/change-password")} />
          <MenuLink icon="log-out-outline" label="Sign out" danger onPress={() => { setOpen(false); void confirmLeave("signOut").then((ok) => { if (ok) void logout(); }); }} />
        </View>
      </Sheet>
    </>
  );
}

function MenuLink({ icon, label, onPress, danger }: { icon: IconName; label: string; onPress: () => void; danger?: boolean }) {
  const c = danger ? colors.danger : colors.ink;
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      {(st: PressState) => (
        <View style={[s.menuLink, st.hovered && { backgroundColor: danger ? "#FFF6F4" : "#F4F7F1" }]}>
          <Ionicons name={icon} size={17} color={c} />
          <Text style={{ color: c, fontSize: 13, fontWeight: "600", flex: 1 }}>{label}</Text>
          {!danger ? <Ionicons name="chevron-forward" size={14} color={colors.muted} /> : null}
        </View>
      )}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/* Hook used by the three portal layouts                               */
/* ------------------------------------------------------------------ */

export function useShell(meta: PortalMeta) {
  const { width } = useWindowDimensions();
  const desktop = width >= bp.desktop;
  const screenOptions: BottomTabNavigationOptions = {
    header: (p: BottomTabHeaderProps) => <ShellHeader {...p} meta={meta} />,
    tabBarPosition: desktop ? "left" : "bottom",
    sceneStyle: { backgroundColor: colors.bg },
    tabBarActiveTintColor: colors.primary,
    tabBarInactiveTintColor: colors.muted,
    tabBarHideOnKeyboard: Platform.OS === "android",
  };
  const tabBar = (p: BottomTabBarProps) => <ShellTabBar {...p} meta={meta} />;
  return { screenOptions, tabBar };
}

const s = StyleSheet.create({
  markCell: { borderRadius: 3 },
  sidebar: { width: SIDEBAR_WIDTH, backgroundColor: colors.sidebar, borderRightWidth: 1, borderRightColor: colors.border, flexGrow: 0 },
  sidebarInner: { paddingHorizontal: 13, paddingBottom: 20, flexGrow: 1 },
  portalLabel: { marginHorizontal: 11, marginBottom: 26, flexDirection: "row", alignItems: "center", gap: 8 },
  portalDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary },
  navLabel: { fontSize: 10, color: "#79867E", letterSpacing: 1.5, fontWeight: "600", paddingHorizontal: 12, marginBottom: 9 },
  navItem: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 43, paddingHorizontal: 12, paddingVertical: 10, marginVertical: 2, borderRadius: 9 },
  navItemOn: { backgroundColor: colors.pale },
  helpCard: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 14, backgroundColor: "#F8FAF7", marginTop: 16 },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(22,40,30,0.35)" },
  drawer: { position: "absolute", left: 0, top: 0, bottom: 0, width: SIDEBAR_WIDTH + 20, backgroundColor: colors.sidebar },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(22,40,30,0.35)" },
  sheetWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 16 },
  sheet: { width: "100%", backgroundColor: "#FFFFFF", borderRadius: 14, padding: 24, borderWidth: 1, borderColor: colors.border },
  stepNum: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.pale, alignItems: "center", justifyContent: "center" },
  finderInput: { borderWidth: 1, borderColor: "#D8E0D7", borderRadius: 7, paddingLeft: 38, paddingRight: 12, paddingVertical: 10, fontSize: 13, color: colors.ink },
  finderRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 11, borderRadius: 8 },
  topbar: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: "#FFFFFFED", borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 38, height: 38, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  crumb: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1, minWidth: 0 },
  crumbText: { fontSize: 12, color: colors.text, flexShrink: 1 },
  search: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: "#F8FAF7", borderRadius: 8, minHeight: 37, paddingHorizontal: 12, width: 270 },
  kbd: { fontSize: 10, color: "#859087", backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: colors.border, paddingHorizontal: 4, borderRadius: 3 },
  status: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#41835A" },
  menuLink: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 9, borderWidth: 1, borderColor: colors.border },
});
