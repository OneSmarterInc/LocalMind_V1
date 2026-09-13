import { useRouter } from "expo-router";
import React from "react";
import { Text, View } from "react-native";
import { useAuth } from "@/auth/AuthContext";
import { confirmLeave } from "@/hooks/unsavedGuard";
import { Avatar, Badge, Button, Card, CardHead, DetailList, Grid, ListRow, Notice, PageHeading, Screen, colors } from "@/ui";
import { openHelp } from "./Shell";

const pretty = (k: string) => k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

export function ProfileScreen() {
  const { user, logout } = useAuth();
  const router = useRouter();
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
          <CardHead title="Account details" />
          <DetailList items={[
            ["Full name", user.full_name], ["Email", user.email], ["Role", role],
            ["Account status", <Badge key="st" value={user.status} tone={user.status === "active" ? "green" : "red"} />],
            ...extra.map(([k, v]) => [pretty(k), String(v)] as [string, string]),
          ]} />
          <Text style={{ fontSize: 11, color: colors.muted, marginTop: 8 }}>Profile changes are managed by your administrator.</Text>
        </Card>
        <Card>
          <CardHead title="Security & help" />
          <ListRow plain icon="key-outline" title="Change password" subtitle="Update your sign-in password." onPress={() => router.push("/change-password")} />
          <ListRow plain icon="compass-outline" title="Getting started" subtitle="Understand the main areas of your workspace." right={<Button title="Open guide" small variant="secondary" onPress={openHelp} />} />
          <View style={{ flexDirection: "row", marginTop: 8 }}><Button title="Sign out" small variant="secondary" icon="log-out-outline" onPress={() => { void confirmLeave("signOut").then((ok) => { if (ok) void logout(); }); }} /></View>
        </Card>
      </Grid>
      {user.role === "student" ? <Notice title="Using a shared device?" message="Signing out removes downloaded offline reading and your saved profile from this device." /> : null}
    </Screen>
  );
}
