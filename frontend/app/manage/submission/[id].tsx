import { useLocalSearchParams } from "expo-router";
import React from "react";
import { SubmissionReviewPage } from "@/screens/AssignmentWorkspace";

export default function SubmissionScreen() {
  const { id, assignment } = useLocalSearchParams<{ id: string; assignment: string }>();
  return <SubmissionReviewPage submissionId={id} assignmentId={assignment} />;
}
