# Consistent single-submission quiz status

Overview, Progress, the quiz list and module actions now share the same
submission rule. Offline pending submissions, held results, zero scores,
failed scores and completed attempts no longer count as quizzes ready to take.
Legacy retry allowances no longer control dashboard counts.

Removed the module's Attempts allowed row. Its quiz action now says View
submission when already submitted. This is presentation consistency; existing
submission locks and central AI monitoring remain unchanged.

Validation: TypeScript, web export and lint passed (seven existing warnings,
zero errors). Six submission-state checks include failed and zero-score quizzes.
Offline immediate/held browser scenarios now also check the dashboard before
synchronization, alongside restart, immutable submission and reconnect checks.
No real-model or physical-phone performance claim.
