import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import React from "react";
import { PortalMeta, shellScreen, useShell } from "@/ui/Shell";

const icon = (name: keyof typeof Ionicons.glyphMap) => {
  const TabIcon = ({ color, size }: { color: string; size: number }) => <Ionicons name={name} color={color} size={size} />;
  TabIcon.displayName = `TabIcon(${name})`;
  return TabIcon;
};

const META: PortalMeta = {
  name: "Administrator workspace",
  navLabel: "MANAGE PLATFORM",
  profilePath: "/admin/profile",
  links: [{ label: "Content workspace", icon: "book-outline", path: "/admin/content" }],
  finder: [
    { title: "Administrator overview", section: "Platform at a glance", path: "/admin" },
    { title: "Student accounts", section: "People", path: "/admin/users" },
    { title: "Faculty accounts", section: "People", path: "/admin/users?tab=faculty" },
    { title: "Create a user account", section: "People", path: "/admin/user/new" },
    { title: "Excel user import", section: "People", path: "/admin/user/import" },
    { title: "Manage subjects", section: "Subjects", path: "/admin/subjects" },
    { title: "Create a subject", section: "Subjects", path: "/admin/subject/new" },
    { title: "AI incident queue", section: "AI monitoring", path: "/admin/monitoring" },
    { title: "AI monitoring policies", section: "AI monitoring", path: "/admin/monitor-policies" },
    { title: "Audit log", section: "Audit log", path: "/admin/audit" },
    { title: "System readiness", section: "System status", path: "/admin/system" },
    { title: "Content workspace", section: "Books, quizzes and assignments", path: "/admin/content" },
    { title: "My profile", section: "Account", path: "/admin/profile" },
    { title: "Change password", section: "Account", path: "/change-password" },
  ],
  help: [
    { title: "Add the people", text: "Create accounts individually or use the existing Excel import workflow.", path: "/admin/users" },
    { title: "Set up the subjects", text: "Assign faculty and enroll students in the right class.", path: "/admin/subjects" },
    { title: "Keep an eye on the platform", text: "Review AI evidence, system readiness, and the audit trail.", path: "/admin/monitoring" },
  ],
};

export default function AdminLayout() {
  const shell = useShell(META);
  return (
    <Tabs screenOptions={shell.screenOptions} tabBar={shell.tabBar}>
      <Tabs.Screen name="index" options={{ title: "Overview", tabBarIcon: icon("home-outline") }} />
      <Tabs.Screen name="users" options={{ title: "People", tabBarIcon: icon("people-outline") }} />
      <Tabs.Screen name="subjects" options={{ title: "Subjects", tabBarIcon: icon("library-outline") }} />
      <Tabs.Screen name="monitoring" options={{ title: "AI monitoring", tabBarIcon: icon("shield-checkmark-outline") }} />
      <Tabs.Screen name="audit" options={{ title: "Audit log", tabBarIcon: icon("receipt-outline") }} />
      <Tabs.Screen name="system" options={{ title: "System status", tabBarIcon: icon("pulse-outline") }} />
      <Tabs.Screen name="profile" options={{ title: "My profile", tabBarIcon: icon("person-circle-outline") }} />
      <Tabs.Screen name="content" options={shellScreen({ href: null, title: "Content workspace" }, {})} />
      <Tabs.Screen name="subject/[id]" options={shellScreen({ href: null, title: "Subject" }, { backTo: "/admin/subjects", backLabel: "Subjects" })} />
      <Tabs.Screen name="subject/new" options={shellScreen({ href: null, title: "Create a subject" }, { backTo: "/admin/subjects", backLabel: "Subjects" })} />
      <Tabs.Screen name="incident/[id]" options={shellScreen({ href: null, title: "Incident" }, { backTo: "/admin/monitoring", backLabel: "AI monitoring" })} />
      <Tabs.Screen name="monitor-policies" options={shellScreen({ href: null, title: "Monitoring policies" }, { backTo: "/admin/monitoring", backLabel: "AI monitoring" })} />
      <Tabs.Screen name="user/[id]" options={shellScreen({ href: null, title: "Account" }, { backTo: "/admin/users", backLabel: "People" })} />
      <Tabs.Screen name="user/new" options={shellScreen({ href: null, title: "Create a user account" }, { backTo: "/admin/users", backLabel: "People" })} />
      <Tabs.Screen name="user/import" options={shellScreen({ href: null, title: "Excel user import" }, { backTo: "/admin/users", backLabel: "People" })} />
    </Tabs>
  );
}
