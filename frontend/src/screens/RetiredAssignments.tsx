import React, { useCallback } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { Loading, Screen } from "@/ui";

// Redirect only while focused: retained tab screens must never steal navigation.
export function RetiredAssignments({ role }: { role: "student" | "manage" }) {
  const router = useRouter();
  useFocusEffect(useCallback(() => {
    router.replace(role === "student" ? "/student/quizzes" : "/manage/quizzes");
  }, [role, router]));
  return <Screen><Loading /></Screen>;
}
