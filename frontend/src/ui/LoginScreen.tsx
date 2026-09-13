import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { Role } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { useAction } from "@/hooks/useAsync";
import { useOnline } from "@/offline/connectivity";
import { Button, ErrorBanner, Input, Notice, TextLink, colors } from "./index";
import { AuthLayout } from "./AuthLayout";

const LABEL: Record<Role, string> = { student: "Student", faculty: "Faculty", admin: "Administrator" };

export function LoginScreen({ role }: { role: Role }) {
  const { login } = useAuth();
  const router = useRouter();
  const online = useOnline();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const action = useAction(async () => { await login(role, email.trim().toLowerCase(), password); });
  const submit = () => { if (email.trim() && password) void action.run(); };
  return (
    <AuthLayout>
      <View style={{ flexDirection: "row" }}><TextLink title="Choose a different role" icon="arrow-back" iconLeft onPress={() => router.replace("/login")} /></View>
      <Text style={{ fontSize: 28, fontWeight: "600", letterSpacing: -0.7, color: colors.ink }} accessibilityRole="header">Welcome back.</Text>
      <Text style={{ fontSize: 13, color: colors.muted }}>Sign in to your {LABEL[role].toLowerCase()} workspace.</Text>
      <View style={{ backgroundColor: colors.pale, borderRadius: 5, paddingHorizontal: 8, paddingVertical: 5, marginBottom: 6 }}>
        <Text style={{ fontSize: 10, fontWeight: "600", color: colors.primary }}>{LABEL[role]} portal</Text>
      </View>
      {!online ? <Notice tone="warning" message="The LocalMind server cannot be reached. Signing in needs a connection." /> : null}
      <Input label="Email address" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="username" placeholder="you@example.edu" onSubmitEditing={submit} />
      <View>
        <Input label="Password" value={password} onChangeText={setPassword} secureTextEntry={!show} textContentType="password" autoComplete="password" onSubmitEditing={submit} />
        <Pressable onPress={() => setShow((v) => !v)} accessibilityRole="button" accessibilityLabel={show ? "Hide password" : "Show password"} hitSlop={8} style={{ position: "absolute", right: 10, top: 31 }}>
          <Ionicons name={show ? "eye-off-outline" : "eye-outline"} size={18} color={colors.muted} />
        </Pressable>
      </View>
      <ErrorBanner message={action.error} />
      <View style={{ flexDirection: "row" }}>
        <Button title={`Sign in to the ${LABEL[role].toLowerCase()} portal`} icon="arrow-forward" onPress={submit} busy={action.busy} disabled={!email.trim() || !password} />
      </View>
      <Notice title="First time here?" message="Use the initial password from your administrator. You will choose a new one right after signing in." />
      <Text style={{ marginTop: 12, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.border, fontSize: 11, color: colors.muted, textAlign: "center" }}>
        Need an account or a password reset? Contact your administrator.
      </Text>
    </AuthLayout>
  );
}
