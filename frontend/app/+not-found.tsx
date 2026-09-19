import React from "react";
import { Redirect, usePathname } from "expo-router";
import { useAuth } from "@/auth/AuthContext";
import { Screen, Notice } from "@/ui";
export default function NotFound() {
  const path = usePathname();
  const { ready, user, mustChangePassword } = useAuth();
  const legacy = /^\/(student|manage)\/(assignments|assignment|submission)(\/|$)/.test(path);
  if (legacy && ready) {
    if (!user) return <Redirect href="/login" />;
    if (mustChangePassword) return <Redirect href="/change-password" />;
    return <Redirect href={user.role === "student" ? "/student/quizzes" : "/manage/quizzes"} />;
  }
  return <Screen><Notice title="Page not found" message="This page is unavailable. Use your workspace navigation to continue." /></Screen>;
}
