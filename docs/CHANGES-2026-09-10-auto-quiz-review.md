# Automatic quizzes: checked before they go live, and none for tiny modules (10 September 2026)

## Why

Automatic quizzes are published without anyone reading them. On the first real run, the AI monitor flagged one of the first five, the one-question quiz for a 300-character "Q U E S T I O N S" box, as a high-severity factual error. The quiz stayed live, because the monitor only recorded incidents. Tiny boxes and bare headings were also getting one-question quizzes that cluttered the students' quiz list.

## 1. Flagged automatic quizzes are held for review

**Before going live.** While the AI monitor is on, a new or rewritten automatic quiz goes to the monitor first and stays a draft until the check finishes (book screen: "quiz being checked").

- **Check passes, or finds only low or medium issues:** the quiz is marked checked and published as soon as its module is open in a published book.
- **Check raises a high or critical incident:** the quiz is **held**. It stays a draft, and students do not see it, even after its module opens. The quiz screen shows "Held for review" with the reason; the book screen counts it and its module shows "quiz held for review" with a Review Quiz button.

**Releasing a held quiz.**

- **Faculty publish it** themselves, usually after fixing a question. Publishing by hand is the review.
- **Faculty or an admin mark the incident a false positive or close it** in AI Monitor. The quiz is published if its module is open.
- **A confirmed incident keeps the hold.**

**Details.**

- **Attempted quizzes:** a quiz students have already attempted is never pulled back; their scores refer to it.
- **Rewritten quizzes:** when a module's text changes and its unattempted quiz is rewritten, the new questions are checked again before going live.
- **Lost checks:** the monitor's queue lives in memory, so a check lost to a restart is sent again after 30 minutes.
- **Monitor off:** with `AI_MONITOR_MODE=off` or the monitor disabled, automatic quizzes are published straight after generation, as before.
- **Quizzes faculty write:** hand-written or faculty-generated quizzes are unchanged, because faculty review those themselves.

**Existing quizzes.** Migration `assessments.0006` applies the rule to automatic quizzes that already exist. Those the monitor has evaluated are marked checked. Those with an open or confirmed high or critical incident and no attempts are set back to draft and held. On this installation that includes the flagged "Q U E S T I O N S" quiz.

## 2. No automatic quiz for tiny modules

`AUTO_QUIZ_MIN_CHARS` (default 500) sets the smallest module that gets an automatic quiz. Shorter modules are not queued, a job already queued for one is dropped when its turn comes, and the book screen reports how many modules were skipped. Faculty can still add a quiz to such a module by hand. `0` restores a quiz for every module.

Automatic quizzes already written for short modules are removed with:

```
python manage.py generate_auto_quizzes --remove-short --dry-run   # list them
python manage.py generate_auto_quizzes --remove-short             # delete those nobody has attempted
```

Quizzes students have attempted are kept and listed, so faculty can close them instead.

## Verification

| Check | Result |
|---|---|
| Backend unit suite | 399 of 399 (14 new) |
| Black-box system test, monitor off (as in CI) | 213 of 213 |
| System test with the monitor in async mode, as on the laptop | Automatic quizzes waited for the check; the fake judge flagged two, they were held and not shown to students, and the one that passed went live. The two system-test checks that expect every quiz live fail in this mode by design. |
| Migrations 0005 and 0006 on a database created by the previous release, with a flagged, an unflagged and an attempted flagged automatic quiz, on SQLite and PostgreSQL | Flagged quiz held as a draft; unflagged one stays published and marked checked; attempted one stays published |
| Frontend `tsc`, `eslint`, web export | Clean (the 2 existing lint warnings only) |

**What the new tests cover.**

- **Publishing:** a passing quiz goes live, and a serious finding holds the quiz away from students.
- **Release:** faculty publishing releases a hold, a false positive releases and publishes, and a confirmed incident keeps the hold.
- **Checking:** a quiz waiting for an asynchronous check shows "checking" and is not published early, a lost check is sent again, and without the monitor quizzes go live immediately.
- **Migration:** it holds quizzes that were already flagged.
- **Short modules:** they are not queued, an old queued job is dropped, and `0` restores quizzes for every module.
- **Command:** `--remove-short` deletes unattempted short quizzes and keeps attempted ones.

## Worth knowing

The judge on this laptop is the small 1.7B model, and it raises high-severity findings readily: both tutor answers and one of the first five automatic quizzes in the field log. Some held quizzes will be false alarms. Marking those as false positives releases them; it is quicker than editing.

## Upgrading

1. Run `python manage.py migrate` (adds `assessments.0005` and `0006`).
2. Rebuild the web client with `npm run export:web`.
3. Restart.
4. Optionally run `generate_auto_quizzes --remove-short`.
