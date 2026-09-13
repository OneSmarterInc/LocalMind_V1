# Requirements implementation status

This branch adds working source paths for the private-study authoring/package/runtime
flow; it is not a production-completion claim. The earlier classroom app remains intact.

Implemented source: stable typed block revisions; reviewable raster figures and PDF/DOCX
candidate extraction; referenced MCQ/short-answer authoring; explicit upstream model
configuration and review proposals; human approval; bounded signed immutable packages;
independent SQLite/native model runtime; bounded Q&A and rubric feedback; five available
teaching moves; private learner state; off-by-default flag-only observations; aggregate
policy proposals; persistent parsing/grading jobs; eligibility checks; targeted UI draft fixes.

The existing Increment 1 changes and its regression-test corrections are included.
Current classroom grades are not reinterpreted as private practice, and the default pass
threshold is not retroactively changed. Published study packages contain no student records.

Still outstanding: actual phone spike measurements and final device/package decisions;
real-model pedagogical validation; actual Android/iOS and desktop acceptance; authored
aids/bank review for real courses; privacy/logging/retention/iOS-backup deployment review;
legacy pre-user data import; complete historical OpenAPI annotations; full figure coverage
validation. CPU budgets, source limits and supported native models remain experimental.

Use actual CI output for executed test results. Tests with controlled model responses
validate contracts and failures, not the quality of a real model's teaching.
