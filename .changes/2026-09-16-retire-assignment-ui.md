# Retire the separate Assignments UI

Removed assignment navigation/search entries, admin content shortcut, subject
creation action, and dashboard assignment fetching/reminders. Faculty pending
quiz grading now links to Quizzes. Old assignment list/detail/create/submission
routes redirect to the appropriate Quizzes screen only while focused, avoiding
retained-tab navigation traps.

Existing backend assignment records and compatibility APIs are preserved; this
increment removes the active UI, not historical data.

Validation: TypeScript and web export passed. Lint: zero errors, seven existing
warnings. Student and faculty browser scenarios cover old links, navigation away
after redirection, and absence of dashboard assignment requests.

Remaining: physical-device offline/reconnect acceptance, performance measurements,
and further quiz/status UX review. Central AI judging is unchanged.
