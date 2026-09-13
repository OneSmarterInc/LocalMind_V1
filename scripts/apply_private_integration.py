from pathlib import Path
import json,re

def integrate(root:Path):
 def edit(p,fn):
  f=root/p;before=f.read_text();after=fn(before)
  if before==after: raise RuntimeError(f'Expected integration change not found: {p}')
  f.write_text(after)
 def replace(s,a,b,count=None):
  n=s.count(a)
  if n==0 or (count is not None and n!=count):raise RuntimeError(f'Expected {count or "some"} occurrences, got {n}: {a[:90]}')
  return s.replace(a,b)
 edit('backend/config/settings.py',lambda s:replace(s,'INSTALLED_APPS = [','INSTALLED_APPS = [\n    "private_library",',1))
 edit('backend/config/urls.py',lambda s:replace(s,'urlpatterns = [','urlpatterns = [\n    path("api/faculty/", include("private_library.urls_staff")),\n    path("api/student/", include("private_library.urls_student")),',1))
 def api(s):
  s=replace(s,'  cacheOffline?: boolean;','  cacheOffline?: boolean;\n  signal?: AbortSignal;\n  timeoutMs?: number;',1)
  s=replace(s,'    promise = (async () => {\n      try {', '    promise = (async () => {\n      const renew = new AbortController();\n      const renewTimer = setTimeout(() => renew.abort(), 15000);\n      try {',1)
  s=replace(s,'{ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh: started.refresh }) }','{ method: "POST", signal: renew.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh: started.refresh }) }',1)
  s=replace(s,'        if (!res.ok) return false;', '        if ([502,503,504].includes(res.status)) { reportOffline(); throw new ApiError(0, "NETWORK", "The institution server is temporarily unreachable. Local data is retained."); }\n        if (!res.ok) return false;',1)
  s=replace(s,'      } catch { return false; } finally { if (refreshing?.promise === promise) refreshing = null; }','      } catch (e) {\n        if (session !== mine) throw new SessionChangedError();\n        if (e instanceof ApiError) throw e;\n        reportOffline();\n        throw new ApiError(0, "NETWORK", "The server disconnected while renewing the session. Your local study data is retained.");\n      } finally { clearTimeout(renewTimer); if (refreshing?.promise === promise) refreshing = null; }',1)
  old='  let res: Response;\n  try { res = await fetch(url, { method, headers, body: form ?? (body !== undefined ? JSON.stringify(body) : undefined) }); }\n  catch {\n    reportOffline();'
  new='''  let res: Response;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  opts.signal?.addEventListener("abort", cancel);
  if (opts.signal?.aborted) cancel();
  const timeout = setTimeout(cancel, opts.timeoutMs ?? (method === "GET" ? 15000 : 120000));
  try { res = await fetch(url, { method, headers, signal: controller.signal, body: form ?? (body !== undefined ? JSON.stringify(body) : undefined) }); }
  catch {
    if (session !== mine || offlineScope() !== owner) throw new SessionChangedError();
    if (opts.signal?.aborted) throw new ApiError(0, "CANCELLED", "Request cancelled.");
    reportOffline();'''
  s=replace(s,old,new,1)
  s=replace(s,'      if (saved !== undefined) return saved;','      if (session !== mine || offlineScope() !== owner) throw new SessionChangedError();\n      if (saved !== undefined) return saved;',1)
  s=replace(s,'  }\n  reportOnline();','  } finally { clearTimeout(timeout); opts.signal?.removeEventListener("abort", cancel); }\n  reportOnline();',1)
  s=replace(s,'  if (res.status === 401 && auth && retry && tokens) {','''  if ([502,503,504].includes(res.status) && method === "GET") {
    reportOffline();
    if (cacheable) {
      const saved = await readEntry<T>(offlineKey(path, query));
      if (session !== mine || offlineScope() !== owner) throw new SessionChangedError();
      if (saved !== undefined) return saved;
    }
    throw new ApiError(0, "NETWORK", "The institution server is temporarily unreachable. This page is not saved on this device.");
  }
  if (res.status === 401 && auth && retry && tokens) {''',1)
  return s
 edit('frontend/src/api/client.ts',api)
 def guard(s):
  s=replace(s,'  discard: () => void;', '  discard: () => void | Promise<void>;',1)
  s=replace(s,'  if (choice === "extra") { guard.discard(); return true; }','''  if (choice === "extra") {
    try { await guard.discard(); return true; }
    catch (e) { await alertAsync("Your changes were not discarded", errorMessage(e)); return false; }
  }''',1)
  return s
 # Existing multi-guard async discard implementation is preserved.
 edit('frontend/src/auth/AuthContext.tsx',lambda s:replace(s,'setUser(saved); setMustChange(false);','setUser(saved); setMustChange(saved.must_change_password);',1))
 def rootlayout(s):
  s='import ParserHost from "@/private/ParserHost";\n'+s
  return replace(s,'          <DialogHost />','          <DialogHost />\n          <ParserHost />',1)
 edit('frontend/app/_layout.tsx',rootlayout)
 def student(s):
  s=replace(s,'  finder: [','  finder: [\n    { title: "Private library", section: "Your books and local AI", path: "/student/private-library" },\n    { title: "Offline AI", section: "Download or import a local model", path: "/student/offline-ai" },',1)
  s=replace(s,'        <Tabs.Screen name="subjects"', '        <Tabs.Screen name="private-library" options={{ title: "Private library", tabBarIcon: icon("book-outline") }} />\n        <Tabs.Screen name="offline-ai" options={{ title: "Offline AI", tabBarIcon: icon("hardware-chip-outline") }} />\n        <Tabs.Screen name="private-book/[id]" options={shellScreen({ href: null, title: "Private book" }, { backTo: "/student/private-library", backLabel: "Private library" })} />\n        <Tabs.Screen name="subjects"',1)
  return s
 edit('frontend/app/student/_layout.tsx',student)
 def manage(s):
  s=replace(s,'const finder = [','const finder = [\n  { title: "Books for private study", section: "Upload and share books", path: "/manage/private-library" },',1)
  s=replace(s,'      <Tabs.Screen name="books"','      <Tabs.Screen name="private-library" options={{ title: "Private study books", tabBarIcon: icon("library-outline") }} />\n      <Tabs.Screen name="books"',1)
  s=s.replace('title: "Private study publishing"','title: "Books for private study"')
  return s
 edit('frontend/app/manage/_layout.tsx',manage)
 # Only the text of the old launch button changes. Its route now redirects;
 # existing draft guards and job/assessment changes remain exactly intact.
 f=root/'frontend/app/manage/document/[id].tsx'
 if 'Private study publishing' in f.read_text():edit(str(f.relative_to(root)),lambda s:replace(s,'Private study publishing','Books for private study'))
 def module(s):
  start=s.index('function AskTab(');end=s.index('function AskTips()',start)
  s=s[:start]+s[end:]
  start=s.find('\nconst styles = {')
  if start>=0:s=s[:start]+'\n'
  s='import CourseAsk from "@/private/CourseAsk";\n'+s
  s=replace(s,'<AskTab moduleId={id} />','<CourseAsk key={id} moduleId={id} />',1)
  for line in ['import { ApiError } from "@/api/client";\n','import { useAuth } from "@/auth/AuthContext";\n','import { useOnline } from "@/offline/connectivity";\n']:
   s=s.replace(line,'')
  s=s.replace('import type { Message, ModuleFull, Quiz }','import type { ModuleFull, Quiz }')
  s=s.replace('import { useAction, useAsync }','import { useAsync }').replace('{ AppState, ScrollView, Text, TextInput, View }','{ AppState, Text, View }')
  s=s.replace('{ Avatar, Badge, Button, Card, CardHead, Chip,','{ Badge, Button, Card, CardHead,').replace('Screen, Spinner, Split, StepList, TextLink, TileIcon,','Screen, Split, StepList, TextLink,')
  s=s.replace('Saved reading and ready lessons remain available when the server is unreachable. New questions and quiz submissions need a connection.','Saved reading and ready lessons remain available offline. Download a local model in Offline AI to ask new doubts on this device. Official quiz submissions still need the institution server.')
  return s
 edit('frontend/app/student/module/[id].tsx',module)
 f=root/'frontend/package.json';v=json.loads(f.read_text())
 v['dependencies'].update({'@noble/hashes':'1.8.0','@wllama/wllama':'3.7.0','base64-js':'1.5.1','expo-crypto':'~15.0.8','expo-file-system':'~19.0.24','expo-sqlite':'~16.0.10','fflate':'0.8.2','llama.rn':'0.10.0','pdfjs-dist':'4.10.38','react-native-webview':'13.15.0'})
 v['devDependencies'].update({'esbuild':'0.25.9','@playwright/test':'1.55.0','@types/base64-js':'1.5.3'})
 v['scripts'].update({'prepare:private':'node scripts/prepare-private-assets.mjs','postinstall':'npm run prepare:private','prestart':'npm run prepare:private','preweb':'npm run prepare:private','preandroid':'npm run prepare:private','preios':'npm run prepare:private','preexport:web':'npm run prepare:private','postexport:web':'node scripts/build-offline-manifest.mjs','test:private':'node ../tests/private-contracts.mjs','test:private:web':'playwright test -c tests/private.playwright.config.ts'})
 f.write_text(json.dumps(v,indent=2)+'\n')
 f=root/'frontend/app.json';v=json.loads(f.read_text());v['expo']['android']['allowBackup']=False;v['expo']['userInterfaceStyle']='light';v['expo']['backgroundColor']='#F5F7F4';f.write_text(json.dumps(v,indent=2)+'\n')
 # Generated offline resources contain third-party code, not private data. They
 # are reproducibly built from package-lock.json; no model/weights are committed.
 with (root/'.gitignore').open('a') as f:f.write('\n# Integrated private library\nbackend/private-books/\nfrontend/public/private-assets/\nfrontend/src/private/generated/\nfrontend/test-results/\nfrontend/playwright-report/\n')

if __name__=='__main__':
 import sys
 integrate(Path(sys.argv[1] if len(sys.argv)>1 else '.').resolve())
