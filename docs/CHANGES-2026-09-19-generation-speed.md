# Generation speed: 19 September 2026

## Follow-up: reported slowdown

The Q-reference encoding described below has been rolled back after a user reported slower generation. It added prompt markers and instructions without real-model timing evidence. Browser, native and backend generation again use the prior citation format. Reduced quiz repair retries and device timing logs remain. Generation still runs on individual devices when device-only authoring is enabled. The rollback removes a suspected regression; the cause and speed recovery require measurements on an affected laptop. The original change notes below are historical.


## Evidence

Device-only authoring is enabled in the supplied configuration. Lessons and quizzes run on the device; the Python log primarily records the independent AI monitor. Recorded monitor calls take about 10–93 seconds; model loading takes about 1.5–2 seconds. Waitress also reports queued requests. These observations do not establish browser quiz generation time or its failure reason.

Fast mode is already enabled. Uploaded configuration and credentials are not committed. No configuration values were changed.

## Changes

- Browser/native generation encodes existing source-constrained quotation choices as short Q references. Original source remains in the prompt, with reference markers; exact quotes are restored before validation and persistence. This reduces citation output and grammar size for lessons, private quizzes, faculty authoring and other grounded device calls. Content and output limits are unchanged.
- Backend lessons and the shared manual/automatic quiz generator use the same reference approach. Long source sentences are divided into exact phrases; later phrases remain available. API and saved record formats stay compatible.
- Quiz repairs include the validation reason. After two failed repairs for one item, the code stops repeating them for every missing slot. The next round tries another passage from the same module. An entirely invalid three-question request takes at most six calls instead of fourteen. Valid questions retain validation and checkpoint saves.
- Browser/native completion logs report elapsed milliseconds and output character count without source, prompt or response contents. Browser logs appear in developer tools under `[LocalMind AI]`.

## Verification and limits

74 backend tests cover citation restoration, lesson jobs, manual and automatic quizzes, and monitor release gates. 93 frontend tests cover private contracts, authoring races, reliability, generation and references. TypeScript, lint and web export pass.

Tests use deterministic model fixtures. No GGUF model is available in the workspace: actual wall-clock speedup and real-model content quality have not been benchmarked. Native execution and live browser inference need a device test. Semantic correctness still depends on the model and existing checks.

The changes reduce generated citation text and failed repeat work. Concurrent browser and monitor workloads can still compete for CPU resources. GPU acceleration is not automatically enabled because device support is unknown.

## Apply on this Windows installation

Stop LocalMind with Ctrl+C, then run in PowerShell:

```powershell
cd "C:\Users\Anshuman\OneDrive\Desktop\Final_Localmind\LocalMind_V1"
git pull --ff-only origin feature/integrated-private-library
cd frontend
npm run export:web
cd ..
.\start.bat
```

No new packages or migrations are required. Refresh the browser after restart. Measure the same module and question count using the browser's `[LocalMind AI]` timing logs. Previously saved content stays available; new generations use the updated path.
