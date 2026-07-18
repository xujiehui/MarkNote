
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

const tempDir = mkdtempSync(join(tmpdir(), 'marknote-supabase-apply-'));
const syncConfigPreloadPath = join(process.cwd(), 'tests/sync-config-preload.cjs');
const syncConfigEnv = {
  MARKNOTE_SYNC_CONFIG_URL: 'https://config.example.test/marknote/sync-config',
  MARKNOTE_TEST_SYNC_CONFIG_JSON: JSON.stringify({
    provider: 'supabase',
    supabase: {
      url: 'https://projectref.supabase.co',
      publishableKey: 'sb_publishable_test',
    },
  }),
};
const expectedTables = ['profiles', 'devices', 'folders', 'notes', 'attachments'];
const expectedTableRows = expectedTables.map((table_name) => ({ table_name }));
const expectedGrantRows = expectedTables.flatMap((table_name) =>
  ['SELECT', 'INSERT', 'UPDATE', 'DELETE'].map((privilege_type) => ({ table_name, privilege_type })),
);
const expectedRlsRows = expectedTables.map((table_name) => ({ table_name, rls_enabled: true }));
const expectedPublicPolicyRows = [
  ['profiles', 'Users can read own profile'],
  ['profiles', 'Users can insert own profile'],
  ['profiles', 'Users can update own profile'],
  ['devices', 'Users can read own devices'],
  ['devices', 'Users can insert own devices'],
  ['devices', 'Users can update own devices'],
  ['devices', 'Users can delete own devices'],
  ['folders', 'Users can read own folders'],
  ['folders', 'Users can insert own folders'],
  ['folders', 'Users can update own folders'],
  ['folders', 'Users can delete own folders'],
  ['notes', 'Users can read own notes'],
  ['notes', 'Users can insert own notes'],
  ['notes', 'Users can update own notes'],
  ['notes', 'Users can delete own notes'],
  ['attachments', 'Users can read own attachments'],
  ['attachments', 'Users can insert own attachments'],
  ['attachments', 'Users can update own attachments'],
  ['attachments', 'Users can delete own attachments'],
].map(([table_name, policy_name]) => ({ table_name, policy_name }));
const expectedStoragePolicyRows = [
  'Users can read own attachment objects',
  'Users can upload own attachment objects',
  'Users can update own attachment objects',
  'Users can delete own attachment objects',
].map((policy_name) => ({ policy_name }));

const readyPreloadPath = join(tempDir, 'ready-preload.cjs');
writeFileSync(
  readyPreloadPath,
  `
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  assertAuth(init);
  if (url.endsWith('/database/migrations')) {
    return jsonResponse(200, [{ version: '202606190001', name: 'marknote_sync_schema' }]);
  }
  if (url.endsWith('/database/query/read-only')) {
    const body = JSON.parse(init.body || '{}');
    if (body.query.includes('information_schema.tables')) {
      return jsonResponse(200, ${JSON.stringify(expectedTableRows)});
    }
    if (body.query.includes('information_schema.role_table_grants')) {
      return jsonResponse(200, ${JSON.stringify(expectedGrantRows)});
    }
    if (body.query.includes('pg_class')) {
      return jsonResponse(200, ${JSON.stringify(expectedRlsRows)});
    }
    if (body.query.includes("schemaname = 'public'")) {
      return jsonResponse(200, ${JSON.stringify(expectedPublicPolicyRows)});
    }
    if (body.query.includes('storage.buckets')) {
      return jsonResponse(200, [{ attachments_bucket_ready: true }]);
    }
    if (body.query.includes("schemaname = 'storage'")) {
      return jsonResponse(200, ${JSON.stringify(expectedStoragePolicyRows)});
    }
  }
  return jsonResponse(500, { message: 'Unexpected URL: ' + url });
};
function assertAuth(init) {
  if (init.headers.authorization !== 'Bearer management-token') throw new Error('missing management token');
}
function jsonResponse(status, body) {
  return { status, async text() { return JSON.stringify(body); } };
}
`,
);

const readyResult = runScript(['--require', readyPreloadPath, 'scripts/apply-supabase-migration.mjs']);
assert.equal(readyResult.status, 0, `${readyResult.stdout}\n${readyResult.stderr}`);
assert.match(readyResult.stdout, /Migration history: found 202606190001/);
assert.match(readyResult.stdout, /Sync schema already appears ready/);
assert.match(readyResult.stdout, /verify:release:online:manual/);

const applyPreloadPath = join(tempDir, 'apply-preload.cjs');
writeFileSync(
  applyPreloadPath,
  `
let applied = false;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  assertAuth(init);
  if (url.endsWith('/database/migrations') && init.method === 'GET') {
    return jsonResponse(200, []);
  }
  if (url.endsWith('/database/migrations') && init.method === 'POST') {
    const body = JSON.parse(init.body || '{}');
    if (body.name !== 'marknote_sync_schema') throw new Error('wrong migration name');
    if (!body.query.includes('create table if not exists public.notes')) throw new Error('missing migration SQL');
    applied = true;
    return jsonResponse(201, { id: 'migration-id' });
  }
  if (url.endsWith('/database/query/read-only')) {
    const body = JSON.parse(init.body || '{}');
    if (!applied) {
      if (body.query.includes('information_schema.tables')) return jsonResponse(200, []);
      if (body.query.includes('information_schema.role_table_grants')) return jsonResponse(200, []);
      if (body.query.includes('pg_class')) return jsonResponse(200, []);
      if (body.query.includes("schemaname = 'public'")) return jsonResponse(200, []);
      if (body.query.includes('storage.buckets')) return jsonResponse(200, [{ attachments_bucket_ready: false }]);
      if (body.query.includes("schemaname = 'storage'")) return jsonResponse(200, []);
    }
    if (body.query.includes('information_schema.tables')) {
      return jsonResponse(200, ${JSON.stringify(expectedTableRows)});
    }
    if (body.query.includes('information_schema.role_table_grants')) {
      return jsonResponse(200, ${JSON.stringify(expectedGrantRows)});
    }
    if (body.query.includes('pg_class')) {
      return jsonResponse(200, ${JSON.stringify(expectedRlsRows)});
    }
    if (body.query.includes("schemaname = 'public'")) {
      return jsonResponse(200, ${JSON.stringify(expectedPublicPolicyRows)});
    }
    if (body.query.includes('storage.buckets')) {
      return jsonResponse(200, [{ attachments_bucket_ready: true }]);
    }
    if (body.query.includes("schemaname = 'storage'")) {
      return jsonResponse(200, ${JSON.stringify(expectedStoragePolicyRows)});
    }
  }
  return jsonResponse(500, { message: 'Unexpected URL: ' + url });
};
function assertAuth(init) {
  if (init.headers.authorization !== 'Bearer management-token') throw new Error('missing management token');
}
function jsonResponse(status, body) {
  return { status, async text() { return JSON.stringify(body); } };
}
`,
);

const applyResult = runScript(['--require', applyPreloadPath, 'scripts/apply-supabase-migration.mjs', '--apply']);
assert.equal(applyResult.status, 0, `${applyResult.stdout}\n${applyResult.stderr}`);
assert.match(applyResult.stdout, /Migration history: MarkNote sync migration has not been recorded/);
assert.match(applyResult.stdout, /Applying marknote_sync_schema/);
assert.match(applyResult.stdout, /Supabase sync schema: ready/);
assert.match(applyResult.stdout, /verify:release:online:manual/);

const dryRunResult = runScript(['--require', applyPreloadPath, 'scripts/apply-supabase-migration.mjs']);
assert.notEqual(dryRunResult.status, 0, `${dryRunResult.stdout}\n${dryRunResult.stderr}`);
assert.match(dryRunResult.stderr, /Supabase sync schema is not ready/);
assert.match(dryRunResult.stderr, /Dry run only/);
assert.match(dryRunResult.stderr, /npm run apply:supabase-migration/);
assert.doesNotMatch(dryRunResult.stdout, /Supabase sync schema: ready/);

const missingPolicyPreloadPath = join(tempDir, 'missing-policy-preload.cjs');
writeFileSync(
  missingPolicyPreloadPath,
  `
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  assertAuth(init);
  if (url.endsWith('/database/migrations')) {
    return jsonResponse(200, [{ version: '202606190001', name: 'marknote_sync_schema' }]);
  }
  if (url.endsWith('/database/query/read-only')) {
    const body = JSON.parse(init.body || '{}');
    if (body.query.includes('information_schema.tables')) {
      return jsonResponse(200, ${JSON.stringify(expectedTableRows)});
    }
    if (body.query.includes('information_schema.role_table_grants')) {
      return jsonResponse(200, ${JSON.stringify(expectedGrantRows)});
    }
    if (body.query.includes('pg_class')) {
      return jsonResponse(200, ${JSON.stringify(expectedRlsRows)});
    }
    if (body.query.includes("schemaname = 'public'")) {
      return jsonResponse(200, ${JSON.stringify(expectedPublicPolicyRows.filter((row) => row.policy_name !== 'Users can update own notes'))});
    }
    if (body.query.includes('storage.buckets')) {
      return jsonResponse(200, [{ attachments_bucket_ready: true }]);
    }
    if (body.query.includes("schemaname = 'storage'")) {
      return jsonResponse(200, ${JSON.stringify(expectedStoragePolicyRows.filter((row) => row.policy_name !== 'Users can delete own attachment objects'))});
    }
  }
  return jsonResponse(500, { message: 'Unexpected URL: ' + url });
};
function assertAuth(init) {
  if (init.headers.authorization !== 'Bearer management-token') throw new Error('missing management token');
}
function jsonResponse(status, body) {
  return { status, async text() { return JSON.stringify(body); } };
}
`,
);

const missingPolicyResult = runScript(['--require', missingPolicyPreloadPath, 'scripts/apply-supabase-migration.mjs']);
assert.notEqual(missingPolicyResult.status, 0, `${missingPolicyResult.stdout}\n${missingPolicyResult.stderr}`);
assert.match(missingPolicyResult.stdout, /Public policies: missing notes:Users can update own notes/);
assert.match(missingPolicyResult.stdout, /Storage policies: missing Users can delete own attachment objects/);
assert.match(missingPolicyResult.stderr, /Supabase sync schema is not ready/);

const missingTokenResult = spawnSync(process.execPath, ['--require', syncConfigPreloadPath, 'scripts/apply-supabase-migration.mjs'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  env: {
    ...syncConfigEnv,
    MARKNOTE_SUPABASE_URL: '',
    MARKNOTE_SUPABASE_PUBLISHABLE_KEY: '',
    VITE_SUPABASE_URL: '',
    VITE_SUPABASE_PUBLISHABLE_KEY: '',
    SUPABASE_MANAGEMENT_TOKEN: '',
    SUPABASE_API_ACCESS_TOKEN: '',
    SUPABASE_PAT: '',
  },
});
assert.notEqual(missingTokenResult.status, 0);
assert.match(missingTokenResult.stderr, /SUPABASE_MANAGEMENT_TOKEN is missing/);

console.log('supabase migration apply tests passed');

function runScript(args) {
  const scriptIndex = args.findIndex((arg) => arg.endsWith('.mjs'));
  return spawnSync(process.execPath, [
    ...args.slice(0, scriptIndex),
    '--require',
    syncConfigPreloadPath,
    ...args.slice(scriptIndex),
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      ...syncConfigEnv,
      MARKNOTE_SUPABASE_URL: '',
      MARKNOTE_SUPABASE_PUBLISHABLE_KEY: '',
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_PUBLISHABLE_KEY: '',
      SUPABASE_PROJECT_REF: '',
      SUPABASE_MANAGEMENT_TOKEN: 'management-token',
      SUPABASE_API_ACCESS_TOKEN: '',
      SUPABASE_PAT: '',
    },
  });
}
