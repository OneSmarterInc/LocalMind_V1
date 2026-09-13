import { useLocalSearchParams } from "expo-router";
import React from "react";
import { QuizDetailPage, type Tab } from "@/screens/QuizWorkspace";

export default function QuizScreen() {
  const { id, tab, note } = useLocalSearchParams<{ id: string; tab?: Tab; note?: string }>();
  return <QuizDetailPage id={id} initialTab={tab} note={note} />;
}
