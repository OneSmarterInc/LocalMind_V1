# Source hierarchy and legacy written-answer grading

In device-first mode, book outline construction uses the complete source
hierarchy, including legacy imports configured with outline_strategy=ai.
Both the orchestrator and direct AI outline helper avoid server inference.
The existing source headings and section mapping remain intact.

Existing written-answer submissions are preserved and marked pending faculty
review without invoking the central generation model. Blank answers keep their
deterministic zero score. Faculty score overrides can complete grading.
This is legacy-data handling, not a new local subjective-grading feature.
MCQ evaluation remains deterministic. Central AI judging is unchanged.

Regression tests cover full source preservation and a written submission through
pending status to faculty grading, asserting no model gateway call. Legacy AI
outline/evaluator tests explicitly select compatibility mode.

No frontend changes, environment edits or database migration.
Physical-device/model-performance acceptance and broader UX cleanup remain.

Validation: full backend suite passed, 617 tests (AI_ENABLED=false; controlled
model mocks). No real-model performance test was performed.
