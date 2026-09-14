import {GenerationHost} from '@/private/GenerationJobs';
import ParserHost from "@/private/ParserHost";
import { Stack, useRouter, useSegments, type ErrorBoundaryProps } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useEffect } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "@/auth/AuthContext";
import { DialogHost, Loading, colors } from "@/ui";
import { NativeDatePickerHost } from "@/ui/NativeDatePicker";

/**
 * Shown instead of a blank white page when a screen throws while rendering.
 * Without this, any render error unmounted the whole app on the web. Built
 * from plain React Native pieces only, so it cannot fail for the same reason
 * the screen did, and it shows the error text so a report can say what broke.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: "#F5F7F4" }} contentContainerStyle={{ padding: 24, gap: 12, maxWidth: 720, alignSelf: "center", width: "100%" }}>
      <Text style={{ color: "#21382E", fontSize: 22, fontWeight: "600" }}>This screen ran into a problem</Text>
      <Text style={{ color: "#62746A", fontSize: 15, lineHeight: 22 }}>
        Nothing was lost. Try again, or go back and open the page once more. If it keeps happening, send the message below to your administrator.
      </Text>
      <Text selectable style={{ color: "#A33936", fontSize: 13, fontFamily: "monospace" }}>{error?.message || String(error)}</Text>
      <View style={{ flexDirection: "row", gap: 12, marginTop: 8 }}>
        <Pressable onPress={retry} style={{ backgroundColor: "#236148", paddingVertical: 10, paddingHorizontal: 18, borderRadius: 8 }}>
          <Text style={{ color: "#FFFFFF", fontWeight: "600" }}>Try Again</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

// Web only: keep the app's own files so it can open without the server
// (https or localhost; browsers do not allow this on plain-http LAN addresses).
if (Platform.OS === "web" && typeof window !== "undefined" && window.isSecureContext && "serviceWorker" in navigator && !__DEV__) {
  window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => {}); });
}

function Gate({ children }: { children: React.ReactNode }) {
  const { ready, user, mustChangePassword } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  useEffect(() => {
    if (!ready) return;
    const first = segments[0] as string | undefined;
    const onLogin = first === "login";
    const onChange = first === "change-password";
    if (!user) { if (!onLogin) router.replace("/login"); return; }
    if (mustChangePassword) { if (!onChange) router.replace("/change-password"); return; }
    const home = user.role === "student" ? "/student" : user.role === "faculty" ? "/manage" : "/admin";
    const allowed = user.role === "student" ? ["student"] : user.role === "faculty" ? ["manage"] : ["admin", "manage"];
    // A signed-in person may open Change password from the account menu.
    if (onChange) return;
    if (onLogin || !first || !allowed.includes(first)) router.replace(home as any);
  }, [ready, user, mustChangePassword, segments, router]);
  if (!ready) return <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center" }}><Loading /></View>;
  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <Gate>
          <GenerationHost />
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerStyle: { backgroundColor: colors.bg }, headerShadowVisible: false, headerTintColor: colors.text, headerTitleStyle: { fontWeight: "800" }, contentStyle: { backgroundColor: colors.bg } }}>
            <Stack.Screen name="login/index" options={{ headerShown: false }} />
            <Stack.Screen name="login/student" options={{ headerShown: false }} />
            <Stack.Screen name="login/faculty" options={{ headerShown: false }} />
            <Stack.Screen name="login/admin" options={{ headerShown: false }} />
            <Stack.Screen name="change-password" options={{ headerShown: false }} />
            <Stack.Screen name="student" options={{ headerShown: false }} />
            <Stack.Screen name="manage" options={{ headerShown: false }} />
            <Stack.Screen name="admin" options={{ headerShown: false }} />
          </Stack>
          {/* One dialog host for the whole app: every confirmation and warning
              renders here, centred, instead of in a browser popup. */}
          <DialogHost />
          <ParserHost />
          <NativeDatePickerHost />
        </Gate>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
