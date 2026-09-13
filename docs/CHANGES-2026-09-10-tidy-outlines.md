# Textbook boxes folded into their sections; garbled titles repaired (10 September 2026)

## Why

The Class 10 science chapter in the field log produced 34 modules. Many were not sections at all but the boxes printed on the page: three "Q U E S T I O N S" boxes, "Activity 5.3" to "Activity 5.7", "More to Know!", "Do You Know?", and heading stubs such as "5.2 NUTRITION" with a single line of text. Students saw them as modules, and each one cost a lesson and a quiz. Titles were also garbled by the PDF's layout: "5.1 WHA 5.1 WHAT ARE LIFE PROCESSES? T ARE LIFE PROCESSES?", "Activity 5.3 Activity 5.3", "Q U E S T I O N S".

## What processing does now

**Titles are repaired** before modules are created. Three shapes are fixed:

| Before | After |
|---|---|
| `Q U E S T I O N S` | `QUESTIONS` |
| `M O R E  T O  K N O W` | `MORE TO KNOW` |
| `Activity 5.3 Activity 5.3` | `Activity 5.3` |
| `5.1 WHA 5.1 WHAT ARE LIFE PROCESSES? T ARE LIFE PROCESSES?` | `5.1 WHAT ARE LIFE PROCESSES?` |

Normal titles are left alone.

**What counts as a fragment.** Any of these is folded into the section it belongs to:

- a textbook box: Questions, Exercises, Activity N, Group Activity, Do You Know?, Did You Know?, More to Know!, Think It Over, Let Us Recall, Test Yourself, Try This, Fact File, Intext Questions, Check Your Progress;
- an unnumbered module shorter than `OUTLINE_MERGE_MIN_CHARS` (500 characters);
- a short numbered heading that only introduces its first subsection.

**Where a fragment goes.**

1. **A numbered introduction** such as "5.2 NUTRITION", followed by "5.2.1…", joins the text that follows it.
2. **Anything else** joins the nearest earlier real section in its chapter, or the previous chapter's last section when its whole chapter is fragments.
3. **Failing that**, it joins the next section of its chapter.

**What does not change.**

- **Nothing is lost:** folded text stays under its own `## Title` line inside the section, so students read it where it was printed and the tutor's search still sees the box heading.
- **Short sections whose content follows in boxes stay:** a short numbered heading such as "5.2.4 Nutrition in Human Beings" keeps its place as the home for the boxes after it.
- **No box inside a box:** nothing is folded into another box.
- **Size limit:** a box of real length is not added once a module would pass `OUTLINE_MERGE_MAX_CHARS` (16,000 characters); a few lines of questions always fit.

**Fewer lessons and quizzes.** Lessons and automatic quizzes are then generated for the fuller modules.

**On the field log's book.** Applied to the first 17 modules, using their real titles and sizes, the plan gives 7 modules:

| Module | Characters | Folded into it |
|---|---|---|
| 5.1 WHAT ARE LIFE PROCESSES? | 3,917 | QUESTIONS |
| How do living things get their food? | 1,007 | 5.2 NUTRITION |
| 5.2.1 Autotrophic Nutrition | 4,302 | |
| 5.2.2 Heterotrophic Nutrition | 996 | |
| 5.2.3 How do Organisms obtain their Nutrition? | 916 | |
| 5.2.4 Nutrition in Human Beings | 16,080 | Activity 5.3, QUESTIONS, Activity 5.4, Activity 5.5, Activity 5.6, More to Know!, Do You Know?, QUESTIONS |
| Activity 5.7 | 1,375 | (kept: the section before it was full) |

"5.2.4" is large because the PDF put much of that section's text under activity headings. It is one textbook section, so it is kept together.

**Settings.** `OUTLINE_MERGE_SMALL=false` keeps every heading as its own module; titles are still repaired. `OUTLINE_MERGE_MIN_CHARS` and `OUTLINE_MERGE_MAX_CHARS` set the two limits.

## Books already uploaded

They are unchanged until tidied:

```
python manage.py tidy_book --list
python manage.py tidy_book --document <id> --dry-run
python manage.py tidy_book --document <id>
```

**What `tidy_book` changes.** It repairs the titles and applies the same folding.

**What it leaves alone.** Any module that student work refers to stays where it is and is listed: a student's progress on it (a student who opened the module has a progress row), a quiz attempt, an assignment, or a tutor conversation.

**Automatic quizzes and lessons.**

- **Folded modules:** their unattempted automatic quizzes and their lessons are removed with them.
- **Modules that receive text:** they get a new lesson, and a new automatic quiz if nobody has attempted theirs, which the AI monitor checks before it goes live.
- **The book** gets a new content version, and the change is audited.

## Verification

| Check | Result |
|---|---|
| Backend unit suite | 411 of 411 (12 new) |
| Black-box system test | 213 of 213 (its test book has no boxes, so its structure is unchanged) |

**What the new tests cover.**

- **Title repair:** the three garbled shapes are fixed and normal titles are left alone.
- **Plan:** boxes join the section before, a numbered introduction joins the section it opens, a box-only chapter joins the previous chapter, and a box opening a chapter joins the next section. The size cap, locked modules, and "a few lines always fit" are covered too.
- **Upload:** an NCERT-shaped book comes out as three modules with the boxes' text inside them, the counts are recorded in the audit log, and switching the setting off keeps every heading.
- **Existing books:** a dry run changes nothing; a real run merges, removes the folded module's automatic quiz, bumps the version and queues a new lesson; a box a student has used stays; the command works.

**Not tested on the real PDF.** The field log's module list was used for the plan above; the PDF itself was not reprocessed here.

## Upgrading

No migration. Restart. To tidy the book already on the laptop, run `tidy_book` with `--dry-run` first. Modules students have opened will be listed as kept.
