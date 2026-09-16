# Automatic offline preparation and course refresh

Signed-in users of all roles automatically prepare public offline web assets on startup, reconnection and foreground return. Failed preparation retries every minute; successful preparation checks are throttled to five minutes. In-flight automatic preparation is deduplicated. Complete versioned asset caches are reused instead of downloading the same files again. Preparation does not reload open screens.

Student course synchronization already ran at sign-in, reconnection and foreground return; its periodic interval is now one minute. Existing approved staff upload retries remain active. Offline AI shows automatic preparation status. Manual buttons remain as recovery controls, not required setup steps.

Scope: runs while the application is open; browsers may suspend background tabs. HTTPS/localhost and sufficient storage are still required. First model download/import and faculty content approval remain explicit. Private study is not uploaded, and access/version conflicts still require review. No database migration.

Validation: TypeScript and web export passed; lint had zero errors and seven existing warnings. Three browser scenarios passed: no-click offline restart and immediate/held institutional quizzes.
