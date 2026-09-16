# Faculty module review UX

Institution lesson/automatic-quiz snapshots now load in the module review screen, under existing faculty/admin authorization. Stale-source lessons are excluded. The book table labels institution status separately from saved device drafts and opens the selected module directly.

Module quizzes now request a chosen 1–6 questions (default six), distributed across source parts, rather than one question per part. Existing quizzes remain unchanged; interrupted legacy checkpoints retain their plan. Local draft review has question counts and previous/next navigation. Source text is collapsible, completed job rows are hidden, and approval/synchronization remains explicit.

Validation: 11 Django local-authoring tests; four targeted Playwright scenarios with controlled local inference; TypeScript, lint (zero errors, seven existing warnings), and web export. Browser checks cover offline generation, six-question navigation, institution lesson loading, conflict recovery, batch generation, and automatic source preparation. Real-model quality/performance and physical device acceptance were not measured.

Scope: institutional quiz snapshot is the existing module automatic quiz, not all manually created assessments. This change does not remove remaining legacy server AI actions, deploy the application, or merge Image_Extraction.
