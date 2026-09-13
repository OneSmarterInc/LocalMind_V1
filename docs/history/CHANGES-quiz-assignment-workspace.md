# Quiz and assignment workspaces, collapsible navigation (September 2026)

Three things, in the order they were built.

## 1. Quizzes and assignments can be written from several chosen modules

`Assessment` and `Assignment` each had a single `module` and a single `chapter`
foreign key, so a quiz covering "momentum, impulse and the third law" had
nowhere to live: picking the chapter dragged in eleven other modules.

Both models gain a `source_modules` many-to-many and a new `selection` kind.
`_target()` in `assessments/services/assessments.py` and `assignments/services.py`
now resolves a list of module ids, sorts them in book order, joins their text
for generation, and keeps `chapter` set when every chosen module shares one
(null when they span chapters) so existing chapter-scoped queries and analytics
still find the row. A list of one resolves back to a plain module quiz, so
nothing downstream changed shape.

Student visibility: a selection quiz stays hidden until **every** module it
draws on is open. A student who has reached the third of five modules would
otherwise meet questions on material they have not been given.

Regeneration excludes questions asked by the last five quizzes over the same
module set, so generating twice over one selection does not repeat itself.

## 2. Results can be shown, held, or scheduled

`results_release` on both models takes `immediate` (what the product always
did), `held`, or `scheduled` with a `results_release_at`. Grading is unchanged
in every mode: the withholding happens on the way out, in the student submit,
attempt read, scores list, assignment list and submissions list.

Scheduled release needs no scheduler. The backend compares the time when the
student reads, so it works on the one-process launcher as well as on systemd.

`POST /api/faculty/quizzes/{id}/release-results/` and the assignment equivalent
release everything held, or one attempt or submission with `attempt_id` /
`submission_id`. Releasing is one way: a student who has seen a score cannot
unsee it, so there is no un-release.

Migrations: `assessments.0002`, `assignments.0002`. Run `manage.py migrate`.

## 3. Navigation collapses; the workspaces fill the window

The 264px rail was permanent on desktop, which left too little room for a list
beside an editor. It is now a drawer: the tab bar takes no layout space, the
header carries a hamburger, and choosing a destination closes it. Phones keep
the bottom bar.

Quizzes and assignments each became one screen: the list on the left, the open
item on the right with tabs. For a quiz those are Questions (the editor,
unchanged, with the tappable letter keys), Sources, Settings including the
results control, and Attempts with per-student release. For an assignment:
Brief, Sources, Settings, Submissions. All six existing routes still work and
land in the workspace with the right thing selected.

The book screen lost its source-heading picker, replaced by plain Move up and
Move down controls. `src/ui/HeadingPicker.tsx` is now unused and can be deleted
once you are sure you do not want it back.

## Verification

Backend: 235 tests (21 new covering selections, visibility with a locked
module, withholding on submit and on read, faculty release, single-attempt
release, scheduled release opening by itself, and a student being unable to
release their own). Migrations in sync, `check --deploy` clean.

Frontend: `tsc --noEmit`, `eslint app src` and `expo export --platform web`
clean. Then driven headlessly against a live server: the drawer opens and
closes, a three-module quiz was built through the picker with results held, a
student attempt came back with no score, the release strip appeared, releasing
from the UI made the score visible to the student, and a two-module assignment
was created with a scheduled release. No page errors in any of it.

## Still to decide

The Sources tab is read-only on an existing quiz or assignment. Changing what
something is written from does not rewrite its questions, and silently editing
the set while the questions stay put would misrepresent them. Generating a new
one is the honest path; if you want in-place regeneration from a changed
selection, that is a separate piece of work.

# AI Monitoring & Guard (September 2026)

Implements `AI_Monitoring_Guard_PRD_v2`: a new `ai_monitor` app that evaluates
every tutor answer and AI-generated quiz independently of the tutor model.
Deterministic validators run first; a judge model (the app model by default,
or a dedicated 7-8B GGUF via `AI_MONITOR_MODEL_FILE`) is consulted only for
suspicious, undecided or sampled cases; per-issue-type policies decide when a
verdict becomes an incident. Admins get an "AI Monitor" tab (overview, model
health, incident queue, side-by-side incident view with review controls, policy
editor); faculty get a scoped review API. New commands: `monitor_ai`,
`monitor_benchmark`, `fetch_model --monitor`. Details in `docs/AI_MONITORING.md`.

Backend: 287 tests (52 new). Frontend: `tsc`, `eslint` and `expo export` clean.
The black-box system test runs with `AI_MONITOR_MODE=off` because it counts
calls to its fake Ollama and the monitor's background judge calls would skew it.
