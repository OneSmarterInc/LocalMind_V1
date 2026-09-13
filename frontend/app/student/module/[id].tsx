import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { AppState, ScrollView, Text, TextInput, View } from "react-native";
import { ApiError } from "@/api/client";
import { student } from "@/api/endpoints";
import type { Message, ModuleFull, Quiz } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { useAction, useAsync } from "@/hooks/useAsync";
import { useOnline } from "@/offline/connectivity";
import { Avatar, Badge, Button, Card, CardHead, Chip, DetailList, Empty, ErrorBanner, Eyebrow, FormFooter, Loading, Notice, PageHeading, PageTabs, Screen, Spinner, Split, StepList, TextLink, TileIcon, colors, pct } from "@/ui";
import { LessonView } from "@/ui/LessonView";

type Tab = "read" | "lesson" | "ask";
const statusLabel = (st?: string) => (st === "completed" ? "Completed" : st === "in_progress" ? "In progress" : st === "needs_review" ? "Needs review" : "Not started");

export default function StudentModule() {
  const { id, tab: tabParam } = useLocalSearchParams<{ id: string; tab?: string }>();
  const router = useRouter();
  const navigation = useNavigation();
  const [tab, setTab] = useState<Tab>(tabParam === "lesson" || tabParam === "ask" ? tabParam : "read");
  useEffect(() => { if (tabParam === "lesson" || tabParam === "ask" || tabParam === "read") setTab(tabParam); }, [tabParam, id]);
  const [large, setLarge] = useState(false);
  const mod = useAsync(() => student.module(id), [id]);
  const quizzes = useAsync(() => student.quizzes({ module: id }), [id]);
  const m = mod.data;
  const context = useAsync(async () => {
    if (!m?.document_id) return null;
    const tree = await student.document(m.document_id);
    return (await student.subjects()).find((s) => s.id === tree.subject_id) ?? null;
  }, [m?.document_id]);
  const teach = useAsync(() => student.teach(id), [id]);

  // The breadcrumb's section link goes back to the book this module belongs to.
  useEffect(() => {
    if (m?.document_id) navigation.setOptions({ backTo: `/student/document/${m.document_id}` });
  }, [navigation, m?.document_id]);

  // Reading time: foreground seconds, sent every minute and when leaving.
  const acc = useRef(0);
  useEffect(() => {
    let last = Date.now(); let active = true;
    const flush = () => { const sec = Math.round(acc.current); if (sec > 0) { acc.current = 0; student.reportTime(id, sec).catch(() => {}); } };
    const tick = setInterval(() => { if (active) acc.current += (Date.now() - last) / 1000; last = Date.now(); if (acc.current >= 60) flush(); }, 5000);
    const sub = AppState.addEventListener("change", (st) => { active = st === "active"; last = Date.now(); if (!active) flush(); });
    return () => { clearInterval(tick); sub.remove(); flush(); };
  }, [id]);

  // Lessons are prepared in the background; while one is queued, look again quietly.
  const { setData: setTeach } = teach;
  useEffect(() => {
    if (teach.data?.status !== "preparing") return;
    const timer = setTimeout(async () => { try { setTeach(await student.teach(id)); } catch { /* next focus retries */ } }, LESSON_POLL_MS);
    return () => clearTimeout(timer);
  }, [teach.data, id, setTeach]);

  const eyebrow = context.data ? `${context.data.code} · ${context.data.name}`.toUpperCase() : undefined;

  if (mod.errorCode === "MODULE_LOCKED") {
    return (
      <Screen>
        <LockedHeading moduleId={id} />
        <Card>
          <Empty icon="lock-closed-outline" title="This module is not open yet." text="Your faculty decides when this module becomes available. Continue with an open module in the meantime."
            action={<Button title="See available modules" icon="arrow-forward" onPress={() => router.replace("/student/subjects")} />} />
        </Card>
      </Screen>
    );
  }

  const trail = m ? [...new Set([m.document_title, m.chapter_title].filter(Boolean))].join(" / ") : "";
  const number = m?.module_number ?? m?.order;
  const side = m ? <ModuleSide module={m} quizzes={quizzes.data ?? []} onQuiz={(qid) => router.push(`/student/quiz/${qid}`)} onOffline={() => router.push("/student/offline")} /> : null;
  const lessonState = teach.data?.status;
  return (
    <Screen refreshing={mod.loading} onRefresh={() => { mod.reload(); teach.reload(); }}>
      <ErrorBanner message={mod.error} onRetry={mod.reload} />
      {mod.loading && !m ? <Loading /> : null}
      {m ? (
        <>
          <PageHeading eyebrow={eyebrow} title={m.title} subtitle={`${trail ? `${trail} / ` : ""}Module ${number}`}
            right={m.document_id ? <Button title="Back to book" variant="secondary" icon="arrow-back" onPress={() => router.push(`/student/document/${m.document_id}`)} /> : null} />
          <PageTabs<Tab> value={tab} onChange={setTab} tabs={[{ key: "read", label: "Read" }, { key: "lesson", label: "Lesson" }, { key: "ask", label: "Ask a doubt" }]} />
          {tab === "read" ? <Split main={<ReadCard module={m} large={large} onToggleSize={() => setLarge((v) => !v)} onLesson={() => setTab("lesson")} />} side={side} /> : null}
          {tab === "lesson" && teach.loading && !teach.data ? <Loading /> : null}
          {tab === "lesson" ? <ErrorBanner message={teach.error} onRetry={teach.reload} /> : null}
          {tab === "lesson" && lessonState === "preparing" ? (
            <Card>
              <Empty icon="hourglass-outline" title="Your lesson is being prepared." text="The source text is ready to read. The guided lesson will appear here after generation completes; there is no need to refresh."
                action={<Button title="Read the module" icon="book-outline" onPress={() => setTab("read")} />} />
              <View style={{ gap: 10, marginTop: 8 }}>
                <View style={{ height: 12, borderRadius: 6, backgroundColor: "#EAF0E6", width: "40%" }} />
                <View style={{ height: 12, borderRadius: 6, backgroundColor: "#EAF0E6" }} />
                <View style={{ height: 12, borderRadius: 6, backgroundColor: "#EAF0E6", width: "80%" }} />
              </View>
            </Card>
          ) : null}
          {tab === "lesson" && lessonState === "unavailable" ? (
            <>
              <Notice tone="warning" title="The guided lesson is not available right now." message="Here is the original module text, so you can keep learning. The lesson appears here once the tutor has written it."
                action={<Button title="Try again" small variant="secondary" icon="refresh" onPress={() => teach.reload()} />} />
              <ReadCard module={m} large={large} onToggleSize={() => setLarge((v) => !v)} />
            </>
          ) : null}
          {tab === "lesson" && lessonState === "ready" && teach.data?.lesson ? (
            <Split side={side} main={
              <LessonView lesson={teach.data.lesson} footer={
                <FormFooter note="Lesson based on this module’s source material.">
                  {quizzes.data?.[0] ? <Button title="Check my understanding" icon="help-circle-outline" onPress={() => router.push(`/student/quiz/${quizzes.data![0].id}`)} /> : null}
                </FormFooter>
              } />
            } />
          ) : null}
          {tab === "ask" ? <Split main={<AskTab moduleId={id} />} side={<AskTips />} /> : null}
        </>
      ) : null}
    </Screen>
  );
}

/** A locked module's own title comes from the book outline, which lists locked modules too. */
function LockedHeading({ moduleId }: { moduleId: string }) {
  const found = useAsync(async () => {
    for (const s of await student.subjects()) {
      for (const d of await student.documents(s.id)) {
        const tree = await student.document(d.id);
        const all = tree.chapters.flatMap((c) => c.modules);
        const index = all.findIndex((x) => x.id === moduleId);
        if (index >= 0) return { title: all[index].title, book: tree.title, number: index + 1 };
      }
    }
    return null;
  }, [moduleId]);
  const f = found.data;
  return <PageHeading eyebrow="YOUR LEARNING PATH" title={f?.title ?? "Locked module"} subtitle={f ? `${f.book} · Module ${f.number}` : null} />;
}

function ReadCard({ module, large, onToggleSize, onLesson }: { module: ModuleFull; large: boolean; onToggleSize: () => void; onLesson?: () => void }) {
  const blocks = module.source_text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const size = large ? 18 : 15;
  return (
    <Card style={{ paddingHorizontal: 36, paddingVertical: 28 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 6 }}>
        <Text style={{ fontSize: 11, color: colors.muted }}>Reading view · Your faculty’s source material</Text>
        <Button title={large ? "Normal text" : "Text size"} small variant="secondary" onPress={onToggleSize} accessibilityLabel={large ? "Use normal text size" : "Use larger text"} />
      </View>
      <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 18 }}>
        <Eyebrow>{`${module.document_title ?? "Module"} · Module ${String(module.module_number ?? module.order).padStart(2, "0")}`}</Eyebrow>
      </View>
      <View style={{ maxWidth: 750, gap: 15, marginTop: 6 }}>
        {blocks.length === 0 ? <Text style={{ color: colors.muted }}>This module has no text yet.</Text> : blocks.map((b, i) => b.startsWith("#")
          ? <Text key={i} style={{ fontSize: large ? 20 : 17, fontWeight: "600", color: colors.ink, marginTop: 10 }}>{b.replace(/^#+\s*/, "")}</Text>
          : <Text key={i} style={{ fontSize: size, lineHeight: Math.round(size * 1.9), color: "#3F5045" }}>{b.replace(/\s*\n\s*/g, " ")}</Text>)}
      </View>
      {onLesson ? <FormFooter note="Continue at your own pace."><Button title="Explore the lesson" icon="arrow-forward" onPress={onLesson} /></FormFooter> : null}
    </Card>
  );
}

function ModuleSide({ module, quizzes, onQuiz, onOffline }: { module: ModuleFull; quizzes: Quiz[]; onQuiz: (id: string) => void; onOffline: () => void }) {
  const q = quizzes[0];
  const pages = module.start_page ? `${module.start_page}${module.end_page && module.end_page !== module.start_page ? `–${module.end_page}` : ""}` : null;
  const st = module.progress?.status;
  return (
    <>
      <Card>
        <Text style={{ fontSize: 18, fontWeight: "600", color: colors.ink }}>About this module</Text>
        <View style={{ flexDirection: "row" }}><Badge value={statusLabel(st)} tone={st === "completed" ? "green" : st === "in_progress" ? "blue" : "neutral"} /></View>
        <DetailList items={[
          ["Book", module.document_title ?? "—"],
          ["Module", module.module_number && module.module_count ? `${module.module_number} of ${module.module_count}` : `Module ${module.order}`],
          ...(pages ? [["Source pages", pages] as [string, string]] : []),
          ...(module.faculty_names?.length ? [["Faculty", module.faculty_names.join(", ")] as [string, string]] : []),
          ...(module.progress?.best_quiz_percentage != null ? [["Best quiz", pct(module.progress.best_quiz_percentage)] as [string, string]] : []),
        ]} />
      </Card>
      <Card>
        <CardHead title="Ready to check yourself?" subtitle={q ? "Put your understanding into practice." : "No quiz has been set for this module yet."} />
        {q ? (
          <>
            <DetailList items={[["Questions", String(q.question_count ?? "—")], ["Pass mark", `${q.pass_percentage}%`], ["Attempts allowed", q.max_attempts ? String(q.max_attempts) : "Unlimited"]]} />
            <Button title={q.attempts_used ? "Open the quiz" : "Take the quiz"} icon="arrow-forward" full onPress={() => onQuiz(q.id)} />
            {quizzes.length > 1 ? quizzes.slice(1).map((x) => <TextLink key={x.id} title={x.title} onPress={() => onQuiz(x.id)} />) : null}
          </>
        ) : null}
      </Card>
      <Card>
        <CardHead title="Keep learning offline" subtitle="Saved reading and ready lessons remain available when the server is unreachable. New questions and quiz submissions need a connection." />
        <TextLink title="Offline availability" icon="download-outline" onPress={onOffline} />
      </Card>
    </>
  );
}

const LESSON_POLL_MS = 8000;

function AskTab({ moduleId }: { moduleId: string }) {
  const online = useOnline();
  const userName = useAuth().user?.full_name ?? "";
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [question, setQuestion] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [restoring, setRestoring] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const scroll = useRef<ScrollView>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const latest = (await student.conversations(moduleId))[0];
        if (!latest || !alive) return;
        const full = await student.conversation(latest.id);
        if (!alive) return;
        setConversationId(full.id); setMessages(full.messages ?? []);
      } catch { /* no history is fine */ } finally { if (alive) setRestoring(false); }
    })();
    return () => { alive = false; };
  }, [moduleId]);

  const ask = useAction(async (text: string) => {
    setFailed(null); setQuestion(""); setSuggestions([]);
    setMessages((cur) => {
      const last = cur[cur.length - 1];
      if (last && last.role === "user" && last.content === text) return cur;
      return [...cur, { id: `local-${Date.now()}`, role: "user", content: text, grounded: true, source_reference: "", created_at: new Date().toISOString() }];
    });
    try {
      const res = await student.ask(moduleId, text, conversationId);
      setConversationId(res.conversation_id); setMessages((cur) => [...cur, res.message]); setSuggestions(res.follow_up_suggestions ?? []);
    } catch (e) {
      const conv = e instanceof ApiError ? (e.details?.conversation_id as string | undefined) : undefined;
      if (conv) setConversationId(conv);
      setFailed(text);
      throw e;
    }
  });
  useEffect(() => { if (!ask.busy) { setSlow(false); return; } const t = setTimeout(() => setSlow(true), 15000); return () => clearTimeout(t); }, [ask.busy]);
  useEffect(() => { const t = setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 60); return () => clearTimeout(t); }, [messages.length, ask.busy]);
  const send = (text: string) => { const v = text.trim(); if (v && online && !ask.busy) void ask.run(v); };

  return (
    <Card style={{ minHeight: 475 }}>
      <ScrollView ref={scroll} style={{ maxHeight: 510 }} contentContainerStyle={{ gap: 22, paddingBottom: 12 }} keyboardShouldPersistTaps="handled">
        {restoring ? <Spinner /> : null}
        {!online ? <Notice tone="warning" title="You are offline" message="Earlier questions and answers are shown. Asking something new needs a connection to the LocalMind server." icon="cloud-offline-outline" /> : null}
        {!restoring && messages.length === 0 ? (
          <View style={{ flexDirection: "row", gap: 10 }}>
            <TileIcon icon="sparkles-outline" size={32} />
            <View style={styles.bubble}>
              <Eyebrow>YOUR LOCALMIND TUTOR</Eyebrow>
              <Text style={styles.bubbleText}>Ask anything about this module in your own words. My answers stay within the module and point back to the part of the text they use.</Text>
            </View>
          </View>
        ) : null}
        {messages.map((msg) => {
          const mine = msg.role === "user";
          const offTopic = !mine && msg.grounded === false;
          return (
            <View key={msg.id} style={{ flexDirection: mine ? "row-reverse" : "row", gap: 10, alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "90%" }}>
              {mine ? <Avatar name={userName} size={32} /> : <TileIcon icon={offTopic ? "information-circle-outline" : "sparkles-outline"} tone={offTopic ? "amber" : "green"} size={32} />}
              <View style={[styles.bubble, mine && styles.mine, offTopic && { backgroundColor: "#FFFAEC", borderColor: "#EBDFBD" }]}>
                {!mine ? <Eyebrow color={offTopic ? colors.warning : undefined}>{offTopic ? "OUTSIDE THIS MODULE" : "YOUR LOCALMIND TUTOR"}</Eyebrow> : null}
                <Text style={[styles.bubbleText, mine && { color: "#FFFFFF" }]} selectable>{msg.content}</Text>
                {!mine && msg.source_reference ? <Text style={styles.source}>From the module: {msg.source_reference}</Text> : null}
              </View>
            </View>
          );
        })}
        {ask.busy ? <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}><TileIcon icon="sparkles-outline" size={32} /><Text style={{ fontSize: 12, color: colors.muted }}>{slow ? "Still working on it. Answers can take a minute or two on this computer; you can keep reading meanwhile." : "Thinking…"}</Text></View> : null}
        {ask.error ? <Notice tone="warning" title="The tutor could not answer" message={ask.error} action={failed ? <Button title="Ask again" small variant="secondary" icon="refresh" onPress={() => ask.run(failed)} /> : undefined} /> : null}
      </ScrollView>
      {suggestions.length ? <View style={{ flexDirection: "row", gap: 7, flexWrap: "wrap" }}>{suggestions.map((sg) => <Chip key={sg} label={sg} onPress={() => send(sg)} />)}</View> : null}
      <View style={{ flexDirection: "row", gap: 10, paddingTop: 17, borderTopWidth: 1, borderTopColor: colors.border }}>
        <TextInput value={question} onChangeText={setQuestion} placeholder={online ? "What would you like to understand?" : "Offline: asking needs a connection"} placeholderTextColor={colors.faint}
          editable={online && !ask.busy} onSubmitEditing={() => send(question)} blurOnSubmit={false} accessibilityLabel="Your question"
          style={{ flex: 1, borderWidth: 1, borderColor: "#D8E0D7", borderRadius: 7, paddingHorizontal: 12, minHeight: 41, fontSize: 13, color: colors.ink, backgroundColor: "#FFFFFF" }} />
        <Button title="Ask" icon="send" onPress={() => send(question)} disabled={!question.trim() || !online} busy={ask.busy} />
      </View>
      <Text style={{ fontSize: 11, color: colors.muted }}>Answers stay within this module.</Text>
    </Card>
  );
}

function AskTips() {
  return (
    <Card>
      <CardHead title="A little help goes a long way" />
      <StepList steps={[
        ["Ask in your own words", "There is no special way to phrase a question."],
        ["Go one idea at a time", "Follow up with “why?” or ask for a simpler explanation."],
        ["Use the source", "Every grounded answer points back to the module."],
      ]} />
      <Notice title="Beyond this module?" message="Your faculty is the right person to ask about topics outside the book." />
    </Card>
  );
}

const styles = {
  bubble: { flexShrink: 1, backgroundColor: "#F3F6F0", borderWidth: 1, borderColor: "#E3EADF", borderTopLeftRadius: 0, borderRadius: 12, paddingHorizontal: 19, paddingVertical: 16, gap: 7 },
  mine: { backgroundColor: colors.primary, borderColor: colors.primary, borderTopLeftRadius: 12, borderTopRightRadius: 0 },
  bubbleText: { fontSize: 13, lineHeight: 23, color: colors.text },
  source: { fontSize: 11, paddingTop: 10, marginTop: 4, borderTopWidth: 1, borderTopColor: colors.border, color: colors.muted },
} as const;
