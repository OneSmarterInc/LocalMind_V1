# Keep submitted-quiz redirects within the focused quiz screen

The submission poll introduced in fe7bb14 could outlive the active quiz screen in the retained tab navigator and redirect students away from Subjects or Quizzes. It now runs only during screen focus, ignores asynchronous results after blur, and redirects at most once per focus. Overlapping checks are suppressed. Submission immutability remains unchanged.

Validation: two Playwright institutional quiz scenarios pass, covering immediate/held results, offline submission, refresh, synchronization and sidebar navigation away from the result to Subjects and Quizzes across multiple poll intervals. TypeScript and web export pass; lint has zero errors and seven preexisting warnings. No migration or model download is required.
