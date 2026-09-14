Private study recovery and source context

- Show the generation job list only on its dedicated route.
- Restore the student's saved module/tab and question draft from the device database. Completed chats, lessons, quizzes and attempts retain their existing per-student storage. Job links open the requested module and activity.
- Use all extracted sections from the same PDF page for lesson and quiz generation. Remove the fixed characters-per-question gate; retain validation and reject incomplete or duplicate question sets. Bound each model call to a source passage.
- Balance new page splits to avoid tiny trailing modules. Use automatic OCR page layout rather than sparse-text mode. Normalize PDF small-cap runs only in uppercase headings; preserve ordinary scientific casing and scripts.
- Allow explicit source-text corrections on the device. Preserve the original extraction and prior study results; cancel unfinished jobs for that book before saving corrections. Regenerate results to use corrected source.
- Reserve one active doubt job alongside two study jobs. Individual inference calls still share one model context and remain serialized; this is scheduling responsiveness, not simultaneous model inference or a demonstrated throughput increase.

Rebuild the frontend and refresh the saved offline application files. Re-import books to apply the new parser; a new extraction revision preserves the earlier book and its history. Source context and navigation fixes also apply to existing books. Stored OCR errors are not silently rewritten, and arbitrary OCR spelling/formula accuracy is not guaranteed. The original affected PDF is needed for exact reproduction; screenshots alone do not expose its text layer.

Closing/reloading the application still interrupts unfinished inference. Completed study records persist. This update does not claim crash-resumable generation or multiple simultaneous local-model instances.
