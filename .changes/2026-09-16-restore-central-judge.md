# Restore central AI judging

Per user direction, restore the monitoring judge, its readiness reporting,
decision handling and dashboard behavior to before the device-only restriction.
DEVICE_AUTHORING_ONLY controls content authoring, not the central monitoring
judge. Existing AI_ENABLED and AI_MONITOR_JUDGE_ENABLED settings still apply.

Lesson/quiz/doubt device generation and the assignment server-generation guard
are unchanged. No environment settings, model files or database records changed.

Validation: 89 targeted backend tests passed (monitoring, local books, local
authoring, course sync). Judge pipeline, forced review, outage fallback and
adapter tests explicitly verify central judging with device authoring enabled.
Model calls are mocked; real hardware inference was not exercised.

Check: with the existing central model configured and AI/judge enabled, open
Admin Monitoring and re-evaluate an interaction. Its evaluation should record
judge invocation. Device-first mode must no longer disable that judge.
