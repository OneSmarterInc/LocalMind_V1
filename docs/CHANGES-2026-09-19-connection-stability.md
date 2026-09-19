# Stable connection status

## Cause confirmed in the client

Any failed fetch, a token-refresh failure, or a GET returning 502/503/504 could
immediately set the application's shared connectivity flag to false. The next
successful API response set it back to true. Background requests could therefore
make the whole interface alternate between connected and offline and repeatedly
trigger synchronization, even when other server endpoints remained reachable.

## Change

A failed request now requests independent reachability confirmation. The app
stays connected while checking. The health endpoint must fail twice, with a
one-second gap, before server-unavailable mode is entered. Each probe has a
five-second timeout; concurrent failures share one confirmation sequence.
Any HTTP response from the health endpoint establishes reachability, including
an HTTP service error. Endpoint errors still surface on the affected operation;
this does not convert a failed operation into success.

A successful API response cancels any pending confirmation. Late results from
cancelled checks cannot change current connectivity. Confirmed outages retain
the existing bounded recovery probes and account-scoped saved-content fallback.
GET timeouts also request confirmation without immediately changing connectivity.
The interface says "Server unavailable" rather than implying internet loss.

Internet connectivity and LocalMind server reachability are different. A stopped,
overloaded, or unreachable server still prevents server-dependent operations.
This change corrects false global transitions; it does not guarantee server uptime
or diagnose the server's actual production load without logs.

## Validation

Five new tests exercise the real connectivity module with controlled transports:
- endpoint failures with a reachable health endpoint, including HTTP 503;
- one failed probe followed by success, with no offline transition;
- a genuine outage and automatic recovery;
- a late failed probe after a successful API request;
- 100 failure reports sharing bounded health requests.

103 focused tests pass in total, including existing offline recovery, API fallback,
private-library, authoring-race, quiz-recovery, doubt-blocking, and authentication
checks. TypeScript, strict lint, and production web export pass. These tests do not
replace browser/device acceptance or production server-log investigation.

## Update

Stop the app and preserve local edits shown by git status:

```powershell
cd D:\MindLocal
git status --short
git switch feature/integrated-private-library
git pull --ff-only origin feature/integrated-private-library
cd frontend
npm ci
npm run export:web
cd ..
.\start.bat
```
