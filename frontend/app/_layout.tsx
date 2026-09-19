import {GenerationHost} from '@/private/GenerationJobs';
import ParserHost from "@/private/ParserHost";
import { Stack, type ErrorBoundaryProps } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React from "react";
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

/** Resolve the saved session before evaluating deep-link permissions. Once
 * ready, keep the navigator mounted through redirects and account changes. */
export function AppNavigator() {
  const { ready, user, mustChangePassword } = useAuth();
  if (!ready) return <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center" }}><Loading /></View>;
  const signedIn = !!user;
  const workspace = signedIn && !mustChangePassword;
  return (
    <>
      {workspace ? <GenerationHost /> : null}
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerStyle: { backgroundColor: colors.bg }, headerShadowVisible: false, headerTintColor: colors.text, headerTitleStyle: { fontWeight: "800" }, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Protected guard={ready && !user}>
          <Stack.Screen name="login/index" options={{ headerShown: false }} />
          <Stack.Screen name="login/student" options={{ headerShown: false }} />
          <Stack.Screen name="login/faculty" options={{ headerShown: false }} />
          <Stack.Screen name="login/admin" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="change-password" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={workspace && user?.role === "student"}>
          <Stack.Screen name="student" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={workspace && (user?.role === "faculty" || user?.role === "admin")}>
          <Stack.Screen name="manage" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={workspace && user?.role === "admin"}>
          <Stack.Screen name="admin" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
      <DialogHost />
      {workspace ? <ParserHost /> : null}
      <NativeDatePickerHost />
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <AppNavigator />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
