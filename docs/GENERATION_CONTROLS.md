# Stop and resume local generation

Admins and faculty can stop book preparation from the book page, or stop a module in Lessons & quizzes, Prepare book, or the module editor. Students have the same controls for their private books. These controls act on the signed-in user's jobs on this device; they do not cancel another user's generation or change publishing permissions.

- **Stop book generation** cancels the current local operation and queued work for that book.
- **Stop module** cancels that module inside a batch, or skips it if it has not started. Other modules continue.
- **Generate all remaining modules** prepares missing lessons and quizzes. Finished content is retained. Admin/faculty readiness rows and student private books also offer generation for an individual module.
- Stop the current book to switch the local model to another book. The UI shows Stopping while the runtime releases its current operation.
- A deliberately stopped automatic book stays stopped when reopened on this device. Starting remaining generation is explicit. Progress preferences are scoped to the account, book and content version.
- Existing lesson/quiz checkpoint logic retains validated work. An incomplete model response is discarded. Starting remaining generation uses those checkpoints; it does not delete completed lessons or quizzes.
- Private-book generation continues while navigating within the app. Closing the app still interrupts local inference; reopen it and generate remaining modules to continue. This change does not introduce a server worker.

Verification: `cd frontend && npm run test:private`, `npm run typecheck`, `npm run lint`, and `npm run export:web`. The generation-controls tests cover active/pending module stops, book cancellation, switching books, isolation, persistence of deliberate stops, checkpoint preservation, and prevention of overlapping batch/module writes.
