# Quiz generation: chosen modules only, real options, readable questions (10 September 2026)

## What was wrong

**Chosen modules were not covered.** A quiz built from several chosen modules joined their text and cut it at the prompt budget from the front. Later modules were often never shown to the model, although the screen said the text was "sampled evenly".

**Other modules leaked in.** The "do not repeat" list sent to the model included questions from earlier quizzes that shared any module with this one. A small model tends to echo what it is shown, so those questions could steer it towards modules nobody selected.

**Replies were cut off and retried pointlessly.** The whole quiz was requested in one reply. On a laptop CPU, ten questions ran out of output room, the reply was cut off, and the gateway repeated the identical request, which was cut off again. The field log showed 7 of 11 minutes lost this way.

**Failures produced placeholders.** When generation failed, the quiz was created anyway with options reading "[Placeholder distractor 1 — edit before publishing]" and questions like "Which statement from '…' is correct?".

**Prompts taught the wording faculty dislike.** The prompt labelled the material "SOURCE TEXT", and the model echoed it: "According to the source text, …".

## What it does now

**Scope.** Questions are written only from the modules the quiz is built on: the ticked modules, the single module, or a chapter's modules. Each question stores its `source_module_id`.

**Spread across modules.** When at least as many questions are requested as modules are ticked, every module gets at least one. The rest follow how much text each module has. No module is asked for more than its text supports: about one multiple-choice question per 250 characters and one open-ended question per 500.

**Small batches.** At most 3 multiple-choice or 2 open-ended questions are requested per model call, each call reading its own slice of its module, with a matching output limit. A cut-off reply is split in half and asked again rather than repeated. If the model is unavailable or times out, the request stops at the first failure instead of waiting through every batch.

**Checks on every question.**

1. **Wording.** References to the material are repaired where possible: "According to the source text, where…" becomes "Where…", and "…, as mentioned in the text?" loses the phrase. Questions that still depend on "the text" or "the passage" after repair are dropped.
2. **Options.** A question must have four distinct options. It is dropped if any option is blank or filler: "Option A", a bare letter, "All of the above", "None of the above", "Both A and B", "N/A", or bracketed text. Letter prefixes such as "A. " are removed.
3. **Answer letter.** Options are shuffled, so the correct answer is not always the model's favourite letter.
4. **Explanations.** Letter references like "Option B" become the option's own words, and sentences about "the text" are removed.

**Top-up.** Modules that come back short get one more round.

**Placeholders.** The generator no longer produces them.

- **Nothing usable:** if not a single question could be written, the request returns 503 `QUIZ_GENERATION_FAILED` and no quiz is created.
- **Some usable:** if fewer questions than requested could be written, the quiz keeps the ones that passed, and the new quiz screen says what fell short and why.

**The prompt.** It now calls the material a textbook section and tells the model to write questions as they would be printed in an exam, never mentioning the text, passage, source, section, excerpt, module or author.

**Previous quizzes.** Earlier questions are used only to drop repeats. Only earlier questions about the same module (matched by module id, or by their quote appearing in that module's text) are shown to the model.

## Screens

- **Quiz builder.** The hint describes how questions are spread across the ticked modules. The old "placeholder draft" notice is replaced with a truthful one, and while questions are being written it says roughly how long this takes.
- **New quiz notes.** A quiz created with a shortfall shows the generator's note when it opens.
- **Older drafts.** Fallback drafts still carry their old warning and still cannot be published until edited.

## Verification

| Check | Result |
|---|---|
| Backend unit suite | 361 of 361 (16 new generation tests) |
| Black-box system test (fake model) | 208 of 208, including a selection quiz drawing on exactly its two modules, no placeholder or "source text" wording, a clean 503 with nothing created when every reply is unusable, and a clean 503 while the model is down |
| Frontend `tsc`, `eslint`, web export | Clean (the 2 existing lint warnings only) |

**What the new tests cover.**

- **Scope:** prompts contain only the chosen modules' text, and every chosen module contributes.
- **Leaks:** earlier questions about unchosen modules never reach the prompt.
- **Batching:** long modules are asked in batches over different slices, and short modules are not over-asked.
- **Failures:** an unavailable model stops after one call, and cut-off replies are split.
- **Quality:** filler options and "the passage" questions never survive, and shuffled options keep the right answer.
- **Students:** a published generated quiz shows students four real options per question.

**Not verified with the real model.** None of this ran against Qwen3 1.7B, because the model file is not available here. Question quality on your laptop is the thing to look at next.

**Expected timing on the laptop in the field log** (about 7 tokens per second): roughly one minute per three multiple-choice questions, so a ten-question quiz takes about 5 minutes, against 11.5 minutes before.

## Note for this installation

The field log showed quiz calls with output limits of 1,260 and 420 tokens, which the code received here never produced. If quiz generation was changed locally, this release replaces `backend/assessments/services/generation.py` and those changes will be overwritten.
