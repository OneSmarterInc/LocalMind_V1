# Download, connectivity and lifecycle reliability

Based on `9b20920`, including the preceding navigation fixes. No history is rewritten.

- Web model downloads retain completed 8 MiB parts under the pinned model digest.
  Retry downloads only missing parts; each part has at most three attempts and a
  60-second network inactivity timeout. Slow but progressing transfers continue.
  Servers that ignore Range retain the original streaming download path.
- The existing size/SHA-256 check still runs before switching the installed model.
  Corrupt partial downloads are removed. Cancellation retains completed download
  parts, removes an unfinished installation, and keeps the previous installed model.
  Verification can require two additional model copies temporarily. Storage errors
  are reported explicitly. Web Locks coordinate downloads across tabs when available.
- A slow API endpoint reports TIMEOUT, without declaring the whole server offline.
  Cached reads remain available. Gateway errors no longer emit a false online event
  before going offline. Recovery uses one bounded request with jittered backoff,
  from approximately five seconds to a maximum of sixty seconds between attempts.
- Conversation and quiz restoration ignore results from a previous effect lifecycle.
  Cancellation callbacks are stable. Session and discarded-draft resets are retained.
- Lint now fails on warnings; existing warnings and unused bindings left by the
  navigation changes are corrected.
- The real-model CI failure artifact showed browser storage quota exhaustion.
  That test now records quota and fails promptly on a displayed error. CI explicitly
  allocates a 5 GiB Chromium origin quota for its disposable profile. This does not
  bypass production device limits or mock model bytes, checksums, storage or inference.

Verification: 62 private contracts, 3 authoring race tests, 16 reliability tests,
TypeScript, zero-warning lint, web export, and four focused browser scenarios passed
before the final auth-navigation sync. The added auth-navigation contract is also
run after syncing. The focused browser scenarios cover offline restart, account
isolation, institution-book import, and recovery before a known access denial.

The complete browser suite and real downloaded-model workflow remain acceptance
gates. These changes do not establish physical Android/iOS performance, production
PostgreSQL load capacity, or branch-protection settings.

Pull after preserving any local edits:

```sh
git fetch origin
git switch feature/integrated-private-library
git pull --ff-only origin feature/integrated-private-library
cd frontend
npm ci
npm run test:private
npm run typecheck
npm run lint
npm run export:web
```
