# Enrolling students: the action stays in view

Branch: `feature/integrated-private-library`.

## What was wrong

The Enrol button sat at the bottom of the candidate list. Selecting a few
students meant scrolling past every row to reach it, and with a long roll the
button was always somewhere below the fold. A class of five thousand would make
that unusable.

## The change

The student picker now keeps its action bar pinned above the list: the search
box, a running count of how many are selected, a select-all-shown control, and
the Enrol button. Whatever the list length, the button is always in view, so
selecting people and enrolling them never involves hunting for the control.

The candidate list scrolls inside its own bounded area rather than stretching
the page, so the screen behaves the same whether ten students match or the full
first page of fifty does. The Enrol button carries the count ("Enrol 8
students"), a Clear control appears once anything is selected, and select-all
toggles only the rows currently shown so a narrowed search does not silently
select people who scrolled out of view.

The backend already returns at most fifty ordered candidates and leaves out
anyone already enrolled, so a five-thousand-student roster never loads at once;
this change is the client half that makes that scale comfortable to use.

## Tests

- Backend academics suite passes; no backend behaviour changed here.
- `npx tsc --noEmit` is clean.

## Installing

`cd frontend && npm install && npm run export:web`. No migrations.
