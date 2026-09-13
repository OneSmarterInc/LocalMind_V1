import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import React from "react";
import { useAuth } from "@/auth/AuthContext";
import { PortalMeta, shellScreen, useShell } from "@/ui/Shell";

const icon = (name: keyof typeof Ionicons.glyphMap) => {
  const TabIcon = ({ color, size }: { color: string; size: number }) => <Ionicons name={name} color={color} size={size} />;
  TabIcon.displayName = `TabIcon(${name})`;
  return TabIcon;
};

const finder = [
  { title: "Books for private study", section: "Upload and share books", path: "/manage/private-library" },
  { title: "Overview", section: "Teaching at a glance", path: "/manage" },
  { title: "Teaching subjects", section: "Subjects, students and modules", path: "/manage/subjects" },
  { title: "Books & modules", section: "Uploads, outlines and publishing", path: "/manage/books" },
  { title: "Upload a book", section: "Books & modules", path: "/manage/document/upload" },
  { title: "Manage quizzes", section: "Questions, attempts and results", path: "/manage/quizzes" },
  { title: "Create quiz", section: "Quizzes", path: "/manage/quiz/new" },
  { title: "Manage assignments", section: "Tasks, submissions and results", path: "/manage/assignments" },
  { title: "Create assignment", section: "Assignments", path: "/manage/assignment/new" },
  { title: "Change password", section: "Account", path: "/change-password" },
];

export default function ManageLayout() {
  const { user } = useAuth();
  const admin = user?.role === "admin";
  const meta: PortalMeta = {
    name: admin ? "Content workspace" : "Faculty workspace",
    navLabel: "TEACHING",
    profilePath: admin ? "/admin/profile" : "/manage/profile",
    links: admin ? [{ label: "Administrator workspace", icon: "shield-half-outline", path: "/admin" }] : undefined,
    finder: admin ? [...finder, { title: "Administrator overview", section: "Administrator workspace", path: "/admin" }] : [...finder, { title: "My profile", section: "Account", path: "/manage/profile" }],
    help: [
      { title: "Choose your subject", text: "All the books, students, and modules for a class live together.", path: "/manage/subjects" },
      { title: "Prepare the content", text: "Upload a book, review its source and outline, then publish.", path: "/manage/books" },
      { title: "Check and release results", text: "Review student work. Evaluation and release are separate decisions.", path: "/manage/quizzes" },
    ],
  };
  const shell = useShell(meta);
  return (
    <Tabs screenOptions={shell.screenOptions} tabBar={shell.tabBar}>
      <Tabs.Screen name="index" options={{ title: "Overview", tabBarIcon: icon("home-outline") }} />
      <Tabs.Screen name="subjects" options={{ title: "Subjects", tabBarIcon: icon("library-outline") }} />
      <Tabs.Screen name="private-library" options={{ title: "Private study books", tabBarIcon: icon("library-outline") }} />
      <Tabs.Screen name="books" options={{ title: "Books & modules", tabBarIcon: icon("book-outline") }} />
      <Tabs.Screen name="quizzes" options={{ title: "Quizzes", tabBarIcon: icon("help-circle-outline") }} />
      <Tabs.Screen name="assignments" options={{ title: "Assignments", tabBarIcon: icon("create-outline") }} />
      <Tabs.Screen name="profile" options={{ href: admin ? null : undefined, title: "My profile", tabBarIcon: icon("person-circle-outline") }} />
      <Tabs.Screen name="subject/[id]" options={shellScreen({ href: null, title: "Subject" }, { backTo: "/manage/subjects", backLabel: "Subjects" })} />
      <Tabs.Screen name="student/[id]" options={shellScreen({ href: null, title: "Student progress" }, { backTo: "/manage/subjects", backLabel: "Subjects" })} />
      <Tabs.Screen name="document/[id]" options={shellScreen({ href: null, title: "Book" }, { backTo: "/manage/books", backLabel: "Books & modules" })} />
      <Tabs.Screen name="study/[id]" options={shellScreen({ href: null, title: "Books for private study" }, { backTo: "/manage/books", backLabel: "Books & modules" })} />
      <Tabs.Screen name="document/upload" options={shellScreen({ href: null, title: "Upload a book" }, { backTo: "/manage/books", backLabel: "Books & modules" })} />
      <Tabs.Screen name="quiz/[id]" options={shellScreen({ href: null, title: "Quiz" }, { backTo: "/manage/quizzes", backLabel: "Quizzes" })} />
      <Tabs.Screen name="attempt/[id]" options={shellScreen({ href: null, title: "Attempt" }, { backTo: "/manage/quizzes", backLabel: "Quizzes" })} />
      <Tabs.Screen name="submission/[id]" options={shellScreen({ href: null, title: "Submission" }, { backTo: "/manage/assignments", backLabel: "Assignments" })} />
      <Tabs.Screen name="quiz/new" options={shellScreen({ href: null, title: "Create quiz" }, { backTo: "/manage/quizzes", backLabel: "Quizzes" })} />
      <Tabs.Screen name="assignment/[id]" options={shellScreen({ href: null, title: "Assignment" }, { backTo: "/manage/assignments", backLabel: "Assignments" })} />
      <Tabs.Screen name="assignment/new" options={shellScreen({ href: null, title: "Create assignment" }, { backTo: "/manage/assignments", backLabel: "Assignments" })} />
    </Tabs>
  );
}
