
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve('supabase/migrations/202606190001_marknote_sync_schema.sql');
const migrationName = 'marknote_sync_schema';
const expectedTables = ['profiles', 'devices', 'folders', 'notes', 'attachments'];
const expectedPublicPolicies = {
  profiles: ['Users can read own profile', 'Users can insert own profile', 'Users can update own profile'],
  devices: ['Users can read own devices', 'Users can insert own devices', 'Users can update own devices', 'Users can delete own devices'],
  folders: ['Users can read own folders', 'Users can insert own folders', 'Users can update own folders', 'Users can delete own folders'],
  notes: ['Users can read own notes', 'Users can insert own notes', 'Users can update own notes', 'Users can delete own notes'],
  attachments: [
    'Users can read own attachments',
    'Users can insert own attachments',
    'Users can update own attachments',
    'Users can delete own attachments',
  ],
};
const expectedStoragePolicies = [
  'Users can read own attachment objects',
  'Users can upload own attachment objects',
  'Users can update own attachment objects',
  'Users can delete own attachment objects',
];
const env = {
  ...readEnvFile('.env'),
  ...readEnvFile('.env.local'),
  ...process.env,
};

const managementApiUrl = (env.SUPABASE_MANAGEMENT_API_URL || 'https://api.supabase.com').replace(/\/$/, '');
const managementToken = env.SUPABASE_MANAGEMENT_TOKEN || env.SUPABASE_API_ACCESS_TOKEN || env.SUPABASE_PAT || '';
const projectRef = env.SUPABASE_PROJECT_REF || projectRefFromUrl(env.VITE_SUPABASE_URL || '');
const shouldApply = process.argv.includes('--apply');
const shouldForce = process.argv.includes('--force');

class ApplyFailedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ApplyFailedError';
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

async function main() {
  if (!projectRef) {
    throw new ApplyFailedError('SUPABASE_PROJECT_REF is missing and could not be inferred from VITE_SUPABASE_URL.');
  }
  if (!managementToken) {
    throw new ApplyFailedError(
      [
        'SUPABASE_MANAGEMENT_TOKEN is missing.',
        'Create a Supabase personal access token, export it as SUPABASE_MANAGEMENT_TOKEN, then rerun this command.',
      ].join('\n'),
    );
  }

  const migrationSql = readFileSync(migrationPath, 'utf8').trim();
  if (!migrationSql) {
    throw new ApplyFailedError(`${migrationPath} is empty.`);
  }

  console.log(`Checking Supabase migration state for project ${projectRef}.`);
  const migrationHistory = await listMigrations();
  const matchingMigration = migrationHistory.find((migration) => migration.name === migrationName || migration.version === '202606190001');
  if (matchingMigration) {
    console.log(`Migration history: found ${matchingMigration.version}${matchingMigration.name ? ` (${matchingMigration.name})` : ''}.`);
  } else {
    console.log('Migration history: MarkNote sync migration has not been recorded by the Management API.');
  }

  const before = await checkSchemaReadiness();
  printSchemaReadiness(before);
  if (before.ready && !shouldForce) {
    console.log('Sync schema already appears ready. Skipping migration apply.');
    console.log('Next: run npm run verify:release:online:manual to verify Google OAuth, authenticated Data API writes, and attachment Storage.');
    return;
  }

  if (!shouldApply) {
    throw new ApplyFailedError(
      [
        'Supabase sync schema is not ready.',
        'Dry run only: no migration was applied.',
        'Run npm run apply:supabase-migration with SUPABASE_MANAGEMENT_TOKEN to apply the checked-in migration SQL, then rerun npm run check:supabase-migration.',
      ].join('\n'),
    );
  }

  console.log(`Applying ${migrationName} through the Supabase Management API.`);
  await managementRequest(`/v1/projects/${encodeURIComponent(projectRef)}/database/migrations`, {
    method: 'POST',
    body: {
      name: migrationName,
      query: migrationSql,
    },
  });
  console.log('Migration apply request completed.');

  const after = await checkSchemaReadiness();
  printSchemaReadiness(after);
  if (!after.ready) {
    throw new ApplyFailedError(
      [
        'Migration was applied, but the schema readiness check is still incomplete.',
        `Missing tables: ${after.missingTables.join(', ') || 'none'}`,
        `Tables missing authenticated grants: ${after.tablesMissingAuthenticatedGrants.join(', ') || 'none'}`,
        `Tables missing RLS: ${after.tablesMissingRls.join(', ') || 'none'}`,
        `Missing public policies: ${after.missingPublicPolicies.join(', ') || 'none'}`,
        `Missing storage policies: ${after.missingStoragePolicies.join(', ') || 'none'}`,
        `Attachments bucket ready: ${after.attachmentsBucketReady ? 'yes' : 'no'}`,
      ].join('\n'),
    );
  }

  console.log('Supabase sync schema: ready.');
  console.log('Next: run npm run verify:release:online:manual to verify Google OAuth, authenticated Data API writes, and attachment Storage.');
}

async function listMigrations() {
  const response = await managementRequest(`/v1/projects/${encodeURIComponent(projectRef)}/database/migrations`, {
    method: 'GET',
  });
  return Array.isArray(response) ? response : [];
}

async function checkSchemaReadiness() {
  const tables = await runReadOnlyQuery(
    `
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (${sqlStringList(expectedTables)})
order by table_name;
`,
  );
  const tableNames = new Set(rowsFromResponse(tables).map((row) => String(row.table_name || row.tableName || '')));
  const missingTables = expectedTables.filter((table) => !tableNames.has(table));

  const grants = await runReadOnlyQuery(
    `
select table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee = 'authenticated'
  and table_name in (${sqlStringList(expectedTables)})
  and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE');
`,
  );
  const privilegesByTable = new Map();
  for (const row of rowsFromResponse(grants)) {
    const table = String(row.table_name || row.tableName || '');
    const privilege = String(row.privilege_type || row.privilegeType || '').toUpperCase();
    if (!privilegesByTable.has(table)) {
      privilegesByTable.set(table, new Set());
    }
    privilegesByTable.get(table).add(privilege);
  }
  const requiredPrivileges = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
  const tablesMissingAuthenticatedGrants = expectedTables.filter((table) => {
    const privileges = privilegesByTable.get(table) || new Set();
    return requiredPrivileges.some((privilege) => !privileges.has(privilege));
  });

  const rls = await runReadOnlyQuery(
    `
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (${sqlStringList(expectedTables)})
  and c.relkind in ('r', 'p');
`,
  );
  const rlsByTable = new Map();
  for (const row of rowsFromResponse(rls)) {
    rlsByTable.set(String(row.table_name || row.tableName || ''), row.rls_enabled === true || row.rls_enabled === 'true');
  }
  const tablesMissingRls = expectedTables.filter((table) => rlsByTable.get(table) !== true);

  const publicPolicyRows = await runReadOnlyQuery(
    `
select tablename as table_name, policyname as policy_name
from pg_policies
where schemaname = 'public'
  and tablename in (${sqlStringList(expectedTables)});
`,
  );
  const publicPoliciesByTable = policiesByTable(publicPolicyRows);
  const missingPublicPolicies = Object.entries(expectedPublicPolicies).flatMap(([table, policies]) => {
    const applied = publicPoliciesByTable.get(table) || new Set();
    return policies.filter((policy) => !applied.has(policy)).map((policy) => `${table}:${policy}`);
  });

  const bucket = await runReadOnlyQuery(
    `
select exists (
  select 1
  from storage.buckets
  where id = 'attachments'
    and name = 'attachments'
    and public is false
) as attachments_bucket_ready;
`,
  );
  const firstBucketRow = rowsFromResponse(bucket)[0] || {};
  const attachmentsBucketReady =
    firstBucketRow.attachments_bucket_ready === true ||
    firstBucketRow.attachments_bucket_ready === 'true' ||
    firstBucketRow.attachmentsBucketReady === true ||
    firstBucketRow.attachmentsBucketReady === 'true';

  const storagePolicyRows = await runReadOnlyQuery(
    `
select policyname as policy_name
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects';
`,
  );
  const storagePolicies = new Set(rowsFromResponse(storagePolicyRows).map((row) => String(row.policy_name || row.policyName || '')));
  const missingStoragePolicies = expectedStoragePolicies.filter((policy) => !storagePolicies.has(policy));

  return {
    ready:
      missingTables.length === 0 &&
      tablesMissingAuthenticatedGrants.length === 0 &&
      tablesMissingRls.length === 0 &&
      missingPublicPolicies.length === 0 &&
      attachmentsBucketReady &&
      missingStoragePolicies.length === 0,
    missingTables,
    tablesMissingAuthenticatedGrants,
    tablesMissingRls,
    missingPublicPolicies,
    attachmentsBucketReady,
    missingStoragePolicies,
  };
}

function printSchemaReadiness(result) {
  console.log(`Tables: ${result.missingTables.length ? `missing ${result.missingTables.join(', ')}` : 'ok'}`);
  console.log(
    `Authenticated grants: ${
      result.tablesMissingAuthenticatedGrants.length
        ? `missing ${result.tablesMissingAuthenticatedGrants.join(', ')}`
      : 'ok'
    }`,
  );
  console.log(`RLS: ${result.tablesMissingRls.length ? `missing ${result.tablesMissingRls.join(', ')}` : 'ok'}`);
  console.log(
    `Public policies: ${
      result.missingPublicPolicies.length
        ? `missing ${result.missingPublicPolicies.join(', ')}`
        : 'ok'
    }`,
  );
  console.log(`Attachments bucket: ${result.attachmentsBucketReady ? 'ok' : 'missing or public'}`);
  console.log(
    `Storage policies: ${
      result.missingStoragePolicies.length
        ? `missing ${result.missingStoragePolicies.join(', ')}`
        : 'ok'
    }`,
  );
}

async function runReadOnlyQuery(query) {
  return managementRequest(`/v1/projects/${encodeURIComponent(projectRef)}/database/query/read-only`, {
    method: 'POST',
    body: {
      query,
      read_only: true,
    },
  });
}

async function managementRequest(path, { method, body }) {
  let response;
  let text = '';
  try {
    response = await fetch(`${managementApiUrl}${path}`, {
      method,
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

function policiesByTable(response) {
  const result = new Map();
  for (const row of rowsFromResponse(response)) {
    const table = String(row.table_name || row.tableName || '');
    const policy = String(row.policy_name || row.policyName || '');
    if (!table || !policy) {
      continue;
    }
    if (!result.has(table)) {
      result.set(table, new Set());
    }
    result.get(table).add(policy);
  }
  return result;
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

function sqlStringList(values) {
  return values.map((value) => `'${value.replace(/'/g, "''")}'`).join(', ');
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

function readEnvFile(path) {
  try {
    return Object.fromEntries(
      readFileSync(resolve(path), 'utf8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#') && line.includes('='))
        .map((line) => {
          const index = line.indexOf('=');
          const key = line.slice(0, index).trim();
          const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
          return [key, value];
        }),
    );
  } catch {
    return {};
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
