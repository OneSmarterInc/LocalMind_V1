import { useRouter } from "expo-router";
import React from "react";
import { Text } from "react-native";
import { Button, Card, Grid, Notice, PageHeading, Screen, colors } from "@/ui";

const AREAS = [
  { title: "Books & modules", text: "Review outlines, manage source text, and publish books.", action: "Open books & modules", icon: "book-outline", path: "/manage/books" },
  { title: "Quizzes", text: "Review questions, manage attempts, and release scores.", action: "Open quizzes", icon: "help-circle-outline", path: "/manage/quizzes" },
  { title: "Assignments", text: "Create tasks and review students’ submissions.", action: "Open assignments", icon: "create-outline", path: "/manage/assignments" },
] as const;

export default function AdminContent() {
  const router = useRouter();
  return (
    <Screen>
      <PageHeading eyebrow="CONTENT WORKSPACE" title="Teaching content, with administrator access." subtitle="The same content workspace faculty uses, without switching your account."
        right={<Button title="Back to administration" variant="secondary" icon="arrow-back" onPress={() => router.push("/admin")} />} />
      <Notice title="Your administrator role stays active." message="Administrators can use the content workspace for every subject. Actions are recorded in the audit trail under your account." />
      <Grid min={260} gap={20}>
        {AREAS.map((a) => (
          <Card key={a.title}>
            <Text style={{ fontSize: 17, fontWeight: "600", color: colors.ink }}>{a.title}</Text>
            <Text style={{ fontSize: 12, color: colors.muted, lineHeight: 19 }}>{a.text}</Text>
            <Button title={a.action} icon={a.icon} full onPress={() => router.push(a.path)} />
          </Card>
        ))}
      </Grid>
    </Screen>
  );
}
