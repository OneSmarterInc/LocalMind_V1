# Recover a conflicting staff draft without losing local work

An admin or faculty member can now select **Refresh source and keep draft in
history** on a saved module. After confirmation, the application downloads the
current authorized source, archives the previous draft in the same account's
local storage, and starts a fresh working copy. Older source, lesson, quiz and
synchronization details remain readable under **Previous local drafts** after
an offline restart. Interrupted generation checkpoints remain stored locally.

A failed download or revoked permission leaves the working draft unchanged.
Active generation must finish or be cancelled first. Pending synchronization
must settle before refresh, so a queued write is not silently abandoned.
Archived drafts are never automatically submitted against a newer revision.
Staff must generate and review new work before approving another sync.

History is loaded on opening the page and after an archive, rather than reading
all previous draft content on each progress polling interval.

This extends commit 3cb6a91. Fully offline import of new institutional books,
asset transfer and the remaining server AI workflow migration are still pending.
No desktop executable or production deployment is included.

Verification: TypeScript and web export; focused browser test covering a version
conflict, unsuccessful offline refresh with the current draft preserved,
successful recovery and inspection of the old lesson after an offline restart.
