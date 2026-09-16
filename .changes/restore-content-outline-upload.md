# Restore content-based faculty book upload

The normal faculty/admin upload route again uses the existing document upload and
processing pipeline with outline_strategy=source, followed by the existing outline
editor. The source heading/hierarchy extractor itself is unchanged. Page-based
local imports are no longer the normal upload route, and the extra local-book
preparation shortcut was removed from Books & modules.

The backend performs deterministic book parsing and outlining, so this upload
requires access to the backend. Lesson/quiz generation still uses the device
runtime; central AI judging is unchanged. Existing local drafts and student data
are retained, not deleted or silently remapped. Upload the original file through
the restored form to create a content-based outline for a previously local draft.

Verification: 74 focused backend tests passed; real DOCX upload -> source outline
-> editor -> refresh browser test passed; offline faculty batch-generation browser
test passed. TypeScript and web export passed. Lint: zero errors, seven existing
warnings. No new database migration or model requirement.
