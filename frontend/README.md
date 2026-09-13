# LocalMind Client

Expo (React Native) app for iOS, Android and web, built against the LocalMind backend's three portals. One codebase, three experiences: students read, learn with the tutor, take quizzes and submit assignments; faculty publish books, review outlines, author assessments and evaluate; administrators run people, subjects and the audit trail. Administrators can also step into the faculty experience (the "Content workspace" link at the foot of the sidebar), because the backend lets admin tokens use the faculty portal.

## Run

```bash
cd frontend
npm install
EXPO_PUBLIC_API_URL=http://192.168.1.20:8000 npx expo start     # then press i / a / w
```

`EXPO_PUBLIC_API_URL` points at the backend; it falls back to `extra.apiUrl` in `app.json` (`http://127.0.0.1:8000`). On an Android emulator `127.0.0.1` is rewritten to `10.0.2.2` automatically; on a physical device use the machine's LAN address. For a web build the backend's `DJANGO_CORS_ALLOWED_ORIGINS` must include the dev server origin (`http://localhost:8081` by default).

`npm run typecheck`, `npm run lint` and `npm run export:web` (static web bundle into `dist/`) are the checks that run clean in this repository. For installable Android and iOS builds see `MOBILE_BUILD.md`; `npm run build:android` and `npm run build:ios` go through EAS, and the generated `android/` and `ios/` projects are there for local builds.

## How it is put together

`src/api/client.ts` is the only place that talks HTTP. It resolves the base URL, attaches the bearer token, retries once after a transparent refresh on 401, blacklists nothing itself (the server rotates), and turns every backend error envelope into an `ApiError` with `code`, `status` and `details`. `src/api/endpoints.ts` is a thin, typed map of every endpoint the screens use, split into `auth`, `student`, `manage` (faculty portal, also used by admins) and `admin`. `src/api/types.ts` mirrors the backend's response shapes.

`src/auth/AuthContext.tsx` owns the session: it restores tokens from storage on launch, verifies them with `/auth/me/`, tracks `must_change_password`, and runs the heartbeat every four minutes while the app is in the foreground (the server closes sessions after ten minutes without one). The root layout's `Gate` component reads that state and routes: no user → `/login`; flagged → `/change-password` and nothing else; otherwise the group for the role, and any attempt to open another role's group is bounced.

Screens live under `app/(student)`, `app/(manage)` and `app/(admin)`, each a tab navigator with hidden detail routes. They are deliberately thin: a `useAsync` call for data, `useAction` for mutations, and the shared components in `src/ui` for layout. Nothing computes a pass mark, a score, elapsed time or a permission on the client; every one of those comes from the server, and the screens only render what they are given.

## Look and feel

The client uses one design system, `src/ui`, and every screen draws from it, so a colour or spacing change is a single-file edit. `theme.ts` holds the palette (deep navy canvas `#080F13`, lifted navy surfaces, teal `#25D0AA` for anything primary or active, blue, violet and amber for secondary emphasis), the two-stop gradients, spacing, radii and breakpoints. `Gradient.tsx` wraps `expo-linear-gradient` so no screen imports it directly; the brand mark, primary buttons, progress bars, stat tiles, the desktop sidebar and the login backdrop all use presets from `theme.gradients`.

`Shell.tsx` gives the three portals the same chrome. On viewports of 960px and wider the tab navigator is positioned on the left and rendered as a 264px sidebar with the brand, the portal name, the tab list, an optional cross-portal link and a local-AI status card. Below that width the same tabs render as a dark bottom bar. The header is custom too: a back arrow when there is somewhere to go back to, the page icon and title, the portal name as subtitle on desktop, and a user pill on the right that opens profile, change-password and sign-out. Because the shell is supplied through `useShell()` in each group's `_layout.tsx`, screens never render their own chrome; root screens whose title already appears in the header no longer repeat it in the body.

`index.tsx` exports the components screens compose: `Screen` (responsive gutters of 34, 24 or 18px and a 1100px content cap so cards line up with the header title), `Card`, `Grid`, `Row`, `PageHeading`, `Stat` (tinted icon, value, optional helper), `ProgressBar`, `ListRow`, `Button` (gradient primary, bordered secondary, danger, ghost), `Input`, `Chip`, `Badge`, `Notice`, `ErrorBanner`, `Empty` and `Loading`. All of them are dark-theme only; there is no light variant yet.

## Behaviours worth knowing

Reading time is accumulated on the module screen in five-second ticks while the app is foregrounded and flushed to `POST /student/modules/{id}/time/` every minute and on leaving the screen. The server clamps each chunk, so the client posts often rather than once.

The quiz screen resumes an open attempt if one exists, shows a countdown when a time limit is set, warns about blank answers before submit, and routes to the result. Results with written answers awaiting evaluation are shown as pending; pull to refresh later.

The faculty outline editor preserves ids on every chapter and module it round-trips, which is what lets the backend update in place instead of recreating rows. Reordering, adding and removing are enabled while the book is under review; once published, structure is frozen and the same screen switches to per-module text edits. Modules can be mapped to a parsed heading or given pasted text; ones with neither are flagged and cannot be opened or published.

Quiz editing after attempts exist creates a new version server-side; the screen follows the new id. Quiz generation never produces placeholder questions: when the tutor cannot write them the request fails and nothing is created, and a shortfall is shown as a note on the new quiz.

Uploads use `expo-document-picker` and send multipart with the picked file; on web the `File` object is appended directly, on native the `{uri, name, type}` triple.

## What is not here yet

Date and time inputs for `available_from` and `due_at` are plain ISO text fields. Tokens are kept in the device keychain/keystore through `expo-secure-store` on iOS and Android and in `AsyncStorage` on web. There is no offline cache; every screen fetches on focus. Push notifications, a light theme and localisation are not implemented. None of these need backend changes.
