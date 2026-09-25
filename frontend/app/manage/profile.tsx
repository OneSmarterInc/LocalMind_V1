import React from "react";
import { Redirect } from "expo-router";
import { useAuth } from "@/auth/AuthContext";
import { ProfileScreen } from "@/ui/ProfileScreen";

/** Administrators keep their profile in the administrator workspace, where the
 * sidebar links to it; this tab is hidden for them in the content workspace. */
export default function ManageProfile() {
  const { user } = useAuth();
  if (user?.role === "admin") return <Redirect href="/admin/profile" />;
  return <ProfileScreen />;
}
