# Real-model acceptance evidence

The real GGUF browser test no longer labels every run as a fixed Qwen model on
Linux. It records actual host and browser details, commit, and the supplied file
name, size and SHA-256 (or explicitly identifies the catalog-download path).
A header check catches invalid local files before import. Authentication also
persists the session identifier, matching the normal test sign-in flow.

Stage timings and errors are attached to the Playwright report even on failure;
completed doubt/lesson timings remain available if later generation fails.
The test waits for automatic app-file preparation instead of using the old
manual action. Its overall deadline now accommodates the individual download,
offline preparation and three generation deadlines.

Windows benchmark instructions are in docs/DEVICE_ACCEPTANCE.md. This change
improves evidence collection; it does not claim faster inference or establish
real-device performance. No real GGUF was available in this workspace.

The complete browser run also exposed a shared-fixture dependency: an earlier
source-conflict scenario invalidated the lesson used by automatic offline
preparation acceptance. That acceptance now has a dedicated published source and
ready lesson so it can verify the saved content independently of authoring tests.
