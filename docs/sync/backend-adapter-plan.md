# MarkNote Sync Backend Adapter Plan

MarkNote stays local-first. The backend is an optional sync target behind `RemoteSyncAdapter`, so the app can start on Supabase and later move to another database or API without rewriting editor logic.

## Current Backend

- Provider: Supabase Auth + Postgres + Storage.
- Client entry: `src/sync/adapters.ts`.
- Provider interface: `src/sync/types.ts`.
- Sync engine: `src/sync/engine.ts`.
- Local source of truth: Dexie tables in `src/lib/db.ts`.

Required environment variables:

```bash
VITE_SYNC_PROVIDER=supabase
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_or_anon_key
VITE_SUPABASE_AUTH_REDIRECT_URL=http://127.0.0.1:5173/?app=1

# Optional CLI-only release verification. Do not commit a real token.
# SUPABASE_ACCESS_TOKEN=eyJ...
# MARKNOTE_REQUIRE_SUPABASE_ACCESS_TOKEN=1
# MARKNOTE_SUPABASE_OAUTH_PROVIDER=google
# MARKNOTE_SUPABASE_OAUTH_OPEN=1

# Optional deployment automation. Use a Supabase personal access token, not a user JWT.
# SUPABASE_PROJECT_REF=your-project-ref
# SUPABASE_MANAGEMENT_TOKEN=sbp_...
```

If these variables are missing, MarkNote runs in local-only mode.

## Stable Adapter Contract

Any future backend must implement:

- `getSession`, `signInWithOAuth`, `signOut`
- `registerDevice`
- `pull(lastPulledAt)`
- `push(payload)`
- optional `uploadAttachment`
- optional `checkBackend`

The rest of the app should not import a provider SDK directly. Provider SDKs belong inside adapter files only.

## Canonical Domain Model

Use these MarkNote concepts across all providers:

- `profiles`: account profile keyed by auth user id.
- `devices`: signed-in MarkNote installations.
- `folders`: notebook folders.
- `notes`: rich-text notes.
- `attachments`: externally stored note assets.
- `syncQueue`: local-only pending changes.
- `syncStates`: local-only per-provider/device checkpoints.

The app stores timestamps as epoch milliseconds. Remote SQL backends can store `timestamptz`; adapters handle conversion.

## Migration Targets

### Supabase to Custom Postgres API

Keep the same SQL tables and move RLS checks into backend middleware:

```text
Client -> REST API -> Postgres
```

Adapter changes:

- Replace `SupabaseSyncAdapter` with a `FetchSyncAdapter`.
- Implement JWT/session handling against the custom auth provider.
- Keep payload shapes from `PushPayload` and `RemoteSnapshot`.

### Supabase to Cloudflare D1/R2

Recommended only if cost is more important than relational features.

Mapping:

- D1: `profiles`, `devices`, `folders`, `notes`, `attachments`
- R2: attachment binary data
- Workers: auth validation and sync endpoints

Required changes:

- Store `tags` as JSON text.
- Replace Postgres RLS with Worker authorization checks.
- Add server-side pagination for pull queries.

### Supabase to Self-Hosted Supabase

Lowest code churn. Keep adapter and schema, change environment variables.

Required checks:

- Storage external URL/CORS are correct.
- SMTP is configured for Auth.
- Backups and upgrades are owned by the deployment.

## Sync Semantics

First version:

- Local writes are queued.
- Pull remote rows newer than `lastPulledAt`.
- Resolve conflicts by newest `updatedAt`, clearing local queue items when the remote version wins.
- Push the remaining queued local changes.
- Pull again from the new remote watermark to catch changes that arrived during push.
- Preserve soft deletes through `deletedAt`.
- Store attachment binaries in provider storage. Remote note HTML uses `marknote-attachment://<id>` references, while the local editor restores those references to displayable data URLs after pull.

Future improvements:

- Conflict copies when both local and remote changed while offline.
- Server-side batch endpoint to make push/pull atomic.
- Optional end-to-end encryption before remote writes.

## Supabase Setup

1. Create a Supabase project.
2. Apply `supabase/migrations/202606190001_marknote_sync_schema.sql`. Use `npm run print:supabase-migration` if you want to print the SQL for Supabase SQL Editor, then optionally run the read-only SQL from `npm run print:supabase-readiness-check` in the same editor. Or set `SUPABASE_MANAGEMENT_TOKEN` and run `npm run apply:supabase-migration` to apply it through the Supabase Management API.
3. Create a Google Cloud Web application OAuth client.
4. Add the Supabase callback URL to that Google OAuth client's Authorized redirect URIs: `https://<project-ref>.supabase.co/auth/v1/callback`.
5. Enable the Google Auth provider in the Supabase Dashboard and paste the Google OAuth Client ID and Client Secret.
6. Add the MarkNote app URL to Supabase Auth redirect URLs, for example `http://127.0.0.1:5173/?app=1` in local development and the production app URL after deployment. For CLI OAuth release checks, also allow the loopback callback pattern `http://127.0.0.1:**/auth/callback`. For the packaged desktop app, add `marknote://auth/callback`.
7. Set the Vite environment variables.
8. Run `npm run check:google-oauth` and confirm Google accepts the configured OAuth client. If it reports `invalid_client`, the Google OAuth client configured in Supabase is missing, wrong, or not a Web application client.
9. Run `npm run check:supabase-migration` with `SUPABASE_MANAGEMENT_TOKEN` to confirm the migration history, sync tables, authenticated grants, RLS policies, private attachments bucket, and storage policies are ready.
10. Run `npm run check:supabase-sync` to confirm the project is reachable. Anonymous checks probe `profiles`, `devices`, `folders`, `notes`, and `attachments`; they may report `PGRST205` because MarkNote only grants table access to `authenticated`. For release verification, run `npm run check:supabase-sync:oauth`; it opens a browser OAuth login, exchanges the callback for a short-lived access token, checks authenticated table access, inserts/updates/deletes temporary folder/note/attachment rows, and runs an attachment Storage canary that uploads, overwrites, downloads, and deletes a tiny diagnostic object. In CI, set `SUPABASE_ACCESS_TOKEN` to a signed-in user's access token and use `npm run check:supabase-sync:auth` so missing authenticated checks fail instead of being skipped.
11. Run `npm run verify:release:online` for the full online gate, `SUPABASE_MANAGEMENT_TOKEN=sbp_... npm run verify:release:online:apply` when the gate should apply the checked-in migration before running the authenticated sync canary, or `npm run verify:release:online:manual` after pasting the migration into Supabase SQL Editor on a machine without a Supabase personal access token.
12. Run the app, sign in with Google, open the sync panel, and click Diagnose sync if syncing fails.
13. Run Supabase Security Advisor before production.

Supabase changed Data API exposure defaults in 2026: tables are not always reachable through the Data API unless explicit grants exist. The MarkNote migration intentionally grants the sync tables to `authenticated`, not `anon`, and enables RLS on each table. If a signed-in diagnostic reports `PGRST205`, run `npm run check:supabase-migration` when a Supabase personal access token is available; then run `npm run apply:supabase-migration` with that token, or run `npm run print:supabase-migration`, paste the SQL into Supabase SQL Editor, optionally run the SQL from `npm run print:supabase-readiness-check`, and rerun `npm run verify:release:online:manual`.

The migration is safe to rerun. On fresh projects, notes and attachments are created with validated foreign keys. On projects that already have older MarkNote tables, the follow-up foreign-key backfill uses `NOT VALID` so historical orphaned rows do not interrupt deployment; new writes are still constrained. After cleaning any legacy orphaned rows, run `alter table public.notes validate constraint notes_user_folder_fk;` and `alter table public.attachments validate constraint attachments_user_note_fk;` if you want fully validated constraints.

If Supabase CLI is available, prefer:

```bash
supabase migration new marknote_sync_schema
supabase db push
```

Then copy the SQL from the checked-in migration into the generated migration file if your team requires CLI-generated timestamps.
