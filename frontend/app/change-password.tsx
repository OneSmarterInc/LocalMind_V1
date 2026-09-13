import { useRouter } from "expo-router";
import React, { useState } from "react";
import { Text, View } from "react-native";
import { useAuth } from "@/auth/AuthContext";
import { useAction } from "@/hooks/useAsync";
import { Button, Card, CardHead, ErrorBanner, Eyebrow, FormFooter, Input, Notice, TextLink, colors } from "@/ui";
import { AuthLayout } from "@/ui/AuthLayout";

export default function ChangePassword() {
  const { completePasswordChange, logout, mustChangePassword, user } = useAuth();
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const mismatch = !!confirm && next !== confirm;
  const home = user?.role === "student" ? "/student" : user?.role === "faculty" ? "/manage" : "/admin";
  const action = useAction(async () => {
    if (next !== confirm) throw new Error("The two new passwords do not match.");
    const forced = mustChangePassword;
    await completePasswordChange(current, next);
    setDone(true); setCurrent(""); setNext(""); setConfirm("");
    if (forced) router.replace(home as never);
  });
  return (
    <AuthLayout>
      {!mustChangePassword ? <View style={{ flexDirection: "row" }}><TextLink title="Back to my workspace" icon="arrow-back" iconLeft onPress={() => router.replace(home as never)} /></View> : null}
      <Eyebrow>ACCOUNT SECURITY</Eyebrow>
      <Text style={{ fontSize: 28, fontWeight: "600", letterSpacing: -0.7, color: colors.ink }} accessibilityRole="header">Choose a new password</Text>
      <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 8 }}>{mustChangePassword ? "Keep your account secure. Your first sign-in requires a password change." : "Keep your account secure with a password only you know."}</Text>
      {done && !mustChangePassword ? <Notice tone="success" title="Password updated" message="Use your new password the next time you sign in." /> : null}
      <Card>
        <CardHead title="Secure your account" />
        <Input label="Current password" required value={current} onChangeText={setCurrent} secureTextEntry textContentType="password" hint={mustChangePassword ? "Use the initial password from your administrator." : "The password you signed in with."} />
        <Input label="New password" required value={next} onChangeText={setNext} secureTextEntry textContentType="newPassword" hint="At least eight characters, not entirely numbers, not too similar to your email, and different from the current one." />
        <Input label="Confirm new password" required value={confirm} onChangeText={setConfirm} secureTextEntry textContentType="newPassword" error={mismatch ? "The two new passwords do not match." : null} onSubmitEditing={() => action.run()} />
        <ErrorBanner message={action.error} />
        <FormFooter note={mustChangePassword ? "You can use LocalMind once this is done." : "You stay signed in on this device."}>
          {mustChangePassword ? <Button title="Sign out instead" variant="secondary" onPress={() => logout()} /> : null}
          <Button title="Update password" icon="checkmark" onPress={() => action.run()} busy={action.busy} disabled={!current || !next || !confirm || mismatch} />
        </FormFooter>
      </Card>
    </AuthLayout>
  );
}
