# Versioned personal sync protocol

MarkNote uses authenticated Supabase RPCs for sync. Direct writes to the legacy
`folders`, `notes`, and `attachments` tables are disabled by the v2 migration.
Installing only the older schema no longer enables sync; the app reports the
missing v2 migration and keeps local mutations queued.

## Deploy in order

1. Back up the Supabase database and Storage bucket, and verify a restore in a
   separate project. Keep local workspace backups as well.
2. Deploy `supabase/migrations/202606190001_marknote_sync_schema.sql` and then
   `supabase/migrations/202610130001_marknote_sync_v2.sql` in one transaction.
   `npm run print:supabase-migration` prints that complete transaction. The
   Management API helper supports a dry check (`npm run check:supabase-migration`)
   and explicit apply (`npm run apply:supabase-migration`). Supply credentials
   through secure environment settings; never paste tokens into documentation.
3. Run `npm run print:supabase-readiness-check` in SQL Editor, or use the
   management dry check. Every metadata gate must pass, including revoked legacy
   DML, private internal tables, safe function ownership/search path and grants,
   RLS, and private Storage. Read-only metadata checks do not prove online sync.
4. Deploy the v2 app and run `npm run check:supabase-sync:oauth` or the app's
   **Diagnose sync** with an actual signed-in account. The readiness RPC tests
   CAS/replay/tombstone writes in a rolled back subtransaction, leaving no
   diagnostic entities or committed counter changes.
5. Use two devices against a test project to verify concurrent edits, dropped
   responses, pagination with more than 1,000 changes, note-only purge with
   attachments absent from one device, account changes during uploads, and
   failed Storage cleanup. Confirm local conflict copies and outbox persistence
   before releasing multi-device sync broadly.

Do not roll back by restoring legacy table DML or publishing an old client. Once
v2 has accepted writes, legacy tables are a bootstrap source, not the live state.
Roll back application code to a compatible version or temporarily disable cloud
sync while retaining the v2 database, local workspace data, outbox and backups.
A database restore requires a coordinated recovery plan and client cursor reset;
an old cursor intentionally fails instead of silently skipping restored data.

## Guarantees

- `auth.uid()` scopes every RPC; no client-supplied owner selects another user's
  space. The engine passes its captured workspace owner, and the adapter compares
  it with the current session and pins the captured JWT on every request. Storage
  uses a separate non-persistent client bound to the same JWT. Late responses are
  discarded when the workspace/account changes.
- Every mutation has a frozen ID, local generation and expected **server**
  revision. SHA-256 of the canonical JSONB request binds idempotency to the full
  payload. Reusing an ID with altered content is rejected. A stale revision
  returns the remote value as a conflict without overwriting it.
- A per-user counter is locked until COMMIT for bootstrap, writes and paging.
  Sequence allocation rolls back with a failed transaction; a lower uncommitted
  sequence cannot appear after a higher committed one. Pull pages share a fixed
  upper bound, so later writes are included in the next pull. Page application and
  cursor storage commit together locally.
- Existing remote rows bootstrap once into revision 1, independent of their
  old client clocks and version numbers. Folder rows precede notes and images in
  bootstrap pages. Reapplying the migration does not reset this state.
- Soft trash is an upsert retaining content. Permanent purge retains only identity,
  revision and sequence tombstones; it redacts entity bodies from canonical state,
  historical change pages, idempotency receipts and legacy note/folder rows. A
  permanent note purge also purges server-known images even when a device has
  never downloaded them. Permanently deleted IDs cannot be resurrected.
- A folder containing remote notes cannot be purged until those notes are moved
  or permanently deleted. Upserts validate same-user parent identities.
- Attachments use `<user>/<note>/<attachment>/<SHA-256>` immutable paths and never
  overwrite a prior blob. Prefixes compare literally, including `_` and `%` IDs.
  The adapter rejects active MIME types, declared/download MIME mismatches, files
  over 20 MiB, cross-account paths and hash mismatches.
- Purge queues durable Storage cleanup jobs in the same server transaction.
  Cleanup removes blobs after tombstone commit, verifies disappearance, then
  acknowledges jobs. Failed removal/acknowledgement is retried during later sync;
  it never erases a file before the corresponding CAS succeeds. Blobs uploaded
  before a rejected/abandoned mutation can remain unreferenced; periodic orphan
  reclamation requires a retention window and a server-side inventory job.
- Requests use abort signals and bounded operation deadlines; the engine pushes
  and acknowledges at most 100 mutations per network operation. Timeouts retain
  unconfirmed generations so replay is safe.

## Validation

`npm test` runs the SDK adapter/wrapper regressions, CLI release-gate tests, and
`tests/syncProtocol.test.cjs` against PostgreSQL compiled to WASM by PGlite.
Those database tests execute the actual migrations, authenticated/anonymous
roles, grants, RLS, security definer functions, bootstrap, CAS, altered retries,
fixed-bound pages, rollback, owner isolation, purge and cleanup RPCs. No test uses
production credentials. PGlite uses a single connection; deployment still needs
real PostgreSQL multi-session contention and actual Supabase/PostgREST/Storage
validation. An automated local pass does not constitute that online acceptance.
