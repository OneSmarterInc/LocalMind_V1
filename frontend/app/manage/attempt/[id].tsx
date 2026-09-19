import { useLocalSearchParams } from "expo-router";
import React from "react";
import { Screen, Notice } from "@/ui";
import { AttemptReviewPage } from "@/screens/QuizWorkspace";

export default function AttemptScreen() {
  const { id, quiz } = useLocalSearchParams<{ id: string; quiz: string }>();
  if (!quiz) return <Screen><Notice title="Incomplete attempt link" message="Open this attempt from its quiz results to include the required quiz information." /></Screen>;
  return <AttemptReviewPage attemptId={id} quizId={quiz} />;
}
