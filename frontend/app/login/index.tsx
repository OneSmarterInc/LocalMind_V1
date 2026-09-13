import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { Pressable, PressableStateCallbackType, Text, View } from "react-native";
import { BASE_URL } from "@/api/client";
import { clearSessionExpired, useSessionExpired } from "@/auth/sessionNotice";
import { Button, Eyebrow, Notice, TileIcon, colors } from "@/ui";
import { AuthLayout } from "@/ui/AuthLayout";

type PressState = PressableStateCallbackType & { hovered?: boolean };
const PORTALS = [
  { href: "/login/student", title: "I’m a student", text: "Read, learn, take quizzes, and see your progress.", icon: "school-outline" },
  { href: "/login/faculty", title: "I’m faculty", text: "Organize books, create quizzes, and guide students.", icon: "book-outline" },
  { href: "/login/admin", title: "I’m an administrator", text: "Manage people, subjects, and platform health.", icon: "shield-half-outline" },
] as const;

export default function ChoosePortal() {
  const router = useRouter();
  const expired = useSessionExpired();
  if (expired) {
    return (
      <AuthLayout>
        <TileIcon icon="lock-closed-outline" tone="amber" size={40} />
        <Text style={{ fontSize: 28, fontWeight: "600", letterSpacing: -0.7, color: colors.ink }} accessibilityRole="header">Please sign in again.</Text>
        <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 8 }}>Your session has ended. Sign in to continue using your workspace.</Text>
        <Notice title="Your account is still there." message="Signing in again does not change your saved work on the server. Reading saved on this device stays available until you sign out." />
        <Button title="Go to sign in" icon="arrow-forward" full onPress={clearSessionExpired} />
      </AuthLayout>
    );
  }
  return (
    <AuthLayout>
      <Eyebrow>WELCOME TO LOCALMIND</Eyebrow>
      <Text style={{ fontSize: 28, fontWeight: "600", letterSpacing: -0.7, color: colors.ink }} accessibilityRole="header">Let’s get you to the right place.</Text>
      <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 12 }}>Choose your role to continue.</Text>
      {PORTALS.map((p) => (
        <Pressable key={p.href} onPress={() => router.push(p.href)} accessibilityRole="link" accessibilityLabel={p.title}>
          {(st: PressState) => (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 17, padding: 21, borderWidth: 1, borderColor: st.hovered ? "#A4C0A3" : colors.border, borderRadius: 12, backgroundColor: "#FFFFFF", transform: [{ translateX: st.hovered ? 3 : 0 }] }}>
              <TileIcon icon={p.icon} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: "600", color: colors.ink }}>{p.title}</Text>
                <Text style={{ fontSize: 12, color: colors.muted, marginTop: 3 }}>{p.text}</Text>
              </View>
              <Ionicons name="arrow-forward" size={17} color={colors.muted} />
            </View>
          )}
        </Pressable>
      ))}
      <Text style={{ marginTop: 12, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.border, fontSize: 11, color: colors.muted, textAlign: "center" }}>Connected to {BASE_URL.replace(/^https?:\/\//, "")}</Text>
    </AuthLayout>
  );
}
