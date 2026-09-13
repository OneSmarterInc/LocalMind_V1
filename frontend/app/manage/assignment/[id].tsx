import { useLocalSearchParams } from "expo-router";
import React from "react";
import { AssignmentDetailPage, type Tab } from "@/screens/AssignmentWorkspace";

export default function AssignmentScreen() {
  const { id, tab } = useLocalSearchParams<{ id: string; tab?: Tab }>();
  return <AssignmentDetailPage id={id} initialTab={tab} />;
}
