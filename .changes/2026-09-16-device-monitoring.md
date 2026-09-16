# Device-first monitoring and legacy assignment generation

DEVICE_AUTHORING_ONLY=true now prevents both monitoring judge inference and
legacy assignment generation from calling the central model. Forced monitor
re-evaluations still run deterministic validators and retain the existing
incident/review workflow. The judge adapter itself also rejects direct calls,
and its readiness check avoids probing a server AI provider in this mode.

Admin monitoring explains that deterministic checks and faculty review are
active instead of showing an unavailable-model warning. Ambiguous evidence
remains undecided rather than being represented as model-verified.

The legacy assignment creation screen no longer advertises device AI while
calling a server endpoint. Manual creation and existing records remain usable;
this change does not implement local assignment generation.

Validation:
- 97 Django tests passed: ai_monitor.tests, assignments.tests,
  documents.tests_local_authoring, learning.tests.test_course_sync.
- Frontend TypeScript check passed.
- Frontend lint: zero errors; seven existing warnings.
- Real-model performance and full multi-device acceptance were not tested.
- Legacy judge/fallback tests explicitly opt into compatibility mode.
  The complete backend suite still needs a device-default compatibility audit.

Check after updating:
1. Admin monitoring shows Content checks with the device-first explanation.
2. Re-evaluate content: validators run without loading the central judge model.
3. Faculty assignment creation has manual task authoring only.
4. Local lesson/quiz generation, approval and synchronization remain available.

Remaining: finish auditing other legacy server-inference entry points and
verify the full faculty-to-student offline/reconnect workflow on physical
devices. No desktop executable work is included.
