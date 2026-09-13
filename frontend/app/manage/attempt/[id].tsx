import { useLocalSearchParams } from "expo-router";
import React from "react";
import { AttemptReviewPage } from "@/screens/QuizWorkspace";

export default function AttemptScreen() {
  const { id, quiz } = useLocalSearchParams<{ id: string; quiz: string }>();
  return <AttemptReviewPage attemptId={id} quizId={quiz} />;
}
