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
```

If these variables are missing, MarkNote runs in local-only mode.

## Stable Adapter Contract

Any future backend must implement:

- `getSession`, `signInWithOAuth`, `signOut`
- `registerDevice`
- `pull(lastPulledAt)`
- `push(payload)`
- optional `uploadAttachment`

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
- Push queued local changes.
- Pull remote rows newer than `lastPulledAt`.
- Resolve conflicts by newest `updatedAt`.
- Preserve soft deletes through `deletedAt`.

Future improvements:

- Conflict copies when both local and remote changed while offline.
- Server-side batch endpoint to make push/pull atomic.
- Attachment migration that replaces inline base64 images with Storage references.
- Optional end-to-end encryption before remote writes.

## Supabase Setup

1. Create a Supabase project.
2. Apply `supabase/migrations/202606190001_marknote_sync_schema.sql`.
3. Create a Google Cloud Web application OAuth client.
4. Add the Supabase callback URL to that Google OAuth client's Authorized redirect URIs: `https://<project-ref>.supabase.co/auth/v1/callback`.
5. Enable the Google Auth provider in the Supabase Dashboard and paste the Google OAuth Client ID and Client Secret.
6. Add the MarkNote app URL to Supabase Auth redirect URLs, for example `http://127.0.0.1:5173/?app=1` in local development and the production app URL after deployment. For the packaged desktop app, also add `marknote://auth/callback`.
7. Set the Vite environment variables.
8. Run `npm run check:google-oauth` and confirm Google accepts the configured OAuth client. If it reports `invalid_client`, the Google OAuth client configured in Supabase is missing, wrong, or not a Web application client.
9. Run the app, sign in with Google, and click Sync.
10. Run Supabase Security Advisor before production.

If Supabase CLI is available, prefer:

```bash
supabase migration new marknote_sync_schema
supabase db push
```

Then copy the SQL from the checked-in migration into the generated migration file if your team requires CLI-generated timestamps.
