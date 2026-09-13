import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import React from "react";
import { OfflineNoticeContext } from "@/offline/OfflineBanner";
import { PortalMeta, shellScreen, useShell } from "@/ui/Shell";

const icon = (name: keyof typeof Ionicons.glyphMap) => {
  const TabIcon = ({ color, size }: { color: string; size: number }) => <Ionicons name={name} color={color} size={size} />;
  TabIcon.displayName = `TabIcon(${name})`;
  return TabIcon;
};

const STUDENT_META: PortalMeta = {
  name: "Student workspace",
  navLabel: "MY LEARNING",
  profilePath: "/student/profile",
  finder: [
    { title: "Overview", section: "Your next steps", path: "/student" },
    { title: "My subjects", section: "Books and modules", path: "/student/subjects" },
    { title: "My quizzes", section: "Quizzes and results", path: "/student/quizzes" },
    { title: "My assignments", section: "Assignments and feedback", path: "/student/assignments" },
    { title: "My progress", section: "Scores and learning time", path: "/student/progress" },
    { title: "Offline reading library", section: "Saved on this device", path: "/student/offline" },
    { title: "My profile", section: "Account", path: "/student/profile" },
    { title: "Change password", section: "Account", path: "/change-password" },
  ],
  help: [
    { title: "Choose your subject", text: "Open a subject, then a book, to find your available modules.", path: "/student/subjects" },
    { title: "Learn one module at a time", text: "Read the source, explore the lesson, and ask a doubt.", path: "/student/subjects" },
    { title: "Check your understanding", text: "Take a quiz and review feedback when results are released.", path: "/student/quizzes" },
  ],
};

export default function StudentLayout() {
  const shell = useShell(STUDENT_META);
  return (
    <OfflineNoticeContext.Provider value>
      <Tabs screenOptions={shell.screenOptions} tabBar={shell.tabBar}>
        <Tabs.Screen name="index" options={{ title: "Overview", tabBarIcon: icon("home-outline") }} />
        <Tabs.Screen name="subjects" options={{ title: "My subjects", tabBarIcon: icon("library-outline") }} />
        <Tabs.Screen name="quizzes" options={{ title: "Quizzes", tabBarIcon: icon("help-circle-outline") }} />
        <Tabs.Screen name="assignments" options={{ title: "Assignments", tabBarIcon: icon("create-outline") }} />
        <Tabs.Screen name="progress" options={{ title: "My progress", tabBarIcon: icon("stats-chart-outline") }} />
        <Tabs.Screen name="profile" options={{ title: "My profile", tabBarIcon: icon("person-circle-outline") }} />
        <Tabs.Screen name="offline" options={shellScreen({ href: null, title: "Offline reading library" }, { backTo: "/student", backLabel: "Overview" })} />
        <Tabs.Screen name="subject/[id]" options={shellScreen({ href: null, title: "Subject" }, { backTo: "/student/subjects", backLabel: "My subjects" })} />
        <Tabs.Screen name="document/[id]" options={shellScreen({ href: null, title: "Book" }, { backTo: "/student/subjects", backLabel: "My subjects" })} />
        <Tabs.Screen name="module/[id]" options={shellScreen({ href: null, title: "Module" }, { backTo: "/student/subjects", backLabel: "My subjects" })} />
        <Tabs.Screen name="quiz/[id]" options={shellScreen({ href: null, title: "Quiz" }, { backTo: "/student/quizzes", backLabel: "Quizzes" })} />
        <Tabs.Screen name="attempt/[id]" options={shellScreen({ href: null, title: "Quiz result" }, { backTo: "/student/quizzes", backLabel: "Quizzes" })} />
        <Tabs.Screen name="assignment/[id]" options={shellScreen({ href: null, title: "Assignment" }, { backTo: "/student/assignments", backLabel: "Assignments" })} />
      </Tabs>
    </OfflineNoticeContext.Provider>
  );
}
