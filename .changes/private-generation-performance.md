# Private generation performance and recovery

The browser previously forced one CPU thread and discarded all progress from a
multi-part lesson when a later response failed. This update keeps one active
model response, while using up to four CPU threads (half the reported logical
cores, capped at four) when shared-memory browser support is available. The
runtime retains its single-thread compatibility fallback.

Django now sends Cross-Origin-Opener-Policy: same-origin and
Cross-Origin-Embedder-Policy: require-corp, including the offline app responses.
If another server serves the frontend directly, configure those two headers on
that server too. Cross-origin assets need CORS or appropriate CORP permission.

Private doubt retrieval is limited to 1,800 characters of relevant passages,
retains short technical terms such as AI, omits unrelated filler, and includes
recent question history only for likely follow-ups. Answers request at most
120 words with a 420-token output budget. Read content and lesson source coverage
are unchanged. Retrieved source is still checked by the grounding validators.

Validated lesson parts and quiz questions are checkpointed in the student's
existing device database. Keys include the source, model checksum, generation
format version, and quiz question count. Completed outputs keep a stable version
ID across interrupted final saves. Incomplete work never appears as a completed
lesson or playable quiz. Generate again with the same settings to resume after
cancellation, failure, or reload. A new generation after successful completion
creates a new version. Old outputs and personal data are not uploaded.

Browser job notes now distinguish waiting, model loading, and response generation
with elapsed inference time. The three-minute response limit remains; this change
does not promise a fixed completion time or run multiple model responses at once.

## Update an existing installation

Pull the feature branch, rebuild with npm run export:web in frontend, restart
start.bat, and use Offline AI -> Check and save offline app files. Reload the app
after refreshing its saved files. Do not clear site storage. Reimporting books or
redownloading the same model is unnecessary. After the first generation, Offline
AI reports the active CPU thread count.

## Reproducible performance check

The optional Playwright benchmark compares 1 and 4 threads with the same GGUF,
source, question and output constraints. It records model loading separately,
then first and repeated inference, and validates both answers. It is an isolated
threading comparison, not a claim about the tester's hardware or all book topics.

With the browser test dependencies installed, from frontend in PowerShell:

```powershell
$env:LM_E2E_REAL_MODEL = '1'
$env:LM_E2E_BENCH = '1'
$env:LM_E2E_MODEL_FILE = 'C:\Models\Qwen3-0.6B-Q8_0.gguf'
npm.cmd run test:private:web
Remove-Item Env:LM_E2E_BENCH, Env:LM_E2E_REAL_MODEL, Env:LM_E2E_MODEL_FILE
```

Results are written to frontend/test-results/private-performance.json. The test
uses a disposable backend/database, not the tester's accounts or books.

## Measured verification (15 September 2026)

Same Qwen3-0.6B-Q8_0 GGUF (SHA-256
9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031),
same source, question, schema and 420-token budget in Linux Chromium:

| Measurement | 1 CPU thread | 4 CPU threads |
| --- | ---: | ---: |
| Model load | 21.95 s | 19.19 s |
| First inference (uncached prompt) | 92.91 s | 34.49 s |
| Repeated inference (cached prompt) | 22.74 s | 8.33 s |

Both modes returned validated source-grounded answers. The four-thread runtime
reported multithreading active. Inference was about 2.7 times faster in this
controlled example; loading, queue waits, other books, and user hardware differ.
This comparison isolates threading; it is not a full old-build/new-build or
phone benchmark. A separate synthetic three-section retrieval comparison reduced
the same question's reference from 2,164 to 834 characters while retaining the
relevant passage.

56 portable checks passed; 13 Django tests passed (browser headers and course
synchronization). Five distinct browser scenarios passed: private offline study,
immediate/held institutional sync, and lesson/quiz checkpoint recovery across an
offline reload. The recovery tests use a model stub; the threading benchmark uses
the actual GGUF. TypeScript and web export passed. Lint has no errors and seven
existing warnings. Native-device acceptance remains outstanding.

The full real-GGUF browser acceptance also passed with network disabled after an
app restart: new doubt (77.12 s, including cold model setup), lesson (69.87 s),
and one-question quiz generation (68.43 s), followed by local answer marking.
These end-to-end times use a small biology text and are separate from the
controlled threading comparison above. No target Windows/phone timing guarantee
is implied.
