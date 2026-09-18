# LocalMind navigation and redirection fixes

Branch: `feature/integrated-private-library`, base commit `050b42b`.
29 files: 26 modified, 3 new. One file must be **deleted** (command below).

Unzip over your repo root so the `frontend/` paths line up.

---

## 1. Copy the files

```powershell
$LM  = "C:\Users\Anshuman\OneDrive\Desktop\Final_Localmind\LocalMind_V1"
$ZIP = "$HOME\Downloads\localmind-nav-fixes"     # where you unzipped this

Copy-Item -Path "$ZIP\localmind-nav-fixes\frontend" -Destination $LM -Recurse -Force
```

`-Force` overwrites the 26 modified files and drops the 3 new ones in place.
Nothing outside `frontend/` is touched.

## 2. Delete the dead file

This is the only deletion. `AssignmentWorkspace.tsx` is 738 lines that nothing
imports any more — the assignment UI was retired and every route became a
redirect shim, but the file was left behind.

**PowerShell:**

```powershell
Remove-Item "$LM\frontend\src\screens\AssignmentWorkspace.tsx" -Force
```

**Git Bash / WSL / macOS:**

```bash
rm -f frontend/src/screens/AssignmentWorkspace.tsx
```

**If you'd rather stage it in git so it shows up in the commit:**

```bash
git rm frontend/src/screens/AssignmentWorkspace.tsx
```

## 3. Rebuild

```powershell
cd $LM\frontend
npm run typecheck
npm run export:web

cd $LM
& "$LM\backend\.venv\Scripts\python.exe" run_localmind.py --host 0.0.0.0 --port 8000 --no-browser
```

Testers must hard-refresh once (Ctrl+Shift+R) or the service worker keeps
serving the old shell.

---

## What changed

### New files

| File | Purpose |
|---|---|
| `frontend/src/hooks/useBackTo.ts` | One rule for every "up one level" control |
| `frontend/src/hooks/useTabParam.ts` | Keeps the selected page tab in the URL |
| `frontend/vercel.json` | SPA rewrite so deep links survive a refresh on Vercel |

### Fixes

**1. The LocalMind logo went to the wrong page.**
`Shell.tsx` used `meta.finder[0].path` as the logo target. This branch put
Private library at the top of the finder list, so the logo sent students to
`/student/private-library` and faculty to `/manage/private-library` instead of
their overview. `PortalMeta` now has an explicit `homePath`, set in all three
layouts. Admin was unaffected and still goes to `/admin`.

**2. Back controls disagreed with each other.**
The breadcrumb used `router.replace`, every in-page "Back to X" button used
`router.push`. Two controls on one page, two different results. Pushing also
grew history forever: books to document to "Back to books" meant the browser's
Back button returned you to the document you had just left. Everything now goes
through `useBackTo`, which replaces the current entry after the unsaved-work
prompt. History length stays constant and Back means "up another level".

Converted: monitor-policies, incident detail, user detail, user import, user
new, subject new, admin content, admin system, manage subject, document detail,
document upload, local-batch, local-authoring, student attempt (4 controls),
student module, QuizWorkspace, PrivateBook.

**3. Two screens could steal navigation.**
`manage/quizzes.tsx` and `manage/study/[id].tsx` rendered `<Redirect>` directly.
Both are retained tab screens: they stay mounted after handing off, so a later
re-render fired the redirect again and pulled the user off whatever page they
had moved to. Both now use the `useFocusEffect` pattern that
`RetiredAssignments.tsx` already documents.

**4. The auth gate mounted screens it was about to redirect away from.**
`Gate` rendered its children, then redirected in an effect, so a protected
screen mounted and fired its API calls for one tick. The redirect target is now
computed synchronously and shared by the effect and the render, so nothing
mounts until the address is correct.

**5. Module browsing is back-able again.**
`student/module/[id].tsx` used `router.replace` for next and previous. Walking
modules 1 to 2 to 3 and pressing Back jumped all the way out to the book. Now
uses `push`.

**6. Page tabs live in the URL.**
`admin/users`, `admin/subject/[id]`, `manage/subject/[id]` and
`student/module/[id]` kept the tab in component state only, so a refresh or a
shared link dropped you on the first tab. `useTabParam` writes it with
`setParams`, which rewrites the current history entry rather than adding one —
so the tab survives refresh and shares correctly, without filling the Back
button with tab changes.

**7. Vercel SPA rewrite.**
`app.json` sets `web.output: "single"`, so `/student/subjects` exists only
client-side. Django (`core.webapp` catch-all) and `deploy/nginx.conf` already
handle that. Vercel would have returned 404 on refresh and on Back/Forward to a
deep link. `frontend/vercel.json` adds the rewrite and marks `sw.js` and
`offline-files.json` no-cache so the service worker can update.

---

## Not changed, on purpose

- **The six assignment redirect shims stay.** They catch old bookmarks. Drop
  them together with the backend `assignments` app once you're sure no tester
  has an old URL.
- **`manage/document/[id].tsx` tab is still local state.** Its tab is derived
  from several sources, not a plain `useState`, so it needs a closer look than a
  mechanical swap.
- **Sidebar tab presses still use `navigation.navigate`** while links use the
  router. Worth a manual Back-button pass across tab-to-tab moves before
  changing it — that one is easy to make worse.
- **The backend is untouched.**

---

## What to test

1. Click the logo as a student and as faculty — you should land on Overview.
2. Books to a book to "Back to books", then browser Back — you should go up, not
   back into the book.
3. Open an old `/manage/study/<id>` link, let it redirect, then navigate away and
   use the app for a minute — it must not pull you back.
4. Sign in, press browser Back, sign out, press browser Back.
5. Open a subject, switch to the Students tab, refresh — the tab should hold.
6. Student module 1 to 2 to 3, then browser Back twice.

`CHANGES.patch` in this folder is the full diff if you'd rather review or apply
it with `git apply`.
