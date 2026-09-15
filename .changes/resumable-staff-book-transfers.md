# Resumable institutional book transfers

Staff book synchronization now sends original files in chunks of up to 1 MiB.
The server reports its durable received offset on each transfer start/retry.
Browser originals remain binary IndexedDB records; native originals remain local
files. Native chunk cache files are removed after each request.

- A lost chunk acknowledgement or browser refresh does not restart the file.
- Each chunk and the assembled original are SHA-256 checked. Gaps, changed
  metadata, changed duplicate chunks and incomplete finalization are rejected.
- Role, ownership, assigned subject and active-subject checks apply on retries.
- Finalization retains the existing reviewed-manifest validation, duplicate-safe
  receipt, unpublished document state and local-to-server module mapping.
- Completed transfers remove their temporary chunks. A lost final response uses
  the existing receipt without uploading the source again.
- Transfer progress is shown in Books on this device. Removing a staged transfer
  retains the local original, extracted source and generated work.
- Staging is limited to four uploads per account, the configured original upload
  size, and 1,024 chunks per upload. Data uses database staging rather than public
  media paths, keeping it consistent with transaction rollback and deployment
  storage independence. Account deletion cascades to staged bytes.
- Staging idle for seven days is cleared when that account starts/resumes a
  transfer. Operators can run `python manage.py cleanup_book_transfers` regularly
  for inactive accounts. This command is provided, not automatically scheduled.

## Upgrade

Run database migrations before using the rebuilt client; migration 0010 creates
upload and chunk staging tables. Old clients can still use whole-file multipart
book synchronization. The new client requires the new transfer endpoints.

## Verification

20 focused Django tests passed, covering transfers, permission revocation,
checksums, receipt replay, staging cleanup, source validation and existing local
lesson/quiz ingestion. A real-Django/IndexedDB/PDF browser test deliberately loses
a chunk acknowledgement, refreshes, verifies the next offset (no first-chunk
resend), then verifies one unpublished book and the mapped lesson. Inference in
that test is stubbed. TypeScript, lint (seven existing warnings, no errors), and
web export passed.

The local parser's 35 MB original-file limit is unchanged. This increment does
not add institutional extracted-figure synchronization, migrate remaining legacy
server AI actions, or establish native-device acceptance.
