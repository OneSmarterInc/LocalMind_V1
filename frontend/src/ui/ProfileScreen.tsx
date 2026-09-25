import { useRouter } from "expo-router";
import React, { useState } from "react";
import { Text, View } from "react-native";
import { auth as authApi } from "@/api/endpoints";
import { useAuth } from "@/auth/AuthContext";
import { useAction } from "@/hooks/useAsync";
import { confirmSignOut } from "@/hooks/unsavedGuard";
import { Avatar, Badge, Button, Card, CardHead, DetailList, ErrorBanner, FormFooter, Grid, Input, ListRow, Notice, PageHeading, Screen, colors, phoneProblem, useToast } from "@/ui";
import { openHelp } from "./Shell";

const pretty = (k: string) => k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** What each role may change about itself. The server refuses anything else, so
 *  this list only decides which fields are offered; it is not the check. Keep it
 *  in step with SELF_EDITABLE in backend/accounts/services/own_profile.py. */
const SELF_EDITABLE: Record<string, { key: string; label: string; placeholder: string }[]> = {
  faculty: [{ key: "phone", label: "Phone number", placeholder: "For example, +91 98765 43210" }],
  student: [{ key: "phone", label: "Phone number", placeholder: "For example, +91 98765 43210" }],
  admin: [],
};

export function ProfileScreen() {
  const { user, logout, refreshUser } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const editable = SELF_EDITABLE[user?.role ?? ""] ?? [];

  const open = () => {
    if (!user) return;
    setFullName(user.full_name);
    const profile = (user.profile ?? {}) as Record<string, unknown>;
    setFields(Object.fromEntries(editable.map((f) => [f.key, String(profile[f.key] ?? "")])));
    setEditing(true);
  };
  const save = useAction(async () => {
    await authApi.updateMe({ full_name: fullName, ...(editable.length ? { profile: fields } : {}) });
    // The saved copy on this device is what the person sees while offline, so
    // reread the account rather than patching the cached user in place.
    await refreshUser();
    setEditing(false);
    toast.show({ tone: "success", title: "Profile updated", message: "Your changes are saved." });
  });

  if (!user) return null;
  const role = user.role === "admin" ? "Administrator" : user.role.charAt(0).toUpperCase() + user.role.slice(1);
  const extra = Object.entries(user.profile ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== "");
  return (
    <Screen>
      <PageHeading eyebrow="ACCOUNT" title="My profile" subtitle="Your account information and sign-in security." />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 16, padding: 24, borderRadius: 14, backgroundColor: "#EAF1E5", borderWidth: 1, borderColor: "#D9E6D5" }}>
        <Avatar name={user.full_name} size={64} />
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <Text style={{ fontSize: 18, fontWeight: "600", color: colors.ink }}>{user.full_name}</Text>
          <Text style={{ fontSize: 12, color: colors.muted }}>{user.email}</Text>
          <View style={{ flexDirection: "row", gap: 6, marginTop: 4 }}><Badge value={role} tone="green" /></View>
        </View>
      </View>
      <Grid min={320} gap={20}>
        <Card>
          <CardHead title="Account details" action={editing ? undefined : <Button title="Edit profile" small variant="secondary" icon="create-outline" onPress={open} />} />
          {editing ? (
            <View style={{ gap: 14 }}>
              <ErrorBanner message={save.error} />
              <Input label="Full name" required placeholder="First and last name" value={fullName} onChangeText={setFullName} />
              {editable.map((f) => (
                <Input key={f.key} label={f.label} placeholder={f.placeholder} value={fields[f.key] ?? ""}
                       error={f.key === "phone" ? phoneProblem(fields[f.key]) : null}
                       onChangeText={(v) => setFields((z) => ({ ...z, [f.key]: v }))} />
              ))}
              <FormFooter note="Your email address, role and the details your institution issues are managed by your administrator.">
                <Button title="Cancel" variant="secondary" onPress={() => setEditing(false)} disabled={save.busy} />
                <Button title="Save changes" icon="checkmark" onPress={() => save.run()} busy={save.busy} disabled={!fullName.trim() || !!phoneProblem(fields.phone)} />
              </FormFooter>
            </View>
          ) : (
            <>
              <DetailList items={[
                ["Full name", user.full_name], ["Email", user.email], ["Role", role],
                ["Account status", <Badge key="st" value={user.status} tone={user.status === "active" ? "green" : "red"} />],
                ...extra.map(([k, v]) => [pretty(k), String(v)] as [string, string]),
              ]} />
              <Text style={{ fontSize: 11, color: colors.muted, marginTop: 8 }}>
                {editable.length
                  ? "You can change your name and phone number here. Everything your institution issues is managed by your administrator."
                  : "You can change your name here. Everything else is managed by your administrator."}
              </Text>
            </>
          )}
        </Card>
        <Card>
          <CardHead title="Security & help" />
          <ListRow plain icon="key-outline" title="Change password" subtitle="Update your sign-in password." onPress={() => router.push("/change-password")} />
          <ListRow plain icon="compass-outline" title="Getting started" subtitle="Understand the main areas of your workspace." right={<Button title="Open guide" small variant="secondary" onPress={openHelp} />} />
          <View style={{ flexDirection: "row", marginTop: 8 }}><Button title="Sign out" small variant="secondary" icon="log-out-outline" onPress={() => { void confirmSignOut().then((ok) => { if (ok) void logout(); }); }} /></View>
        </Card>
      </Grid>
      {user.role === "student" ? <Notice title="Using a shared device?" message="Signing out removes downloaded offline reading and your saved profile from this device." /> : null}
    </Screen>
  );
}
