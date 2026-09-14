import {useIsFocused} from '@react-navigation/native';
import {recordCourseWork} from '@/offline/coursework';
import CourseAsk from "@/private/CourseAsk";
import { SourceContent } from "@/ui/SourceContent";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { AppState, Text, View } from "react-native";
import { student } from "@/api/endpoints";
import type { ModuleFull, Quiz } from "@/api/types";
import { useAsync } from "@/hooks/useAsync";
import { Badge, Button, Card, CardHead, DetailList, Empty, ErrorBanner, Eyebrow, FormFooter, Loading, Notice, PageHeading, PageTabs, Screen, Split, StepList, TextLink, colors, pct } from "@/ui";
import { LessonView } from "@/ui/LessonView";

type Tab = "read" | "lesson" | "ask";
const statusLabel = (st?: string) => (st === "completed" ? "Completed" : st === "in_progress" ? "In progress" : st === "needs_review" ? "Needs review" : "Not started");

export default function StudentModule() {
  const { id, tab: tabParam } = useLocalSearchParams<{ id: string; tab?: string }>();
  const router = useRouter();
  const navigation = useNavigation();
  const focused=useIsFocused();
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

  useEffect(()=>{if(focused&&tab==='lesson'&&teach.data?.status==='ready')void recordCourseWork('lesson',id).catch(()=>{});},[focused,tab,id,teach.data?.status]);

  // The breadcrumb's section link goes back to the book this module belongs to.
  useEffect(() => {
    if (m?.document_id) navigation.setOptions({ backTo: `/student/document/${m.document_id}` });
  }, [navigation, m?.document_id]);

  // Reading time: foreground seconds, sent every minute and when leaving.
  const acc = useRef(0);
  const moduleLoaded=!!m;
  useEffect(() => {
    if(!focused||!moduleLoaded)return;
    let last = Date.now(); let active = true;
    const flush = () => { const sec = Math.round(acc.current); if (sec > 0) { acc.current = 0; student.reportTime(id, sec).catch(() => {}); } };
    const tick = setInterval(() => { if (active && (typeof document==='undefined'||document.visibilityState==='visible')) acc.current += (Date.now() - last) / 1000; last = Date.now(); if (acc.current >= 60) flush(); }, 5000);
    const sub = AppState.addEventListener("change", (st) => { active = st === "active"; last = Date.now(); if (!active) flush(); });
    return () => { clearInterval(tick); sub.remove(); flush(); };
  }, [id,focused,moduleLoaded]);

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
      {m?.progress?.sync_pending?<Notice message="This progress is saved on your device and awaits institution synchronization."/>:null}
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
          {tab === "ask" ? <Split main={<CourseAsk key={id} moduleId={id} />} side={<AskTips />} /> : null}
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
  return (
    <Card style={{ paddingHorizontal: 20, paddingVertical: 24 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 6 }}>
        <Text style={{ fontSize: 11, color: colors.muted }}>Reading view · Your faculty’s source material</Text>
        <Button title={large ? "Normal text" : "Text size"} small variant="secondary" onPress={onToggleSize} accessibilityLabel={large ? "Use normal text size" : "Use larger text"} />
      </View>
      <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 18 }}>
        <Eyebrow>{`${module.document_title ?? "Module"} · Module ${String(module.module_number ?? module.order).padStart(2, "0")}`}</Eyebrow>
      </View>
      <View style={{ maxWidth: 750, gap: 15, marginTop: 6 }}>
        <SourceContent text={module.source_text} large={large} />
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
        <CardHead title="Keep learning offline" subtitle="Saved reading and ready lessons remain available offline. Download a local model in Offline AI to ask new doubts on this device. Downloaded MCQ quizzes are saved and marked locally when immediate results are permitted; submissions synchronize after reconnection." />
        <TextLink title="Offline availability" icon="download-outline" onPress={onOffline} />
      </Card>
    </>
  );
}

const LESSON_POLL_MS = 8000;

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

