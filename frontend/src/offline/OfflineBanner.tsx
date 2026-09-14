import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { createContext, useContext } from "react";
import { Pressable, Text, View } from "react-native";
import { confirmLeave } from "@/hooks/unsavedGuard";
import { colors, tones } from "@/ui/theme";
import { useOnline } from "./connectivity";
import { useSyncState } from "./sync";

/** Student page headings show connection status, not a claim that local AI needs a server. */
export const OfflineNoticeContext = createContext(false);

function when(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  return new Date().toDateString() === d.toDateString()
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

export function OfflineBanner() {
  const enabled = useContext(OfflineNoticeContext);
  const online = useOnline();
  const sync = useSyncState();
  const router = useRouter();
  if (!enabled || (online && !(sync.running && !sync.lastSync))) return null;
  const t = online ? tones.green : tones.amber;
  const saved = when(sync.lastSync);
  return (
    <View accessibilityRole={online ? undefined : "alert"} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 11, paddingHorizontal: 16, paddingVertical: 14, borderRadius: 9, backgroundColor: online ? "#F0F7F1" : "#FFFAEC", borderWidth: 1, borderColor: t.border, marginTop: 4 }}>
      <Ionicons name={online ? "cloud-download-outline" : "cloud-offline-outline"} size={18} color={t.fg} />
      <View style={{ flex: 1, minWidth: 180 }}>
        <Text style={{ color: t.fg, fontSize: 12, fontWeight: "600" }}>{online ? "Synchronizing your course work…" : "Offline · Continue with material saved on this device"}</Text>
        <Text style={{ color: t.fg, fontSize: 12, marginTop: 2, lineHeight: 18 }}>{online
          ? "Your course work, open modules, lessons and published MCQ quizzes are being synchronized. Private Library is stored separately on this device."
          : `${saved ? `Course copy: ${saved}. ` : "No complete course download yet. "}Private study and new doubts work with saved source, the installed model and offline app files. Downloaded MCQ quizzes work offline; course work is saved here until synchronization.`}</Text>
      </View>
      {!online ? <Pressable onPress={() => { void confirmLeave().then(ok => { if (ok) router.push("/student/offline"); }); }} accessibilityRole="button" style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: "#FFFFFF", borderRadius: 8, paddingHorizontal: 11, paddingVertical: 7 }}>
        <Text style={{ color: colors.ink, fontSize: 12, fontWeight: "600" }}>What works offline</Text>
      </Pressable> : null}
    </View>
  );
}
