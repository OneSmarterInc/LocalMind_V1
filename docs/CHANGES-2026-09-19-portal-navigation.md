# Portal navigation repair

## Cause and correction

In-page parent buttons and header breadcrumbs share `useBackTo`. Its known-browser-history path worked in simulations, but its direct-entry fallback called `router.dismissTo`. Expo emits `POP_TO` for that call. The installed Expo tab wrapper does not handle it, so refreshed/direct-entry pages could ignore the button.

The initial audit also tested `REPLACE` against the plain tab router and classified it as unsupported. Deeper integration inspection corrected that conclusion: Expo supplies an adapter for `REPLACE`, but it uses the destination tab index to trim history. Returning to the first tab can append a history entry instead of replacing the completed form. Expo's Tabs wrapper also overwrites an `UNSTABLE_router` prop supplied by the application.

The portals now use the public `withLayoutContext` integration with the same bottom-tab navigator and existing ShellTabBar. This allows the application router adapter to receive actions. Hidden screens remain hidden through the shell's existing `href=null` filter.

The adapter translates `POP_TO` and `REPLACE` through the installed tab router, then preserves the intended history semantics. All other actions delegate unchanged. Full history retains parameters for individual visits. Same-portal completion redirects therefore work without rewriting each upload, save, deletion and submission handler. Root-stack authentication redirects are unchanged.

## Parent controls covered

- Admin: People, Subjects, incidents, monitoring policies and administration overview.
- Admin/faculty content workspace: Books, outline/module authoring, Subjects, student progress, Quizzes and Attempts.
- Student: subject/book/module pages, quiz/results pages and Private Library.
- Shared shell breadcrumbs and Cancel controls using `useBackTo`.

Account creation/import breadcrumbs now retain the faculty/student filter. Batch preparation without a document ID shows a Books fallback and avoids requesting an undefined document.

## Verification

48 navigation/authentication/editor tests pass, including the actual installed tab router and Expo adapter, all three portal layouts, direct-entry parent routes, contextual filters, replacement history, unknown actions, Stay, and simulated browser Back/Forward.

The private-study test suite, TypeScript, lint and production web export pass. CI now runs the navigation tests and no longer invokes the citation-reference test deleted by the earlier rollback.

These are router-level and simulated-history checks, not a live browser click-through. Verify refresh/direct-entry Back to books, Save/Discard/Stay, account-kind context, quiz submission and browser Back/Forward on the served application after updating.

## Update

Stop the server, then run:

```powershell
cd "C:\Users\Anshuman\OneDrive\Desktop\Final_Localmind\LocalMind_V1"
git pull --ff-only origin feature/integrated-private-library
cd frontend
npm run export:web
cd ..
.\start.bat
```

Refresh the application in each browser. No dependency installation or database migration is required.
