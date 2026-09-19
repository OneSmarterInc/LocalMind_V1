# Authentication navigation stabilization

Reviewed from branch commit `3bd398debf35fa4f882447ab7ba1c8df7f6791ad`.

The root authentication gate withheld the entire Stack whenever a redirect was
needed, then called `router.replace` from an effect. On a cold start this can call
navigation before the root navigator mounts. With an existing session, temporarily
removing the gate's children also unmounts GenerationHost and invokes its job
cancellation cleanup.

The root now waits for session hydration before resolving route permissions, then
uses Expo Router's protected screens for role and password-change boundaries.
The index route redirects from inside the mounted navigator. GenerationHost stays
outside route transitions and only runs for a signed-in, password-ready account.
Admin access to the shared manage workspace is preserved. Backend authorization
remains responsible for API access.

Validation:
- Six component rendering tests cover hydration, signed-out access, student,
  faculty, admin, and mandatory password changes. They use router test doubles;
  they are not browser or native-device acceptance tests.
- The tests run in the existing integration workflow.
- TypeScript check and production web export pass; offline manifest has 68 assets.
- Existing private contracts and three authoring concurrency tests pass.

This is a focused navigation repair, not a claim that every application feature
or local model generation speed has been validated. Real-model performance and
reported quiz failures need their own reproduction and validation.

Update on Windows (stop the running app first):

```powershell
cd D:\MindLocal
git status --short
git switch feature/integrated-private-library
git pull --ff-only origin feature/integrated-private-library
cd frontend
npm ci
npm run export:web
cd ..
.\start.bat
```

If the working tree has local edits or the pull cannot fast-forward, preserve
those edits and reconcile the commits before rebuilding; do not reset them away.
