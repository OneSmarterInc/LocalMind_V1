import { SourceFigures } from "@/ui/SourceFigures";
import { Ionicons } from "@expo/vector-icons";
import { useBackTo } from "@/hooks/useBackTo";
import { useTabParam } from "@/hooks/useTabParam";
import { quizNeedsSubmission } from "@/screens/student/quizStatus";
import {useIsFocused} from '@react-navigation/native';
import {recordCourseWork} from '@/offline/coursework';
import CourseAsk from "@/private/CourseAsk";
import { SourceContent } from "@/ui/SourceContent";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import React, { useEffect, useRef } from "react";
import { AppState, Pressable, Text, View } from "react-native";
import { student } from "@/api/endpoints";
import type { ModuleFull, ModuleNeighbour, Quiz } from "@/api/types";
import { useAsync } from "@/hooks/useAsync";
import { Badge, Button, Card, CardHead, DetailList, Empty, ErrorBanner, Eyebrow, FormFooter, Loading, Notice, PageHeading, PageTabs, Screen, Split, StepList, TextLink, colors, pct } from "@/ui";
import { LessonView } from "@/ui/LessonView";

type Tab = "read" | "lesson" | "ask";
const statusLabel = (st?: string) => (st === "completed" ? "Completed" : st === "in_progress" ? "In progress" : st === "needs_review" ? "Needs review" : "Not started");

export default function StudentModule() {
  const { id } = useLocalSearchParams<{ id: string; tab?: string }>();
  const router = useRouter();
  const back = useBackTo();
  const navigation = useNavigation();
  const focused=useIsFocused();
  const [tab, setTab] = useTabParam<Tab>("read", ["read", "lesson", "ask"]);
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
    if (m?.document_id) navigation.setOptions({ backTo: `/student/document/${m.document_id}`, backLabel: "Back to book" });
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
  // Replace rather than push: walking a book with Next should not build a
  // twenty-deep back stack that the student then has to unwind.
  // push, not replace: walking module 1 -> 2 -> 3 and pressing the browser Back
  // button should return to module 2, not jump all the way out to the book.
  const go = (moduleId: string) => router.push(`/student/module/${moduleId}`);
  const side = m ? (
    <>
      <ModuleSide module={m} quizzes={quizzes.data ?? []} onQuiz={(qid) => router.push(`/student/quiz/${qid}`)} onOffline={() => router.push("/student/offline")} />
    </>
  ) : null;
  const lessonState = teach.data?.status;
  return (
    <Screen scrollTopOn={id} refreshing={mod.loading} onRefresh={() => { mod.reload(); teach.reload(); }}>
      {m?.progress?.sync_pending?<Notice inline message="This progress is saved on your device and awaits institution synchronization."/>:null}
      <ErrorBanner message={mod.error} onRetry={mod.reload} />
      {mod.loading && !m ? <Loading /> : null}
      {m ? (
        <>
          <PageHeading eyebrow={eyebrow} title={m.title} subtitle={`${trail ? `${trail} / ` : ""}Module ${number}`}
            right={m.document_id ? <Button title="Back to book" variant="secondary" icon="arrow-back" onPress={() => back(`/student/document/${m.document_id}`)} /> : null} />
          <PageTabs<Tab> value={tab} onChange={setTab} tabs={[{ key: "read", label: "Read" }, { key: "lesson", label: "Lesson" }, { key: "ask", label: "Ask a doubt" }]} />
          {tab === "read" ? <Split main={<><ReadCard module={m} onLesson={() => setTab("lesson")} /><ModuleNav previous={m.previous_module} next={m.next_module} onGo={go} /></>} side={side} /> : null}
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
            <Card>
              <Empty icon="hourglass-outline" title="Your lesson isn't ready yet."
                text="The guided lesson appears here once it has been generated. Read the module in the meantime, or check again in a moment — the source text stays on the Read tab."
                action={
                  <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
                    <Button title="Read the module" icon="book-outline" variant="secondary" onPress={() => setTab("read")} />
                    <Button title="Try again" icon="refresh" onPress={() => teach.reload()} />
                  </View>
                } />
            </Card>
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
          {tab === "lesson" && lessonState === "ready" && teach.data?.lesson ? <ModuleNav previous={m.previous_module} next={m.next_module} onGo={go} /> : null}
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

function ReadCard({ module, onLesson }: { module: ModuleFull; onLesson?: () => void }) {
  return (
    <Card style={{ paddingHorizontal: 20, paddingVertical: 24 }}>
      <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 6 }}>Reading view · Your faculty’s source material</Text>
      <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 18 }}>
        <Eyebrow>{`${module.document_title ?? "Module"} · Module ${String(module.module_number ?? module.order).padStart(2, "0")}`}</Eyebrow>
      </View>
      <View style={{ maxWidth: 750, gap: 15, marginTop: 6 }}>
        <SourceContent text={module.source_text} />
        <SourceFigures visuals={module.source_visuals ?? []} />
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
            <DetailList items={[["Questions", String(q.question_count ?? "—")], ["Pass mark", `${q.pass_percentage}%`]]} />
            <Button title={quizNeedsSubmission(q) ? "Take the quiz" : "View submission"} icon="arrow-forward" full onPress={() => onQuiz(q.id)} />
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


/** Previous / Next across the whole book, in the order a student reads it.
 *
 * There was no way to move between modules from the reading view at all: you
 * went back to the book and picked the next one by eye, every time. A locked
 * neighbour is shown but not pressable, with the reason on it, so the control
 * never navigates into a MODULE_LOCKED page — which is what "make sure not to
 * move to the next module if the next module is closed" has to mean in
 * practice.
 */
function ModuleNav({ previous, next, onGo }: { previous?: ModuleNeighbour | null; next?: ModuleNeighbour | null; onGo: (id: string) => void }) {
  if (!previous && !next) return null;
  const step = (n: ModuleNeighbour | null | undefined, side: "previous" | "next") => {
    if (!n) return <View style={{ flex: 1 }} />;
    const locked = n.availability !== "open";
    const body = (
      <View style={{ flex: 1, gap: 3, alignItems: side === "next" ? "flex-end" : "flex-start" }}>
        <Text style={{ fontSize: 12, color: colors.muted }}>
          {side === "next" ? "Next module" : "Previous module"} {n.number}
        </Text>
        <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: "600", color: locked ? colors.muted : colors.ink, textAlign: side === "next" ? "right" : "left" }}>
          {n.title}
        </Text>
        {locked ? <Text style={{ fontSize: 11, color: colors.muted }}>Not open yet</Text> : null}
      </View>
    );
    const inner = (
      <View style={{ flexDirection: side === "next" ? "row-reverse" : "row", alignItems: "center", gap: 10, flex: 1 }}>
        <Ionicons name={side === "next" ? "chevron-forward" : "chevron-back"} size={18} color={locked ? colors.faint : colors.primary} />
        {body}
      </View>
    );
    if (locked) {
      return (
        <View accessibilityLabel={`${n.title} is not open yet`} style={{ flex: 1, opacity: 0.55, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: "#F7F8F6" }}>
          {inner}
        </View>
      );
    }
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={`Go to module ${n.number}: ${n.title}`} onPress={() => onGo(n.id)}
        style={(st: any) => [{ flex: 1, minHeight: 64, borderWidth: 1, borderColor: st.hovered ? colors.borderStrong : colors.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: st.pressed || st.hovered ? "#F1F5EF" : colors.surface }]}>
        {inner}
      </Pressable>
    );
  };
  return (
    <View style={{ flexDirection: "row", gap: 12, marginTop: 4 }}>
      {step(previous, "previous")}
      {step(next, "next")}
    </View>
  );
}

