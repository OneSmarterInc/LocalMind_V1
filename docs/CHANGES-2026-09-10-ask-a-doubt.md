# Ask a doubt: review and fixes (10 September 2026)

## How it was checked

The feature was read end to end: the tutor service, retrieval, the gateway, the Ask tab, and how it behaves with background lessons, the AI monitor and this installation's `.env` (`AI_TUTOR_MAX_TOKENS=350`, `OLLAMA_TIMEOUT_SECONDS=300`). Suspected problems were first reproduced with small probes. They then became tests: 6 of the 9 new tests fail on the previous code and all 9 pass now. The other three cover behaviour that was already right and must stay so: off-topic guidance, a model outage, and access rules.

## Already working

- **Grounding.** Answers are built from the module's own passages, and the client cannot inject text.
- **Off-topic questions.** They get guidance to ask about the module instead of an invented answer.
- **Model down.** The student gets a clear "tutor unavailable" message, and their question is kept.
- **Access.** A locked module, another student's conversation, or a module the student is not enrolled on is refused.
- **History.** Conversation history is bounded, and a repeated opening question on the same module is answered from a cache.
- **Priority.** Student questions come before background lesson generation.

## Problems found and fixed

1. **A short follow-up read the wrong passage.** "Why?" or "explain more" contains no searchable words, so retrieval fell back to the first pages of the module rather than the passage under discussion. A follow-up with fewer than two content words is now searched together with the student's previous question.
2. **Singular and plural did not meet.** "What does a villus do?" found nothing in a module that says "villi", and the same was true for plants/plant and digested/digests. Retrieval now compares words after a light stem that covers English plural and verb endings and common Latin science plurals. Stored chunks need no rebuild.
3. **An answer cut off at the length limit became "tutor unavailable".** With this installation's 350-token tutor limit, a slightly long answer was cut off and the identical request repeated, which failed again. A cut-off answer now gets one shorter try, with no follow-up suggestions and more room.
4. **Answers talked about "the source text".** The prompt called the material SOURCE TEXT, and replies came back as "According to the source text, …" or "The passage says …".
   - **Prompt:** it now says TEXTBOOK SECTION and tells the tutor to speak to the student directly.
   - **Answers:** they are repaired the same way as quiz questions, and any leftover reference becomes "this module".
   - **Suggestions:** follow-up suggestions that still mention the text are dropped.
   - **Remediation:** its overview and explanations get the same treatment.
5. **Asking again after a failure stored the question twice.** The thread showed the question twice, and the model saw it both in the history and as the new question. The already-stored question is now reused.
6. **The Ask tab had no way forward after a failure.** The failed question sat there with an error and no retry, and a first question that failed started a new conversation on the next try.
   - **Retry:** the tab now shows an Ask Again button and stays in the same conversation.
   - **Slow answers:** after 15 seconds of waiting it says the tutor is still working and answers can take a minute or two on this computer.

## Verification

| Check | Result |
|---|---|
| Backend unit suite | 370 of 370 (9 new Ask tests) |
| Black-box system test (fake model) | 208 of 208 |
| Frontend `tsc`, `eslint`, web export | Clean (the 2 existing lint warnings only) |

**Not verified with the real model.** None of this ran against Qwen3 1.7B, because the model file is not available here.

## Not changed

- **Lessons.** The lesson prompt still calls the material "source text", so generated lessons can still contain that phrasing. The same wording repair can be applied there.
- **Grounded flag.** The tutor model decides whether a question is covered by the module. A small model sometimes gets that wrong in either direction; the AI monitor is what catches wrong answers.
