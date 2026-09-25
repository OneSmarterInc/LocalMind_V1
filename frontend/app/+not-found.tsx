import React from "react";
import { Redirect, usePathname } from "expo-router";
import { View } from "react-native";
import { useAuth } from "@/auth/AuthContext";
import { Loading, colors } from "@/ui";
import { homeFor } from "@/auth/home";
import { AccountProblem } from "@/auth/AccountProblem";

/** Anything typed into the address bar that is not a route.
 *
 * A dead end is never the useful answer here: the person is already signed in
 * and has somewhere to be. Send them to their own workspace overview, the same
 * destination the root route uses, so a mistyped or stale link behaves like
 * opening the app. Signed out, that destination is the sign-in page.
 */
export default function NotFound() {
  const path = usePathname();
  const { ready, user, mustChangePassword } = useAuth();
  if (!ready) return <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center" }}><Loading /></View>;
  if (!user) return <Redirect href="/login" />;
  if (mustChangePassword) return <Redirect href="/change-password" />;
  const home = homeFor(user.role);
  if (!home) return <AccountProblem />;
  // Links from before assignments became quizzes have a better destination
  // than the overview, so they keep it.
  if (/^\/(student|manage)\/(assignments|assignment|submission)(\/|$)/.test(path)) {
    return <Redirect href={user.role === "student" ? "/student/quizzes" : "/manage/quizzes"} />;
  }
  return <Redirect href={home} />;
}
