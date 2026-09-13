import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { admin } from "@/api/endpoints";
import type { User } from "@/api/types";
import { useAction, useAsync } from "@/hooks/useAsync";
import { Avatar, Badge, Button, Card, CardHead, DangerZone, ErrorBanner, Grid, Input, ListRow, Loading, Notice, PageHeading, Screen, Split, colors, confirmAsync, confirmDeleteAsync } from "@/ui";
import { IssuedCredential, OneTimeCredentials } from "@/ui/OneTimeCredentials";

const STUDENT_FIELDS: [string, string][] = [["roll_number", "Roll number"], ["program", "Program"], ["batch", "Batch"], ["phone", "Phone number"]];
const FACULTY_FIELDS: [string, string][] = [["employee_id", "Employee ID"], ["department", "Department"], ["designation", "Designation"], ["phone", "Phone number"]];
type Detail = User & { enrollments?: any[]; subjects?: any[] };

export default function ManageAccount() {
  const { id, kind: k } = useLocalSearchParams<{ id: string; kind?: string }>();
  const router = useRouter();
  const navigation = useNavigation();
  const kind = k === "faculty" ? "faculty" : "students";
  const faculty = kind === "faculty";
  const q = useAsync(() => admin.user(kind, id) as Promise<Detail>, [kind, id]);
  const [f, setF] = useState<Record<string, string>>({});
  const [issued, setIssued] = useState<IssuedCredential | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (q.data) setF({ full_name: q.data.full_name, ...((q.data.profile ?? {}) as Record<string, string>) }); }, [q.data]);
  useEffect(() => { navigation.setOptions({ backTo: `/admin/users?kind=${kind}`, backLabel: "People", title: faculty ? "Faculty account" : "Student account" }); }, [navigation, kind, faculty]);
  const u = q.data;
  const dirty = !!u && (f.full_name !== u.full_name || (faculty ? FACULTY_FIELDS : STUDENT_FIELDS).some(([key]) => (f[key] ?? "") !== String((u.profile as Record<string, string> | undefined)?.[key] ?? "")));
  const save = useAction(async () => {
    const { full_name, ...rest } = f;
    const keys = (faculty ? FACULTY_FIELDS : STUDENT_FIELDS).map(([key]) => key);
    await admin.updateUser(kind, id, { full_name: full_name?.trim(), profile: Object.fromEntries(keys.map((key) => [key, rest[key] ?? ""])) });
    await q.reload(); setSaved(true);
  });
  const reset = useAction(async () => {
    if (!u || !(await confirmAsync("Reset the onboarding password?", `${u.full_name} will sign in with the initial password and must change it at the next sign-in. Their sessions are signed out.`, "Reset password", "Cancel", { tone: "warning" }))) return;
    const r = await admin.resetPassword(kind, id);
    if (r.initial_password) setIssued({ full_name: u.full_name, email: u.email, initial_password: r.initial_password });
    await q.reload();
  });
  const status = useAction(async () => {
    if (!u) return;
    if (u.status === "active") {
      if (!(await confirmAsync("Discontinue this account?", "This blocks sign-in without deleting learning records. You can reactivate it later.", "Discontinue account", "Cancel", { tone: "warning" }))) return;
      await admin.userAction(kind, id, "discontinue");
    } else {
      await admin.userAction(kind, id, "reactivate");
    }
    await q.reload();
  });
  const remove = useAction(async () => {
    if (!u) return;
    const ok = await confirmDeleteAsync(`Delete this ${faculty ? "faculty account" : "student account"}?`, "This permanently removes the account and everything tied to it: enrolments or subject assignments, quiz attempts, assignment submissions and learning progress. Use Discontinue when you only want to stop access.", { detail: `${u.full_name} · ${u.email}`, okLabel: "Delete account" });
    if (!ok) return;
    await admin.deleteUser(kind, id, "");
    router.replace({ pathname: "/admin/users", params: { kind, notice: `${u.full_name} was deleted.` } });
  });
  const links = faculty ? (u?.subjects ?? []).filter((s: any) => s.status !== "removed") : (u?.enrollments ?? []);
  return (
    <Screen refreshing={q.loading} onRefresh={q.reload}>
      <ErrorBanner message={q.error} onRetry={q.reload} />
      {q.loading && !u ? <Loading /> : null}
      {u ? (
        <>
          <PageHeading eyebrow={faculty ? "PEOPLE · FACULTY" : "PEOPLE · STUDENT"} title={u.full_name} subtitle={u.email} right={<Button title="Back to people" variant="secondary" icon="arrow-back" onPress={() => router.push({ pathname: "/admin/users", params: { kind } })} />} />
          {issued ? <OneTimeCredentials title="New one-time password" rows={[issued]} onDone={() => setIssued(null)} /> : null}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 16, padding: 24, borderRadius: 14, backgroundColor: "#EAF1E5", borderWidth: 1, borderColor: "#D9E6D5" }}>
            <Avatar name={u.full_name} size={64} tone={faculty ? "blue" : "green"} />
            <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
              <Text style={{ fontSize: 18, fontWeight: "600", color: colors.ink }}>{u.full_name}</Text>
              <Text style={{ fontSize: 12, color: colors.muted }}>{u.email}</Text>
              <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                <Badge value={faculty ? "Faculty" : "Student"} tone="neutral" />
                <Badge value={u.status === "active" ? "Active" : u.status} tone={u.status === "active" ? "green" : "red"} />
                <Badge value={u.must_change_password ? "Password change required" : "Onboarding complete"} tone={u.must_change_password ? "amber" : "neutral"} />
              </View>
            </View>
          </View>
          <Split
            main={
              <Card>
                <CardHead title="Profile details" />
                <Input label="Full name" required value={f.full_name ?? ""} onChangeText={(v) => { setSaved(false); setF((x) => ({ ...x, full_name: v })); }} />
                <Input label="Email address" value={u.email} editable={false} hint="Email is the sign-in name and cannot be changed here." />
                <Grid min={240} gap={16}>
                  {(faculty ? FACULTY_FIELDS : STUDENT_FIELDS).map(([key, label]) => <Input key={key} label={label} value={f[key] ?? ""} onChangeText={(v) => { setSaved(false); setF((x) => ({ ...x, [key]: v })); }} />)}
                </Grid>
                <ErrorBanner message={save.error} />
                {saved && !dirty ? <Notice tone="success" message="Profile saved." /> : null}
                <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 9, paddingTop: 18, borderTopWidth: 1, borderTopColor: colors.border }}>
                  <Button title="Cancel" variant="secondary" disabled={!dirty} onPress={() => setF({ full_name: u.full_name, ...((u.profile ?? {}) as Record<string, string>) })} />
                  <Button title="Save profile" icon="checkmark" onPress={() => save.run()} busy={save.busy} disabled={!dirty || !f.full_name?.trim()} />
                </View>
              </Card>
            }
            side={
              <>
                <Card>
                  <CardHead title="Account access" />
                  <Button title="Reset onboarding password" variant="secondary" icon="key-outline" full onPress={() => reset.run()} busy={reset.busy} />
                  <Text style={{ fontSize: 11, color: colors.muted }}>The person must change the reset password at the next sign-in.</Text>
                  <Button title={u.status === "active" ? "Discontinue account" : "Reactivate account"} variant={u.status === "active" ? "secondary" : "primary"} icon={u.status === "active" ? "pause-circle-outline" : "play-circle-outline"} full onPress={() => status.run()} busy={status.busy} />
                  <Text style={{ fontSize: 11, color: colors.muted }}>{u.status === "active" ? "Blocks access without deleting learning records. You can reactivate later." : "Restores sign-in with the same records."}</Text>
                  <ErrorBanner message={reset.error ?? status.error} />
                </Card>
                <Card>
                  <CardHead title={faculty ? "Teaching subjects" : "Enrolled subjects"} />
                  {links.length === 0 ? <Text style={{ fontSize: 12, color: colors.muted }}>{faculty ? "Not assigned to any subject yet." : "Not enrolled in any subject yet."}</Text> : links.map((l: any) => {
                    const s = l.subject ?? l;
                    return <ListRow key={l.id} plain icon="library-outline" title={s.code ?? "Subject"} subtitle={s.name} right={l.status && l.status !== "active" ? <Badge value={l.status} /> : undefined} onPress={s.id ? () => router.push({ pathname: "/admin/subject/[id]", params: { id: s.id, tab: faculty ? "faculty" : "students" } }) : undefined} />;
                  })}
                  <Button title={faculty ? "Manage subject assignments" : "Manage enrollments"} variant="secondary" icon="library-outline" full onPress={() => router.push("/admin/subjects")} />
                </Card>
              </>
            }
          />
          <DangerZone title="Delete account permanently" text="This removes the account and its owned learning records. Use Discontinue when you only want to stop access.">
            <Button title="Delete account" variant="danger" icon="trash-outline" onPress={() => remove.run()} busy={remove.busy} />
          </DangerZone>
          <ErrorBanner message={remove.error} />
        </>
      ) : null}
    </Screen>
  );
}
