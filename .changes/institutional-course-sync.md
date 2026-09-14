# Institutional course synchronization

The previous implementation downloaded authorized module text, stored lessons, quiz lists and selected GET responses at sign-in, foreground/reconnection and ten-minute intervals. It did not support disconnected institutional attempts or upload offline work. Server-side GGUF lesson/quiz generation and stored authoring jobs already existed; this update does not change the model provider.

This increment adds:

- Authorized, version-bound MCQ downloads with identical published questions for students. Immediate-release packages include marking keys; held and scheduled packages do not.
- Device-first attempts, persisted answer drafts, deterministic local marking for immediate-release quizzes, and local pending results. Personal Private Library data is excluded from synchronization.
- Durable read, lesson-view, reading-time and quiz events in a separate per-server/per-student namespace. Content refresh and sign-out do not delete this unsent work. Browser storage uses IndexedDB; native work and course cache use SQLite. Native course-cache migration preserves previous AsyncStorage downloads and replaces each download atomically.
- Stable event IDs, transactional server receipts, owner-bound signed quiz revisions and server-side regrading. Replays do not create another attempt or count reading time twice. Changed questions/rules, revoked access, expired deadlines, exhausted allowances and conflicting open server attempts remain local for review. Device times are recorded as reported evidence and do not override admission rules.
- Local module/book progress and pending quiz results, plus an explicit course synchronization screen. Acknowledged results are retrieved under their server IDs and honor faculty releases. Server analytics update after accepted work is ingested; downloaded analytics refresh with the next successful course copy.
- Authentication initializes the local account scope before opening student pages. Reading time is counted only while the module is visible, not while its retained navigation screen is hidden.

## Updating

Apply migrations `learning.0004` and `learning.0005`, build the frontend with `npm run export:web`, restart the application, and refresh saved offline application files. While connected, visit the course offline screen and refresh the course copy before disconnecting. The institution's backend must already have its configured GGUF file and completed, published lessons/quizzes; a student model download does not configure the institution's authoring model.

## Boundaries

Synchronization runs while the app is open or returns to the foreground; mobile OS suspension is not a background synchronization guarantee. A disconnected device sees its last downloaded permissions and release state. A faculty change cannot arrive until reconnection. Locally displayed results are identified as local until server confirmation. Immediate answer keys on a student-controlled device are not exam secrecy controls.

This is institutional lesson/progress and MCQ synchronization, not a full database clone or offline account administration. Assignments, authoring/publication and newly released held results still require the institution server. Offline doubt answering retains the existing downloaded-model path and local conversation storage. Personal private study is not uploaded.

Browser acceptance exercises offline startup, institution lessons, local immediate/held submissions, persistence, reconnect and response-loss replay. Native TypeScript integration is checked, but physical Android/iOS acceptance still needs device builds. No production deployment or user's Windows installation is changed by pushing this branch.

## Verification

46 Django tests passed, including receipt replay, grade/release regression, complete score-history downloads and ownership checks. Three browser acceptance flows passed: institutional immediate results (including a lost acknowledgement and duplicate-safe retry), held results, and the existing local-model course doubt fallback. TypeScript, production web export and lint completed with zero errors. Physical phone builds remain outstanding.
