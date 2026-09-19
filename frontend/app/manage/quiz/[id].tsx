import { useLocalSearchParams } from "expo-router";
import React from "react";
import { QuizDetailPage } from "@/screens/QuizWorkspace";

export default function QuizScreen() {
  const { id, note } = useLocalSearchParams<{ id: string; tab?: string; note?: string }>();
  return <QuizDetailPage id={id} note={note} />;
}
