import React, { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useAuth } from "@/auth/AuthContext";

/**
 * Shown instead of redirecting when the signed-in account has no workspace this
 * app recognises. Built from plain React Native pieces, like the root error
 * boundary, so it cannot fail for the same reason the account did.
 *
 * "Try again" re-reads the account from the server, which repairs a damaged
 * saved profile without losing anything. Signing out is offered but never
 * automatic: it removes everything downloaded for offline use on this device.
 */
export function AccountProblem() {
  const { refreshUser, logout } = useAuth();
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const retry = async () => {
    if (busy) return; setBusy(true); setNote(null);
    try { await refreshUser(); } catch { setNote("The server could not be reached. Connect to your institution and try again."); } finally { setBusy(false); }
  };
  return (
    <ScrollView style={{ flex: 1, backgroundColor: "#F5F7F4" }} contentContainerStyle={{ padding: 24, gap: 12, maxWidth: 720, alignSelf: "center", width: "100%" }}>
      <Text accessibilityRole="header" style={{ color: "#21382E", fontSize: 22, fontWeight: "600" }}>Your workspace could not be opened</Text>
      <Text style={{ color: "#62746A", fontSize: 15, lineHeight: 22 }}>
        The account saved on this device does not match a LocalMind workspace. Try again while connected to refresh it. Your saved work on this device has not been changed.
      </Text>
      {note ? <Text style={{ color: "#A33936", fontSize: 14 }}>{note}</Text> : null}
      <View style={{ flexDirection: "row", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
        <Pressable accessibilityRole="button" onPress={() => { void retry(); }} style={{ backgroundColor: "#236148", paddingVertical: 10, paddingHorizontal: 18, borderRadius: 8, opacity: busy ? 0.6 : 1 }}>
          <Text style={{ color: "#FFFFFF", fontWeight: "600" }}>{busy ? "Checking…" : "Try again"}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => { void logout(); }} style={{ borderWidth: 1, borderColor: "#B8CBBB", paddingVertical: 10, paddingHorizontal: 18, borderRadius: 8 }}>
          <Text style={{ color: "#21382E", fontWeight: "600" }}>Sign out (removes offline copies on this device)</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
