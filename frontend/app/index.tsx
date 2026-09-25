import React from "react";
import { Redirect } from "expo-router";
import { View } from "react-native";
import { useAuth } from "@/auth/AuthContext";
import { Loading, colors } from "@/ui";
import { homeFor } from "@/auth/home";
import { AccountProblem } from "@/auth/AccountProblem";

// This route lives inside the mounted root navigator, so redirects are safe.
export default function Index() {
  const { ready, user, mustChangePassword } = useAuth();
  if (!ready) return <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center" }}><Loading /></View>;
  if (!user) return <Redirect href="/login" />;
  if (mustChangePassword) return <Redirect href="/change-password" />;
  const home = homeFor(user.role);
  return home ? <Redirect href={home} /> : <AccountProblem />;
}
