# Results release and synchronization recovery

Faculty Settings & release now includes a visible Release results now action, independent of closing the quiz. It uses the existing authorized release endpoint and confirmation, including valid offline attempts synchronized later. Dirty settings must be saved first. Released status persists across refresh.

Offline quiz ingestion converts inaccessible-quiz errors into an actionable synchronization conflict without bypassing publication, enrollment, module access or version checks. Saved legacy Quiz not found messages receive recovery guidance. The result page now provides Retry synchronization, which retries the original durable event instead of only rereading local status. Original answers and submission identity are preserved.

Validation: 24 Django course-sync/results-release tests, including restoration of access for a held quiz; three browser tests for immediate/held offline attempts, navigation and release through faculty settings; TypeScript and web export. Lint: zero errors, seven existing warnings.

A screenshot cannot determine which access condition failed in the user's database. If the quiz remains unavailable, faculty must restore the appropriate access before retrying. Withheld results alone do not cause Quiz not found. No migration is required.
