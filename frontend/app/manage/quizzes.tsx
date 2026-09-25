import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback } from "react";
import { Loading, Screen } from "@/ui";
import { QuizListPage } from "@/screens/QuizWorkspace";

export default function Quizzes() {
  const { quiz } = useLocalSearchParams<{ quiz?: string }>();
  // Older links opened a quiz inside the list; send them to the quiz's own page.
  // This is a retained tab screen: it stays mounted after handing off, so the
  // redirect must only run while it is the focused screen. Rendering <Redirect>
  // instead pulled the person off whatever page they had moved on to.
  const router = useRouter();
  useFocusEffect(useCallback(() => {
    if (quiz) router.replace({ pathname: "/manage/quiz/[id]", params: { id: quiz } });
  }, [quiz, router]));
  if (quiz) return <Screen><Loading /></Screen>;
  return <QuizListPage />;
}
