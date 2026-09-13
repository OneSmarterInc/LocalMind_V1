import { Redirect, useLocalSearchParams } from "expo-router";
import React from "react";
import { AssignmentListPage } from "@/screens/AssignmentWorkspace";

export default function Assignments() {
  const { assignment } = useLocalSearchParams<{ assignment?: string }>();
  if (assignment) return <Redirect href={{ pathname: "/manage/assignment/[id]", params: { id: assignment } }} />;
  return <AssignmentListPage />;
}
