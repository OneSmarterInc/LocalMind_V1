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

/**
 * Where this person belongs, or null when the address they are on is already right.
 * Used by the effect that redirects and by the render below, so a screen the person
 * is not allowed to see never mounts (and never fires its requests) for the one tick
 * before the redirect lands.
 */
function destination(user: ReturnType<typeof useAuth>["user"], mustChangePassword: boolean, first: string | undefined): string | null {
  const onLogin = first === "login";
  const onChange = first === "change-password";
  if (!user) return onLogin ? null : "/login";
  if (mustChangePassword) return onChange ? null : "/change-password";
  // A signed-in person may open Change password from the account menu.
  if (onChange) return null;
  const home = user.role === "student" ? "/student" : user.role === "faculty" ? "/manage" : "/admin";
  const allowed = user.role === "student" ? ["student"] : user.role === "faculty" ? ["manage"] : ["admin", "manage"];
  if (onLogin || !first || !allowed.includes(first)) return home;
  return null;
}

function Gate({ children }: { children: React.ReactNode }) {
  const { ready, user, mustChangePassword } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const target = ready ? destination(user, mustChangePassword, segments[0] as string | undefined) : null;
  useEffect(() => {
    if (!ready || !target) return;
    router.replace(target as any);
  }, [ready, target, router]);
  if (!ready || target) return <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center" }}><Loading /></View>;
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
