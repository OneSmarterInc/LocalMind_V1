import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import { View } from "react-native";
import { admin } from "@/api/endpoints";
import { useAction, useAsync } from "@/hooks/useAsync";
import { Button, Card, CardHead, Dropdown, Empty, ErrorBanner, FormFooter, Grid, Input, Notice, OptionCard, PageHeading, Screen, Split, StepList } from "@/ui";
import { IssuedCredential, OneTimeCredentials } from "@/ui/OneTimeCredentials";

type Kind = "students" | "faculty";

export default function AddPerson() {
  const router = useRouter();
  const p = useLocalSearchParams<{ kind?: string }>();
  const [kind, setKind] = useState<Kind>(p.kind === "faculty" ? "faculty" : "students");
  const [f, setF] = useState<Record<string, string>>({ batch: "" });
  const [subjectIds, setSubjectIds] = useState<string[]>([]);
  const [issued, setIssued] = useState<{ row: IssuedCredential; notice: string } | null>(null);
  const subjects = useAsync(() => admin.subjects({ status: "active" }), []);
  const set = (k: string) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const faculty = kind === "faculty";
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((f.email ?? "").trim());
  const create = useAction(async () => {
    const keys = faculty ? ["employee_id", "department", "designation", "phone"] : ["roll_number", "program", "batch", "phone"];
    const profile = Object.fromEntries(keys.filter((k) => f[k]?.trim()).map((k) => [k, f[k].trim()]));
    const u = await admin.createUser(kind, { email: f.email?.trim().toLowerCase(), full_name: f.full_name?.trim(), profile, ...(faculty && subjectIds.length ? { subject_ids: subjectIds } : {}) });
    const notice = `${faculty ? "Faculty account" : "Student account"} for ${u.full_name} created.`;
    if (u.initial_password) { setIssued({ row: { full_name: u.full_name, email: u.email, initial_password: u.initial_password }, notice }); setF({}); setSubjectIds([]); return; }
    router.replace({ pathname: "/admin/users", params: { kind, notice } });
  });
  return (
    <Screen>
      <PageHeading eyebrow="PEOPLE" title="Add a person" subtitle="Create the account first. Assign learning or teaching access in the next step."
        right={<Button title="Back to people" variant="secondary" icon="arrow-back" onPress={() => router.push({ pathname: "/admin/users", params: { kind } })} />} />
      {issued ? <OneTimeCredentials title={`One-time password for ${issued.row.full_name}`} rows={[issued.row]} onDone={() => router.replace({ pathname: "/admin/users", params: { kind, notice: issued.notice } })} /> : null}
      <Split
        main={
          <Card>
            <CardHead title="Account details" />
            <Dropdown label="Account type" value={kind} onChange={(v) => setKind(v as typeof kind)} width="100%" options={[{ value: "students", label: "Student" }, { value: "faculty", label: "Faculty" }]} />
            <Grid min={240} gap={16}>
              <Input label="Full name" required value={f.full_name ?? ""} onChangeText={set("full_name")} placeholder="For example, Aditi Sharma" />
              <Input label="Email address" required value={f.email ?? ""} onChangeText={set("email")} autoCapitalize="none" keyboardType="email-address" placeholder="person@example.edu" error={f.email && !emailOk ? "Enter a valid email address." : null} />
            </Grid>
            {faculty ? (
              <>
                <Grid min={240} gap={16}>
                  <Input label="Employee ID" value={f.employee_id ?? ""} onChangeText={set("employee_id")} />
                  <Input label="Department" value={f.department ?? ""} onChangeText={set("department")} />
                </Grid>
                <Grid min={240} gap={16}>
                  <Input label="Designation" value={f.designation ?? ""} onChangeText={set("designation")} />
                  <Input label="Phone number" value={f.phone ?? ""} onChangeText={set("phone")} keyboardType="phone-pad" placeholder="Optional" />
                </Grid>
                <CardHead title="Teaching subjects" subtitle="Optional now; you can assign subjects later from the subject page." />
                {subjects.data?.length ? <View style={{ gap: 8 }}>{subjects.data.map((s) => (
                  <OptionCard key={s.id} multi title={`${s.code} · ${s.name}`} selected={subjectIds.includes(s.id)} onPress={() => setSubjectIds((x) => (x.includes(s.id) ? x.filter((y) => y !== s.id) : [...x, s.id]))} />
                ))}</View> : <Empty icon="library-outline" text="No active subjects to assign yet." />}
              </>
            ) : (
              <>
                <Input label="Phone number" value={f.phone ?? ""} onChangeText={set("phone")} keyboardType="phone-pad" placeholder="Optional" containerStyle={{ maxWidth: 320 }} />
                <Grid min={240} gap={16}>
                  <Input label="Roll number" value={f.roll_number ?? ""} onChangeText={set("roll_number")} />
                  <Input label="Program" value={f.program ?? ""} onChangeText={set("program")} />
                </Grid>
                <Input label="Batch" value={f.batch ?? ""} onChangeText={set("batch")} placeholder={String(new Date().getFullYear())} containerStyle={{ maxWidth: 320 }} />
              </>
            )}
            <Notice title="A first sign-in password change is required." message="The account uses the platform's onboarding password policy: the person must change the initial password at first sign-in. No email is sent." />
            <ErrorBanner message={create.error} />
            <FormFooter note="The initial password is shown once after the account is created.">
              <Button title="Cancel" variant="secondary" onPress={() => router.push({ pathname: "/admin/users", params: { kind } })} />
              <Button title="Create account" icon="add" onPress={() => create.run()} busy={create.busy} disabled={!emailOk || !f.full_name?.trim()} />
            </FormFooter>
          </Card>
        }
        side={
          <Card>
            <CardHead title="A clear start for every user" />
            <StepList steps={[
              ["Choose the role", "A student studies subjects; faculty manages teaching content."],
              ["Add the identifying details", "An email address and full name are required."],
              ["Share onboarding instructions", "The person signs in to the matching portal and changes the initial password."],
            ]} />
          </Card>
        }
      />
    </Screen>
  );
}
