import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Button, Image, Pressable, SafeAreaView, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import * as Picker from 'expo-document-picker';
import * as FS from 'expo-file-system/legacy';
import nacl from 'tweetnacl';
import * as Crypto from 'expo-crypto';
import { openStudyStore, type StudyStore } from './src/store';
import { DeviceModel } from './src/model';
import { StudySession, fromBase64, observation, type Block, type Question, type State, type Move } from './src/core';
import { OBSERVATION_URL, stopSharingRequest, syncObservations } from './src/sync';

const model = new DeviceModel();
type Page = 'library' | 'setup' | 'study';
const questionId = () => Crypto.randomUUID();

export default function App() {
  const [store, setStore] = useState<StudyStore | null>(null);
  const [page, setPage] = useState<Page>('library');
  const [packages, setPackages] = useState<{ id: string; version: number; title: string; active: number }[]>([]);
  const [session, setSession] = useState<StudySession | null>(null);
  const [blockId, setBlockId] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [modelReady, setModelReady] = useState(false), [sharing, setSharing] = useState(false);
  const [keyId, setKeyId] = useState(''), [keyText, setKeyText] = useState('');
  const [question, setQuestion] = useState(''), [reply, setReply] = useState('');
  const [practice, setPractice] = useState<Question | null>(null), [answer, setAnswer] = useState('');
  const [selected, setSelected] = useState<number | null>(null), [feedback, setFeedback] = useState('');
  const [shownBlock, setShownBlock] = useState<Block | null>(null);
  const lastHelp = useRef<{ state: State; move: Move } | null>(null);
  const busyRef = useRef(false);
  const refresh = async (s = store) => { if (s) setPackages(await s.packages()); };
  const act = async (work: () => Promise<void>) => {
    if (busyRef.current) return; busyRef.current = true; setBusy(true); setError(''); setNotice('');
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { busyRef.current = false; setBusy(false); }
  };
  useEffect(() => {
    let live = true;
    void openStudyStore().then(async s => {
      if (!live) { await s.close(); return; }
      setStore(s); setSharing(await s.sharing()); await refresh(s);
      const uri = await s.modelUri(); if (uri) setNotice('A model is stored on this device. Open Setup and load it before asking questions.');
    }).catch(e => setError(String(e)));
    return () => { live = false; stopSharingRequest(); void model.stop(); };
  }, []);
  useEffect(() => {
    if (!store || !sharing || !OBSERVATION_URL) return;
    const sync = () => { void syncObservations(store).catch(() => {}); };
    const timer = setInterval(sync, 10 * 60 * 1000); sync();
    const sub = AppState.addEventListener('change', state => { if (state === 'active') sync(); });
    return () => { clearInterval(timer); sub.remove(); };
  }, [store, sharing]);
  const block = session && blockId ? session.block(blockId) : null;
  const clearBlockState = () => { setReply(''); setPractice(null); setSelected(null); setFeedback(''); setAnswer(''); setShownBlock(null); lastHelp.current = null; };

  async function importPackage() {
    const picked = await Picker.getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true });
    if (picked.canceled || !store) return;
    const info = await FS.getInfoAsync(picked.assets[0].uri);
    if (!info.exists || info.isDirectory || info.size > 28 * 1024 * 1024) throw new Error('Choose a study package smaller than 28 MB.');
    const p = await store.install(await FS.readAsStringAsync(picked.assets[0].uri)); await refresh();
    setNotice(`Verified and installed ${p.title}, version ${p.version}. Your current study session has not changed.`);
  }
  async function enter(id: string, version: number) {
    if (!store) return;
    const content = await store.content(id, version);
    const current = packages.find(p => p.id === id && p.active);
    const start = () => { void act(async () => { await store.activate(id, version); setSession(new StudySession(content, model)); setBlockId(content.blocks[0].id); clearBlockState(); setPage('study'); await refresh(); }); };
    if (current && current.version !== version) Alert.alert('Change the material you are studying?', `Switch from version ${current.version} to ${version}? Previous packages are kept. This starts a new session.`, [{ text: 'Keep current version', style: 'cancel' }, { text: 'Use this version', onPress: start }]);
    else { await store.activate(id, version); setSession(new StudySession(content, model)); setBlockId(content.blocks[0].id); clearBlockState(); setPage('study'); await refresh(); }
  }
  async function remember(understood: boolean) {
    if (!store || !block || !session) return;
    const previous = await store.learner(block.id, block.revision);
    await store.remember(block.id, block.revision, { ...previous, needsPractice: !understood });
    if (lastHelp.current) await store.record(observation(session, questionId(), block.id, lastHelp.current.state, lastHelp.current.move,
      understood ? 'retry_succeeded' : 'retry_needed', practice?.id ?? null));
  }
  return <SafeAreaView style={s.safe}>
    <View style={s.header}><Text style={s.brand}>LocalMind · Private study</Text><Text style={s.muted}>Experimental device build · No grades collected</Text></View>
    <View style={s.nav}>{(['library','study','setup'] as Page[]).filter(p => p !== 'study' || session).map(p => <Pressable disabled={busy} accessibilityRole="button" key={p} onPress={() => setPage(p)} style={[s.pill, page === p && s.selected]}><Text>{p === 'library' ? 'My library' : p === 'study' ? 'Study' : 'Setup & privacy'}</Text></Pressable>)}</View>
    <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      {!!error && <View style={s.error}><Text selectable accessibilityRole="alert">{error}</Text></View>}
      {!!notice && <View style={s.card}><Text>{notice}</Text></View>}
      {busy && <View style={s.row}><ActivityIndicator/><Text>Working on this device…</Text><Button title="Stop model request" onPress={() => { void model.stop(); }}/></View>}
      {page === 'library' && <>
        <Text style={s.title}>Your learning, available offline.</Text><Text>Install a publisher-signed package once. Read, practice, and ask about its stored blocks without a server connection.</Text>
        <Button title="Import learning package" disabled={!store || busy} onPress={() => { void act(importPackage); }}/>
        {!packages.length && <View style={s.card}><Text style={s.subtitle}>Start here</Text><Text>1. Open Setup and verify your publisher's public key.</Text><Text>2. Import the learning package supplied by the publisher.</Text><Text>3. Import a local GGUF model for explanations and written-answer feedback. Multiple-choice practice works without it.</Text></View>}
        {packages.map(p => <View style={s.card} key={`${p.id}:${p.version}`}><Text style={s.subtitle}>{p.title}</Text><Text>Version {p.version}{p.active ? ' · Selected version' : ' · Installed'}</Text><Button title="Open this version" disabled={busy} onPress={() => { void act(() => enter(p.id,p.version)); }}/></View>)}
      </>}
      {page === 'setup' && <>
        <Text style={s.title}>Setup & privacy</Text>
        <View style={s.card}><Text style={s.subtitle}>Trusted publisher</Text><Text>Obtain the publisher key through a trusted channel. Do not trust a key only because it arrived beside a downloaded package.</Text>
          <TextInput accessibilityLabel="Publisher key ID" placeholder="Publisher key ID" value={keyId} onChangeText={setKeyId} style={s.input} autoCapitalize="none" editable={!busy}/>
          <TextInput accessibilityLabel="Publisher public key" placeholder="Base64 public key" value={keyText} onChangeText={setKeyText} style={s.input} autoCapitalize="none" multiline editable={!busy}/>
          <Button title="Review publisher key" disabled={!store || busy} onPress={() => { void act(async () => {
            const key = fromBase64(keyText.trim()); if (key.length !== 32) throw new Error('An Ed25519 public key must be 32 bytes.');
            const fingerprint = Array.from(nacl.hash(key).slice(0,16), b => b.toString(16).padStart(2,'0')).join(':');
            Alert.alert('Verify this key fingerprint', `SHA-512 prefix: ${fingerprint}\nConfirm it with your publisher before trusting this key.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Fingerprint verified', onPress: () => { void act(async () => { await store!.trust(keyId.trim(),keyText.trim()); setNotice('Publisher key trusted on this device. No private key was imported.'); }); } }]);
          }); }}/>
        </View>
        <View style={s.card}><Text style={s.subtitle}>Local language model</Text><Text>{modelReady ? 'Loaded on this device.' : 'No model loaded in this session.'} The model is not downloaded or replaced automatically.</Text>
          <Button title="Import & load GGUF model" disabled={!store || busy} onPress={() => { void act(async () => {
            const picked = await Picker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true }); if (picked.canceled) return;
            if (!picked.assets[0].name.toLowerCase().endsWith('.gguf')) throw new Error('Choose a .gguf model file.');
            const uri = `${FS.documentDirectory}localmind-${Date.now()}.gguf`; await FS.copyAsync({ from: picked.assets[0].uri, to: uri });
            setModelReady(false); await model.load(uri); await store!.setModelUri(uri); setModelReady(true); setNotice('Model loaded locally. Real-phone quality and memory acceptance still apply.');
          }); }}/>
          <Button title="Load previously imported model" disabled={!store || busy} onPress={() => { void act(async () => { const uri = await store!.modelUri(); if (!uri) throw new Error('Import a model first.'); setModelReady(false); await model.load(uri); setModelReady(true); }); }}/>
        </View>
        <View style={s.card}><Text style={s.subtitle}>Private learner memory</Text><Text>The device remembers concepts needing practice and recent help. This record stays here. It is not uploaded, graded, or shown to faculty.</Text><Button title="Reset learner memory" disabled={!store || busy} onPress={() => Alert.alert('Reset private learning memory?', 'Installed packages remain. Private learner records and unsent observations are removed.', [{text:'Cancel',style:'cancel'}, {text:'Reset',style:'destructive',onPress:()=>{void act(async()=>{await store!.resetLearner();setNotice('Private learner memory reset.');});}}])}/></View>
        <View style={s.card}><Text style={s.subtitle}>Optional research observations</Text><Text>Off by default. When enabled, only package/block references and fixed state–move–outcome flags are queued. No names, raw questions, raw answers, grades, or private learner record are included. Server network logs still need operator privacy controls.</Text>
          <View style={s.row}><Text>{OBSERVATION_URL ? 'Share limited observations' : 'No sharing endpoint is configured'}</Text><Switch disabled={!store || !OBSERVATION_URL || busy} value={sharing} onValueChange={on => { if (!on) stopSharingRequest(); void act(async()=>{await store!.setSharing(on);setSharing(on);setNotice(on ? 'Optional observation sharing enabled. You can turn it off at any time.' : 'Sharing disabled and unsent events deleted. Previously sent events cannot be recalled by this switch.');}); }}/></View>
        </View>
      </>}
      {page === 'study' && session && block && <>
        <Text style={s.title}>{session.content.title}</Text><Text style={s.muted}>Pinned to version {session.content.version} · {modelReady ? 'Local model ready' : 'Reading and MCQ practice available'}</Text>
        <View style={s.card}><Text style={s.subtitle}>Contents</Text>{session.content.modules.map(m => <View key={m.id}><Text style={s.label}>{m.chapter_title} · {m.title}</Text><View style={s.nav}>{m.blocks.map((id,i)=><Pressable key={id} disabled={busy} accessibilityRole="button" style={[s.pill,id===block.id&&s.selected]} onPress={()=>{setBlockId(id);clearBlockState();}}><Text>{i+1}. {session.block(id).title}</Text></Pressable>)}</View></View>)}</View>
        <BlockView block={block}/>
        <View style={s.card}><Text style={s.subtitle}>Ask about this block</Text><TextInput accessibilityLabel="Question about this block" multiline value={question} onChangeText={setQuestion} placeholder="What would you like explained?" maxLength={1000} editable={!busy} style={s.input}/><Button title="Explain using this block" disabled={busy || !question.trim()} onPress={()=>{void act(async()=>{const result=await session.explain(block.id,question);setReply(`${result.explanation}${result.quote ? '\n\nSource: '+result.quote : ''}`);const prev=await store!.learner(block.id,block.revision);await store!.remember(block.id,block.revision,{...prev,clarifications:prev.clarifications+1});lastHelp.current={state:'question',move:'reteach'};if(!result.supported)await store!.record(observation(session,questionId(),block.id,'not_in_source','reteach','not_in_source'));});}}/>{!!reply&&<Text selectable style={s.read}>{reply}</Text>}</View>
        <View style={s.card}><Text style={s.subtitle}>Choose the next useful help</Text><Text>The tutor can only select help that the author included.</Text><View style={s.nav}>{(['definition_miss','procedure_miss','repeated_clarification'] as State[]).map(state=><Button key={state} title={state==='definition_miss'?'Explain more simply':state==='procedure_miss'?'Help with the steps':'I am still confused'} disabled={busy} onPress={()=>{void act(async()=>{const h=await session.help(block.id,state,await store!.learner(block.id,block.revision));lastHelp.current={state,move:h.move};const prev=await store!.learner(block.id,block.revision);await store!.remember(block.id,block.revision,{...prev,lastMove:h.move});if('question'in h&&h.question){setPractice(h.question);setAnswer('');setSelected(null);setFeedback('');}if('block'in h&&h.block)setShownBlock(h.block);if('text'in h)setReply(h.text||'');if('answer'in h&&h.answer)setReply(h.answer.explanation);});}}/>)}</View>{shownBlock&&<BlockView block={shownBlock}/>}</View>
        <View style={s.card}><Text style={s.subtitle}>Practice—not a graded assessment</Text><Text>No course grade is calculated, stored, or sent.</Text>{session.content.questions.filter(q=>q.references.some(r=>r.id===block.id)).map(q=><Pressable key={q.id} accessibilityRole="button" disabled={busy} onPress={()=>{setPractice(q);setAnswer('');setSelected(null);setFeedback('');}} style={s.pill}><Text>{q.body.prompt}</Text></Pressable>)}
          {practice&&<><Text style={s.subtitle}>{practice.body.prompt}</Text>{practice.body.type==='mcq'?practice.body.options!.map((o,i)=><Pressable accessibilityRole="radio" accessibilityState={{checked:selected===i}} key={i} disabled={busy} onPress={()=>setSelected(i)} style={[s.pill,selected===i&&s.selected]}><Text>{o}</Text></Pressable>):<TextInput accessibilityLabel="Practice answer" value={answer} onChangeText={setAnswer} multiline editable={!busy} maxLength={1200} style={s.input}/>}
            <Button title="Check my understanding" disabled={busy||(practice.body.type==='mcq'?selected===null:!answer.trim())} onPress={()=>{void act(async()=>{if(practice.body.type==='mcq'){const result=session.checkMCQ(practice.id,selected!);setFeedback(`${result.understood?'That matches the answer.':'Review this idea again.'}\n${result.explanation}\nAnswer: ${result.correctText}`);await remember(result.understood);}else{const result=await session.checkShort(practice.id,answer);setFeedback(`${result.feedback}${result.missing.length?'\nReview: '+result.missing.join('; '):''}\nSource: ${result.quote}`);await remember(result.understood);}});}}/>{!!feedback&&<Text selectable style={s.read}>{feedback}</Text>}</>}
        </View>
      </>}
    </ScrollView>
  </SafeAreaView>;
}
function BlockView({block}:{block:Block}){return <View style={s.card}><Text style={s.subtitle}>{block.title}</Text><Text style={s.muted}>{block.kind.replace('_',' ')} · revision {block.revision}</Text>{block.kind==='figure'&&<Image source={{uri:`data:image/png;base64,${block.data.png_base64}`}} style={{width:'100%',height:300}} resizeMode="contain" accessibilityLabel={block.data.alt}/>} {block.kind==='table'?<ScrollView horizontal><View>{block.data.rows!.map((row,i)=><View key={i} style={s.row}>{row.map((cell,j)=><Text key={j} style={[s.cell,i===0&&s.tableHead]}>{cell}</Text>)}</View>)}</View></ScrollView>:<Text selectable style={s.read}>{block.text}</Text>}</View>;}
const s=StyleSheet.create({safe:{flex:1,backgroundColor:'#F5F7F4'},header:{padding:18,borderBottomWidth:1,borderColor:'#DFE6DF'},brand:{fontSize:19,fontWeight:'700',color:'#21382E'},title:{fontSize:26,fontWeight:'700',color:'#21382E'},subtitle:{fontSize:18,fontWeight:'600',color:'#21382E'},muted:{fontSize:13,color:'#62746A'},label:{fontSize:15,fontWeight:'600',marginVertical:8},content:{padding:18,gap:16,paddingBottom:40},card:{padding:18,gap:12,backgroundColor:'white',borderWidth:1,borderColor:'#DFE6DF',borderRadius:12},error:{backgroundColor:'#FFF0EE',padding:16,borderRadius:8},nav:{flexDirection:'row',flexWrap:'wrap',gap:8,padding:8},row:{flexDirection:'row',alignItems:'center',flexWrap:'wrap',gap:8},pill:{borderWidth:1,borderColor:'#CBD8CC',padding:12,borderRadius:8,backgroundColor:'white'},selected:{backgroundColor:'#EAF2EC',borderColor:'#236148'},input:{borderWidth:1,borderColor:'#CBD8CC',borderRadius:8,padding:12,minHeight:46,backgroundColor:'white',fontSize:16},read:{fontSize:17,lineHeight:26,color:'#354B40'},cell:{width:165,minHeight:44,padding:10,borderWidth:1,borderColor:'#DFE6DF',fontSize:15},tableHead:{fontWeight:'700',backgroundColor:'#EAF2EC'}});
