# Quiz generation retry reliability

## Confirmed defects

The device quiz service retried missing questions using nested loops that could
repeat the first passages when no questions passed validation. For a three-question
request, permanently failing output could cause 14 inference calls. Exceptions
other than a few string-matched errors were swallowed and ultimately reported as
insufficient source, even when the actual problem was runtime failure.

## Changes

- Retain fast three-question batching for successful requests.
- Use a single bounded attempt budget; a three-question, single-passage request
  now permits at most six calls. Advance through untried passages after rejection.
- Switch to individual questions after invalid/truncated batches, feed back the
  validation reason, and allow 650 tokens for an individual response (previous
  repair calls allowed 450).
- Split oversized context on at most two reductions, without dropping remaining
  source passages. Preserve genuine runtime errors instead of blaming source text.
- Check cancellation and session ownership immediately after inference and save
  each accepted question separately. Storage errors propagate immediately.
- Preserve existing checkpoint keys, quiz version format, grounding checks,
  duplicate checks, and review-before-synchronization behavior.

## Verification

Twelve controlled service regression tests exercise batching, rejected questions,
truncation, passage coverage, bounded retries, runtime errors, context reduction,
storage failures, cancellation, account changes, and resuming saved questions
through a fresh service instance. These tests mock inference and storage; they
are not a real-model quality or latency benchmark. The source text and inference
logs for the screenshot's failing module were not available, so its exact model
failure has not been established.

## Remaining architectural requirement

This patch does NOT make inference continue after the browser/app closes.
Generation uses the on-device model inside the application. Saved source/model
can be used without internet, and existing checkpoints support resumption, but
closing that process stops inference. Unsaved module source may still require a
server download. Automatic book preparation currently depends on opening the
book; previously failed entries still require an explicit retry.

Continuous generation while the UI is closed requires a durable worker in an
independent local service or on the server. Existing backend jobs do not implement
this device-authoring draft workflow; server authoring is disabled by the default
DEVICE_AUTHORING_ONLY policy. Moving it must retain ownership, content revisions,
review gates, duplicate prevention, cancellation and restart recovery. This patch
does not enable server authoring or silently transfer private books.

No guarantee of zero model failures or real-device speed improvement is claimed.

## Concurrent change integration

Upstream 1060f94 arrived during publication with citation-reference encoding in
the device runtimes and server generation, plus overlapping retry improvements.
Its citation optimization is retained. The consolidated retry loop retains its
passage rotation, validation feedback and avoidance of repeated empty-slot work.
Existing generation tests are updated for the new error text and the faster
two-call alternative-passage recovery.
