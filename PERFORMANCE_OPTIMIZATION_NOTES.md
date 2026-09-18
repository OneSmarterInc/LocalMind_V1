# Private Library Generation Performance Pass

Changes in this local test package only (nothing pushed):

- Lesson source passage size: 1600 -> 2800 characters, reducing sequential model calls for longer modules.
- Lesson generation ceiling: 1000 -> 700 tokens per passage.
- Quiz generation ceiling: 700 -> 450 tokens per question.
- Quiz retries: 4 -> 3 per missing question to cap wasted inference on thin/repetitive source.
- Native local inference: fixed 2 threads -> adaptive 2-6 threads, reserving two logical cores when hardware concurrency is available and using a conservative 4-thread fallback otherwise.
- Web inference keeps the existing adaptive 1-8 thread logic. It still requires cross-origin isolation + SharedArrayBuffer to exceed one thread.

Not changed intentionally:

- One model inference lane / Exclusive lock (prevents RAM blow-ups and competing llama contexts).
- Grounding and exact quote validation.
- Checkpoint/resume behavior.
- Device-local privacy model.
- GPU layers remain disabled for portability.

Verification note:
The sandbox dependency installation did not finish within the execution window, so TypeScript could not be fully re-run here because the incomplete node_modules tree lacked Expo/@types packages. Run `npm ci`, `npm run typecheck`, `npm run lint`, and `npm run test:private` on the target laptop before acceptance.
