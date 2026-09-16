# Device generation boundaries and full backend regression coverage

Legacy institutional quiz generation, tutor ask, and remediation service
entry points now reject server generation with LOCAL_AUTHORING_REQUIRED when
DEVICE_AUTHORING_ONLY=true. Existing permission checks run first; held results
remain protected. Rejected doubt requests do not create partial conversations,
and rejected quiz requests do not create drafts.

Central AI monitoring/judging remains independent and enabled according to its
existing settings. The device UI continues to use local generation and sync.

Legacy server-generation tests explicitly opt into DEVICE_AUTHORING_ONLY=false
so they still verify their intended compatibility behavior. New regression tests
exercise the default device-only boundary, including normal MCQ submission.
Device authoring, course sync and central judge tests retain their own mode coverage.

Validation:
- Full Django discovery from backend/: 615 tests passed with AI_ENABLED=false.
- Model calls use controlled mocks/fallbacks; no physical-device performance claim.
- No frontend changes or database migration.

Manual check:
1. Generate a lesson/quiz or ask a doubt through the current device UI.
2. Approve/sync institutional content and attempt a published quiz as a student.
3. Admin Monitoring can still invoke the central judge with its model configured.
4. Old clients using direct generation endpoints get LOCAL_AUTHORING_REQUIRED
   rather than placing generation work on the central model.

Remaining audit includes legacy source restructuring and subjective evaluation.
Physical-device offline/reconnect acceptance remains outstanding.
