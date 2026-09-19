# Navigation, editor, and UI audit fixes

Implements source findings from the review of `aa6566c` on `feature/integrated-private-library`.

## Navigation and editing

- Browser history preserves router state and indexes reversible traversals. Guarded Back/Forward restores the original URL before asking Save/Discard/Stay, then applies an accepted traversal once. Known parents use existing history entries; direct-entry links retain a router fallback.
- Native route removal and hardware Back use dirty-editor guards. Draft recovery survives unmounts and is cleared on sign-out/account change.
- Refresh preserves dirty profile, subject, policy, and evaluation edits. Changed resource IDs clear previous request data and ignore late responses.
- Quiz/book tabs synchronize with URL parameters; missing/invalid tabs reset to defaults. Subject filters and account-kind forms follow changed route context.
- Attempt, student-progress, book/module, and local-authoring headers use contextual parents. Admin-origin progress returns to the admin subject; manage-origin progress returns to manage.
- Incomplete account/attempt links display an explanation instead of requesting a wrong or undefined resource.
- Legacy Assignment links transition through the unmatched-route page to the signed-in user's quizzes. Deleted screens are not registered as tabs.

## UI behavior

- Enter activates the focused dialog button, with no global primary-action acceptance.
- Password instructions match the ten-character backend minimum.
- Quiz drafts and library searches have loading/empty/no-match states; stale enrollment-search responses are ignored and dependent query errors surfaced.
- Source corrections have save/discard protection. New quiz generation selects the new version, and the final module has no active Next action.
- Student Read and its offline data include authorized original source figures independently of generated lessons.
- Shorter quizzes retain requested counts and display partial completion.
- Score inputs preserve decimal/blank text. Saving requires an explicit 0–1 score; feedback cannot silently mark an ungraded answer zero.
- System-check timestamps update on successful responses; server AI and device AI availability are distinguished.
- Grid children shrink on narrow screens; sheets/dialogs scroll within viewport bounds. Controls have improved accessibility semantics and arrow-key focus navigation; row actions are separate from navigation buttons.

## Assignment retirement

Removed live APIs, views, serializers, authoring services, frontend API/types, offline downloads, analytics fields, demo generation, and current API documentation. The checked-in OpenAPI schema removes retired endpoints and unused schemas; other endpoint contracts are unchanged.

Historical tables/models and migrations intentionally remain for existing records and safe foreign-key cleanup when owners are explicitly deleted. Django retains this app only for compatibility. Migration `assignments.0005_retire_permissions` removes old permissions and prevents new default permissions. It does not drop historical data. Historical changelogs and faculty-to-subject assignment terminology are separate from the retired student feature.

## Verification

- Django: **633 tests passed**, including retired-API rejection and original-image delivery to student Read/offline data. Retired feature tests were replaced with retirement checks.
- Frontend typecheck, lint, web export passed; offline manifest: 68 assets.
- Private suites: **64 + 3 + 16 passed**.
- Targeted auth/navigation, connectivity, doubts, batch, quiz recovery, PDF layout and generation suites: **40 passed**.
- Additional editor-state regressions: **4 passed**.
- Migration consistency: no missing migrations. OpenAPI references resolve and remaining endpoint contracts match the prior schema.

History/editor tests use deterministic harnesses. Chromium startup was blocked, so live browser Back/Forward, responsive screenshots, keyboard/assistive-technology and native-device checks remain unverified. Real local-model inference was not exercised. No production deployment is included.

## Update an existing checkout

Stop the app and use its activated Python environment:

```powershell
cd D:\MindLocal
git switch feature/integrated-private-library
git pull --ff-only origin feature/integrated-private-library
python backend/manage.py migrate
cd frontend
npm ci
npm run export:web
cd ..
```

Then restart the normal launcher.
