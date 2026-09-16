# Default book authoring uses the device

Normal Upload a book now opens the device importer rather than uploading to the
server parser. Institutional books still require review and synchronization before
publication. This changes supported uploads at that entry point to PDF/DOCX with
the existing 35 MB local original-file limit; DOC is not supported there.

Opening a book prepares authorized module sources automatically. Opening a module
or batch does the same, reusing stored drafts offline. No Save on this device
button is required. Existing drafts are not overwritten; source-revision conflicts
retain the prior explicit review/history behavior. Generation continues to persist
its output and checkpoints automatically. Generation actions select the task, not
where inference runs. Missing models are shown as setup needs before jobs can start.

Normal book/module generation labels no longer offer local processing as a second
mode. Model installation is still a one-time prerequisite on each device/browser.

Validation: five targeted browser scenarios passed with controlled inference and
real device storage/Django, covering automatic source preparation, missing-model
preflight, default upload/offline import/sync, offline generation, and batch restart.
TypeScript and web export passed. Lint has zero errors and seven existing warnings.

Remaining migration: separate Create Quiz, legacy server triggers, review/evaluation
AI paths, consolidated authoring navigation and status, and full real-device
acceptance. This increment does not claim the entire platform is device-only.
