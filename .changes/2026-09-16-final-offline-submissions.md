# Final offline quiz submissions

A locally submitted institutional quiz now reopens its saved submission instead of starting another editable attempt. The device service checks durable submission events before resuming or creating an attempt, including recovery when the event was saved before its attempt record. The quiz screen checks on entry and while open, removes editing state after submission, and stops unsaved-answer warnings after finalization. Original submitted answers remain immutable in the existing idempotent submission path. Quiz submission checks are scoped to the signed-in account and server.

Validation: TypeScript and web export passed; lint has zero errors and seven existing warnings. Two Playwright institutional quiz scenarios passed (immediate and withheld results), covering offline submission, reopening the quiz route, refresh, reconnection, reopening after synchronization, and one server attempt after synchronization retry. No database migration is needed.

Scope: this closes reopening of submissions stored on this device. It does not change server attempt policies for other devices or private practice regeneration. Locally submitted course quizzes route to review even where the downloaded allowance previously permitted additional attempts.
