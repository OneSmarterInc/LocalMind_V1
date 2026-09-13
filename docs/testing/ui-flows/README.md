# Browser flow tests (UI rework and round-3 fixes)

These are the browser tests used to verify the new interface. They drive a real Chromium against a running
LocalMind server that serves the web build (`SERVE_WEB=true`, `WEB_DIST=<export dir>`), signed in as the demo accounts
(`python manage.py seed_demo`, password `Demo@12345`).

| File | Flows |
|---|---|
| `flows.mjs` | 12 main button flows (student, faculty, administrator) |
| `flows2.mjs` | 13 state and edge flows (sign-in, expired session, locked module, held results, offline, publishing, import, phone menu) |
| `flows3.mjs` | 18 flows for the round-3 fixes (issues 1, 2, 4–13, 15–18, 20–22) |
| `flows4.mjs` | 10 flows for the round-4 fixes (delayed token refresh in two variants, expired quiz with a saved draft, drafts bound to their quiz with Save/Discard/Stay, edits during a save, failed "Save and continue", whole-chapter sources, partial offline lists, date fields on a phone-width screen) |
| `flows5.mjs` | 6 flows for the round-5 fixes (blank score refused by "Save and leave", leaving blocked while newer edits are unsaved, sign out and Back guarded, submission waits for restored answers, typing saved before leaving, failed save during navigation explained) |
| `date_parts_test.mts` | Strict date parsing (31 February, 24:00 and bad formats are rejected). Copy next to `frontend/src/ui/dateParts.ts` and run `node --experimental-strip-types date_parts_test.mts` |

## Requirements

- Node 18+ with `puppeteer-core` and `@sparticuz/chromium` (or change the launch call to a local Chrome).
- The server at `http://127.0.0.1:8020` (edit `BASE` at the top of each file).

## Test data

The flows read ids of seeded records from JSON files in `/tmp`, written by the seed scripts here:

| Seed | Writes | Used by |
|---|---|---|
| `seed_state_flows.py` | `/tmp/state_ids.json` (locked module, held quiz and attempt, new account) | `flows2.mjs`, `flows3.mjs` |
| `seed_held_quiz_shell.py` (run with `manage.py shell < file`) | Held automatic quiz with an AI-monitor incident | `flows3.mjs` |
| `seed_round3_flows.py` | `/tmp/r3_ids.json` (draft quiz, released and used-up assignments, archived book) | `flows3.mjs` |
| `seed_round4_flows.py` | `/tmp/r4_ids.json` (timed quiz, whole-chapter quiz, two quizzes for switching) | `flows4.mjs` (R4-2 also shortens an attempt's start time through `manage.py shell`) |

Some flows change data: they release results, sign in a new account and use up attempts. Re-run the seeds before a second full run.

The Python seeds were run through a small helper that defines `B` (API base), `toks` and `call(path, token, method, body)`. Adapt them to your own client if you run them outside that helper.

Some flows rename records (for example a quiz title). Later flows read the current title from the API rather than assuming the seeded one, so the files can run in any order, but re-running the seeds before a full pass keeps the data predictable.
