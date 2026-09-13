import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, SafeAreaView, ScrollView, Share, Text, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import { BLOCK, CASES, FIXTURE_VERSION, type CaseName } from "./src/fixture";
import { openStore } from "./src/store";
import { SpikeRuntime } from "./src/runtime";

type Store = Awaited<ReturnType<typeof openStore>>;
export default function App() {
  const runtime = useRef(new SpikeRuntime());
  const store = useRef<Store | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [model, setModel] = useState("No model loaded");
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState("");
  const modelMeta = useRef({ name: "", bytes: 0 });
  const active = useRef(false);
  useEffect(() => {
    let live = true;
    void openStore().then((value) => {
      if (!live) { void value.close(); return; }
      store.current = value; setReady(true);
    }).catch((e) => setNotice(String(e)));
    return () => { live = false; void runtime.current.stop(); };
  }, []);
  const doWork = async (fn: () => Promise<void>) => {
    if (active.current) return;
    active.current = true; setBusy(true); setNotice("");
    try { await fn(); }
    catch (e) { setNotice(e instanceof Error ? e.message : String(e)); }
    finally { active.current = false; setBusy(false); }
  };
  const importModel = () => doWork(async () => {
    const chosen = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true });
    if (chosen.canceled) return;
    const asset = chosen.assets[0];
    if (!asset.name.toLowerCase().endsWith(".gguf")) throw new Error("Choose a .gguf chat-model file.");
    const original = new File(asset.uri);
    if (original.size < 50 * 1024 * 1024) throw new Error("The file is too small to be the intended model. Check the download.");
    await runtime.current.close(); setLoaded(false);
    const destination = new File(Paths.document, "benchmark-model.gguf");
    if (destination.exists) destination.delete();
    original.copy(destination);
    // File size and suffix are preliminary checks, not model validation.
    // The native loader validates the actual GGUF before accepting it.
    const configuration = await runtime.current.load(destination.uri);
    modelMeta.current = { name: asset.name, bytes: destination.size };
    setModel(asset.name); setLoaded(true);
    setResult(JSON.stringify(configuration, null, 2));
  });
  const run = (name: CaseName, repetitions = 1) => doWork(async () => {
    if (!store.current) throw new Error("The local database is not ready.");
    const results = [];
    for (let round = 0; round < repetitions; round++) {
      const outcome = await runtime.current.run(store.current.source, CASES[name]);
      const metrics = { ...outcome.metrics, ...modelMeta.current, case: name, sequence: round + 1,
        os: Platform.OS, osVersion: String(Platform.Version), fixture: FIXTURE_VERSION };
      await store.current.record(metrics);
      results.push({ ...metrics, output: outcome.output });
      setResult(JSON.stringify(results, null, 2));
    }
  });
  const exportMeasurements = () => doWork(async () => {
    if (!store.current) throw new Error("The local database is not ready.");
    const rows = await store.current.report();
    await Share.share({ title: "LocalMind synthetic-device measurements", message: JSON.stringify({
      purpose: "Synthetic benchmark only; no learner data, answer text, grades or model weights.",
      records: rows.map((r) => ({ at: r.created_at, fixture: r.fixture, ...JSON.parse(r.metadata) })),
    }, null, 2) });
  });
  function button(label: string, action: () => void, disabled = false) {
    return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={action}
      style={({ pressed }) => ({ padding: 14, backgroundColor: disabled ? "#DFE6DF" : pressed ? "#174B36" : "#236148", borderRadius: 8, marginVertical: 5 })}>
      <Text style={{ color: disabled ? "#354B40" : "white", fontWeight: "600", fontSize: 15 }}>{label}</Text>
    </Pressable>;
  }
  return <SafeAreaView style={{ flex: 1, backgroundColor: "#F5F7F4" }}><ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
    <Text accessibilityRole="header" style={{ fontSize: 25, color: "#21382E", fontWeight: "700" }}>LocalMind device test</Text>
    <Text style={{ fontSize: 15, lineHeight: 23 }}>A separate engineering test app, not the finished student tutor. It reads a stored source block and rubric from this device. No login, grades, question generation or automatic uploads.</Text>
    <View style={{ backgroundColor: "white", padding: 16, borderRadius: 10, gap: 8 }}>
      <Text style={{ fontWeight: "600", fontSize: 17 }}>1. Import your local model</Text>
      <Text>{model}</Text>
      <Text>Use a GGUF model copied onto this phone. The test uses a 2,048-token context, two CPU threads and no GPU offload. These are test settings, not approved hardware requirements.</Text>
      {button("Choose and load GGUF", importModel, busy || !ready)}
    </View>
    <View style={{ backgroundColor: "white", padding: 16, borderRadius: 10, gap: 8 }}>
      <Text style={{ fontWeight: "600", fontSize: 17 }}>2. Run bounded tasks</Text>
      <Text>First run after loading and repeated warm runs should be compared. Time to first token measures the first streamed token, which can be JSON punctuation—not the first visible teaching sentence.</Text>
      {button("Explain one stored block", () => run("explain"), busy || !loaded)}
      {button("Repeat explanation three times", () => run("explain", 3), busy || !loaded)}
      {button("Ask an out-of-source question", () => run("outside_source"), busy || !loaded)}
      {button("Check a prepared correct practice answer", () => run("check_answer"), busy || !loaded)}
      {button("Check a prepared misconception", () => run("check_misconception"), busy || !loaded)}
      {busy ? <View><ActivityIndicator /><Text>Working locally. Use Stop to cancel a running completion.</Text>
        {button("Stop completion", () => { void runtime.current.stop().catch((e) => setNotice(String(e))); })}</View> : null}
    </View>
    {notice ? <Text accessibilityRole="alert" style={{ color: "#A33936", fontSize: 15 }}>{notice}</Text> : null}
    <Text selectable style={{ fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", color: "#21382E", backgroundColor: "#EAF2EC", padding: 12 }}>{result || "Measured results will appear here. Nothing has been measured yet."}</Text>
    <Text style={{ fontSize: 14 }}>Memory headroom is not inferred from model size. Use the included ADB capture script on Android. Schema-valid output is not a factual-quality approval; inspect the explanations and rubric judgments yourself.</Text>
    {button("Share benchmark metadata manually", exportMeasurements, busy || !ready)}
    {button("Delete benchmark measurements", () => Alert.alert("Delete measurements?", "This removes local benchmark timing records only.", [
      { text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => { void doWork(async () => { await store.current?.clearMeasurements(); setResult(""); }); } },
    ]), busy || !ready)}
    <Text accessibilityRole="header" style={{ fontSize: 18, fontWeight: "600" }}>Stored test source</Text>
    <Text style={{ fontSize: 15, lineHeight: 24 }}>{BLOCK.text}</Text>
  </ScrollView></SafeAreaView>;
}
