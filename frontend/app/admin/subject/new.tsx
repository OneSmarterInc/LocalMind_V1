import { useRouter } from "expo-router";
import React, { useState } from "react";
import { admin } from "@/api/endpoints";
import { useAction } from "@/hooks/useAsync";
import { Button, Card, CardHead, ErrorBanner, FormFooter, Input, PageHeading, Screen, Split, StepList } from "@/ui";

export default function CreateSubject() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const create = useAction(async () => {
    const s = await admin.createSubject({ name: name.trim(), code: code.trim().toUpperCase(), description: description.trim() });
    router.replace({ pathname: "/admin/subject/[id]", params: { id: s.id, tab: "faculty" } });
  });
  return (
    <Screen>
      <PageHeading eyebrow="SUBJECTS" title="Create a subject" subtitle="Start with a name and a unique code. Assign faculty and students next."
        right={<Button title="Back to subjects" variant="secondary" icon="arrow-back" onPress={() => router.push("/admin/subjects")} />} />
      <Split
        main={
          <Card>
            <CardHead title="Subject details" />
            <Input label="Subject name" required value={name} onChangeText={setName} placeholder="For example, Introduction to Cybersecurity" />
            <Input label="Subject code" required value={code} onChangeText={setCode} autoCapitalize="characters" placeholder="For example, CS101" hint="A unique code, such as CS101. The backend normalizes it to uppercase." />
            <Input label="Description" multiline value={description} onChangeText={setDescription} hint="Give faculty and students a brief description of the subject." style={{ minHeight: 90 }} />
            <ErrorBanner message={create.error} />
            <FormFooter note="Assign faculty and enroll students after the subject exists.">
              <Button title="Cancel" variant="secondary" onPress={() => router.push("/admin/subjects")} />
              <Button title="Create subject" icon="add" onPress={() => create.run()} busy={create.busy} disabled={!name.trim() || !code.trim()} />
            </FormFooter>
          </Card>
        }
        side={
          <Card>
            <CardHead title="What comes next" />
            <StepList steps={[
              ["Create the subject", "The code identifies it throughout the platform."],
              ["Assign faculty", "They can manage the subject’s teaching content."],
              ["Enroll students", "They can access published, open material."],
            ]} />
          </Card>
        }
      />
    </Screen>
  );
}
