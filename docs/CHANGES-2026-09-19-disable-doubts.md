# Disable new doubts during content generation

Course and private-book doubt inputs and Ask buttons subscribe to the existing
application generation state. They are disabled while any content job is queued
or running, including generation in another module and staff book batches.

The message explains that doubts return after generation, and that reading and
saved quizzes remain available. The question text and existing conversation are
retained. No automatic doubt submission is scheduled.

The queue rejects new private doubts while content generation is active. Both
course and private service entry points also enforce the rule before work starts
and immediately before inference, covering generation that starts during an
asynchronous course-access or source lookup.

Completion or failure restores access automatically. Cancelling a queued job
removes it immediately; cancelling a running job keeps doubts blocked until that
job has actually settled. Other remaining generation jobs continue to block.
Already-started answers are not discarded by this change.

Scope: the existing app runtime and its job registry. This does not coordinate
independent browser tabs, windows, or other processes. It does not change model
speed, saved quizzes, grading, publication, or background-generation scheduling.

Validation: 98 controlled tests pass, including submission blocking for both doubt
services, generation starting during a course-access request, restoration after
success/failure/cancellation, private library contracts, authoring races, offline
recovery, quiz-draft recovery, and authentication navigation. TypeScript, strict
lint, and production web export pass. Full browser/device acceptance was not run
for this change.

Update (stop the app first; preserve local edits shown by git status):

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

Manual acceptance: type a question, start a lesson or quiz generation, and open
Ask a doubt. Confirm the message, disabled input/button, and retained question.
After all generation stops, confirm that input and Ask become available without
refreshing. Repeat for cancellation and generation failure, and for generation
in a different module.
