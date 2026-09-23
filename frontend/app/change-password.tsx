import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useAuth } from "@/auth/AuthContext";
import { useAction } from "@/hooks/useAsync";
import { Button, Card, CardHead, ErrorBanner, Eyebrow, FormFooter, Input, TextLink, colors, useToast } from "@/ui";
import { AuthLayout } from "@/ui/AuthLayout";

export default function ChangePassword() {
  const { completePasswordChange, logout, mustChangePassword, user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [visible, setVisible] = useState({ current: false, next: false, confirm: false });
  const eye = (field: keyof typeof visible, label: string) => (
    <Pressable accessibilityRole="button" accessibilityLabel={`${visible[field] ? "Hide" : "Show"} ${label}`}
      onPress={() => setVisible(previous => ({ ...previous, [field]: !previous[field] }))}
      style={{ width: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}>
      <Ionicons name={visible[field] ? "eye-off-outline" : "eye-outline"} size={20} color={colors.muted} />
    </Pressable>
  );
  const mismatch = !!confirm && next !== confirm;
  const home = user?.role === "student" ? "/student" : user?.role === "faculty" ? "/manage" : "/admin";
  const action = useAction(async () => {
    if (next !== confirm) throw new Error("The two new passwords do not match.");
    await completePasswordChange(current, next);
    setVisible({ current: false, next: false, confirm: false });
    setCurrent(""); setNext(""); setConfirm("");
    // A voluntary change used to leave the person sitting on the form with a
    // success notice they had to dismiss by navigating themselves. Both cases
    // now end where the person works, with the confirmation carried as a toast.
    toast.show({ tone: "success", title: "Password updated", message: "Use your new password the next time you sign in." });
    router.replace(home as never);
  });
  return (
    <AuthLayout>
      {!mustChangePassword ? <View style={{ flexDirection: "row" }}><TextLink title="Back to my workspace" icon="arrow-back" iconLeft onPress={() => router.replace(home as never)} /></View> : null}
      <Eyebrow>ACCOUNT SECURITY</Eyebrow>
      <Text style={{ fontSize: 28, fontWeight: "600", letterSpacing: -0.7, color: colors.ink }} accessibilityRole="header">Choose a new password</Text>
      <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 8 }}>{mustChangePassword ? "Keep your account secure. Your first sign-in requires a password change." : "Keep your account secure with a password only you know."}</Text>
      <Card>
        <CardHead title="Secure your account" />
        <Input label="Current password" required value={current} onChangeText={setCurrent} secureTextEntry={!visible.current} endAdornment={eye("current", "current password")} autoCapitalize="none" autoCorrect={false} textContentType="password" hint={mustChangePassword ? "Use the initial password from your administrator." : "The password you signed in with."} />
        <Input label="New password" required value={next} onChangeText={setNext} secureTextEntry={!visible.next} endAdornment={eye("next", "new password")} autoCapitalize="none" autoCorrect={false} textContentType="newPassword" hint="At least ten characters, not entirely numbers, not too similar to your email, and different from the current one." />
        <Input label="Confirm new password" required value={confirm} onChangeText={setConfirm} secureTextEntry={!visible.confirm} endAdornment={eye("confirm", "confirm new password")} autoCapitalize="none" autoCorrect={false} textContentType="newPassword" error={mismatch ? "The two new passwords do not match." : null} onSubmitEditing={() => action.run()} />
        <ErrorBanner message={action.error} />
        <FormFooter note={mustChangePassword ? "You can use LocalMind once this is done." : "You stay signed in on this device."}>
          {mustChangePassword ? <Button title="Sign out instead" variant="secondary" onPress={() => logout()} /> : null}
          <Button title="Update password" icon="checkmark" onPress={() => action.run()} busy={action.busy} disabled={!current || !next || !confirm || mismatch} />
        </FormFooter>
      </Card>
    </AuthLayout>
  );
}
