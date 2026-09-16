# Device authoring applies to legacy books

DEVICE_AUTHORING_ONLY defaults to true. Both legacy and newly imported books skip server lesson/automatic-quiz scheduling. Previously queued jobs are not claimed or generated; worker startup and command processing are guarded. Ready stored lessons remain readable. Obsolete pending/generating statuses no longer imply a running central generator. Legacy faculty book-generation endpoints return LOCAL_AUTHORING_REQUIRED rather than accepting a job that will never run.

No existing content, queued records or attempts are deleted. No migration or environment change is required for the default. DEVICE_AUTHORING_ONLY=false is an explicit compatibility mode, not a fallback selected by the application.

Validation: 35 local-book/local-authoring/course-sync tests pass under the default. 37 legacy lesson/automatic-quiz tests pass with compatibility mode explicitly enabled. Full default-mode Django suite and physical-device acceptance have not been run for this increment; legacy server-generation tests will need explicit compatibility configuration as the suite is split by mode.

Remaining platform work: migrate or retire legacy assignment generation and monitoring AI paths; finish cross-device conflict/recovery and platform acceptance; benchmark real local models on supported hardware. This increment covers book lessons and automatic quizzes, not every server AI entry point. Image_Extraction remains separate; no executable packaging or main-branch merge.
