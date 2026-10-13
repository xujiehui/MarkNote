import { loadSupabaseRuntimeConfig, readLocalEnv } from './sync-config.mjs';
import { readinessCheckSql, REQUIRED_READINESS_CHECKS, SYNC_MIGRATION_NAME, SYNC_MIGRATION_VERSION, syncMigrationSql } from './supabase-schema.mjs';

const env = readLocalEnv();
const managementApiUrl = (env.SUPABASE_MANAGEMENT_API_URL || 'https://api.supabase.com').replace(/\/$/, '');
const managementToken = env.SUPABASE_MANAGEMENT_TOKEN || env.SUPABASE_API_ACCESS_TOKEN || env.SUPABASE_PAT || '';
let projectRef = env.SUPABASE_PROJECT_REF || '';
const shouldApply = process.argv.includes('--apply');
const shouldForce = process.argv.includes('--force');
class ApplyFailedError extends Error {}
try { await main(); }
catch(error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); }

async function main() {
  if (!projectRef) {
    const config = await loadSupabaseRuntimeConfig(env);
    if (config.provider === 'supabase') projectRef = projectRefFromUrl(config.supabase.url);
  }
  if (!projectRef) throw new ApplyFailedError('SUPABASE_PROJECT_REF is missing and could not be inferred from the sync configuration backend API.');
  if (!managementToken) throw new ApplyFailedError('SUPABASE_MANAGEMENT_TOKEN is missing. Supply the existing token through secure environment settings before checking or applying the migration.');
  console.log(`Checking Supabase migration state for project ${projectRef}.`);
  const history = await managementRequest(`/v1/projects/${encodeURIComponent(projectRef)}/database/migrations`, { method: 'GET' });
  const matching = (Array.isArray(history) ? history : []).find(migration => migration.name === SYNC_MIGRATION_NAME || migration.version === SYNC_MIGRATION_VERSION);
  console.log(matching ? `Migration history: found ${matching.version} (${matching.name || SYNC_MIGRATION_NAME}).` : 'Migration history: MarkNote sync v2 migration has not been recorded by the Management API.');
  if (await checkSchemaReadiness() && !shouldForce) {
    console.log('Sync schema already appears ready. Skipping migration apply.');
    printNext(); return;
  }
  if (!shouldApply) throw new ApplyFailedError('Supabase sync schema is not ready. Dry run only: no migration was applied. Run npm run apply:supabase-migration with SUPABASE_MANAGEMENT_TOKEN to apply the checked-in migrations, then rerun npm run check:supabase-migration.');
  console.log(`Applying ${SYNC_MIGRATION_NAME} through the Supabase Management API.`);
  await managementRequest(`/v1/projects/${encodeURIComponent(projectRef)}/database/migrations`, {
    method: 'POST', body: { name: SYNC_MIGRATION_NAME, query: syncMigrationSql() },
  });
  console.log('Migration apply request completed.');
  if (!await checkSchemaReadiness()) throw new ApplyFailedError('Migration was applied, but the schema readiness check is still incomplete. Review the failed checks above; release remains blocked.');
  console.log('Supabase sync schema: ready.'); printNext();
}
function printNext() {
  console.log('Next: run npm run verify:release:online:manual to verify OAuth, authenticated versioned RPC CAS/replay/tombstones, and attachment Storage.');
}
async function checkSchemaReadiness() {
  const response = await managementRequest(`/v1/projects/${encodeURIComponent(projectRef)}/database/query/read-only`, {
    method: 'POST', body: { query: readinessCheckSql, read_only: true },
  });
  const rows = rowsFromResponse(response);
  const checks = new Map(rows.map(row => [row.check_name,row]));
  let ready = true;
  for (const name of REQUIRED_READINESS_CHECKS) {
    const row = checks.get(name);
    const ok = row?.ok === true || row?.ok === 'true';
    ready = ready && ok;
    console.log(`${name}: ${ok ? 'ok' : 'failed'}${!ok ? ` (${row?.detail || 'missing check result'})` : ''}`);
  }
  return ready;
}

async function managementRequest(path, { method, body }) {
  let response;
  let text = '';
  try {
    response = await fetch(`${managementApiUrl}${path}`, {
      method,
      signal: AbortSignal.timeout(30_000),
      headers: {
        authorization: `Bearer ${managementToken}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    text = await response.text();
  } catch (error) {
    throw new ApplyFailedError(`Could not reach Supabase Management API: ${errorMessage(error)}`);
  }

  const parsed = parseBody(text);
  if (response.status >= 200 && response.status < 300) {
    return parsed;
  }

  const message =
    typeof parsed === 'object' && parsed !== null
      ? parsed.message || parsed.error || JSON.stringify(parsed)
      : String(parsed || text || '');
  throw new ApplyFailedError(`Supabase Management API request failed: HTTP ${response.status}${message ? ` ${message}` : ''}`);
}

function rowsFromResponse(response) {
  if (Array.isArray(response)) {
    return response;
  }
  if (Array.isArray(response?.data)) {
    return response.data;
  }
  if (Array.isArray(response?.result)) {
    return response.result;
  }
  if (Array.isArray(response?.rows)) {
    return response.rows;
  }
  return [];
}

function parseBody(text) {
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function projectRefFromUrl(value) {
  if (!value) {
    return '';
  }
  try {
    const hostname = new URL(value).hostname;
    const match = hostname.match(/^([a-z0-9-]+)\.supabase\.co$/i);
    return match?.[1] || '';
  } catch {
    return '';
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
