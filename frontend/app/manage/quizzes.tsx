import { Redirect, useLocalSearchParams } from "expo-router";
import React from "react";
import { QuizListPage } from "@/screens/QuizWorkspace";

export default function Quizzes() {
  const { quiz } = useLocalSearchParams<{ quiz?: string }>();
  // Older links opened a quiz inside the list; send them to the quiz's own page.
  if (quiz) return <Redirect href={{ pathname: "/manage/quiz/[id]", params: { id: quiz } }} />;
  return <QuizListPage />;
}
