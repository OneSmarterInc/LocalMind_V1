import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { createContext, useContext } from "react";
import { Pressable, Text, View } from "react-native";
import { colors, tones } from "@/ui/theme";
import { useOnline } from "./connectivity";
import { useSyncState } from "./sync";

/** True inside the student portal, where page headings show the offline notice. */
export const OfflineNoticeContext = createContext(false);

function when(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

/** The offline notice shown under a student page's title (as in the design), or the first download. */
export function OfflineBanner() {
  const enabled = useContext(OfflineNoticeContext);
  const online = useOnline();
  const sync = useSyncState();
  const router = useRouter();
  if (!enabled) return null;
  const synced = when(sync.lastSync);
  if (online && !(sync.running && !sync.lastSync)) return null;
  const t = online ? tones.green : tones.amber;
  return (
    <View accessibilityRole={online ? undefined : "alert"} style={{ flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 16, paddingVertical: 14, borderRadius: 9, backgroundColor: online ? "#F0F7F1" : "#FFFAEC", borderWidth: 1, borderColor: t.border, marginTop: 4 }}>
      <Ionicons name={online ? "cloud-download-outline" : "cloud-offline-outline"} size={18} color={t.fg} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.fg, fontSize: 12, fontWeight: "600" }}>{online ? "Saving your reading for offline use…" : sync.lastSync ? "You are offline. Your saved reading is available." : "You are offline. Nothing has been saved on this device yet."}</Text>
        <Text style={{ color: t.fg, fontSize: 12, marginTop: 2 }}>{online ? "Your open modules and lessons are being saved on this device." : synced ? `Last saved: ${synced}. New tutor questions and submissions require a server connection.` : "Reading offline needs one successful download while connected. Reconnect to the LocalMind server to continue."}</Text>
      </View>
      {!online ? (
        <Pressable onPress={() => router.push("/student/offline")} accessibilityRole="button" style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: "#FFFFFF", borderRadius: 8, paddingHorizontal: 11, paddingVertical: 7 }}>
          <Text style={{ color: colors.ink, fontSize: 12, fontWeight: "600" }}>What works offline</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
