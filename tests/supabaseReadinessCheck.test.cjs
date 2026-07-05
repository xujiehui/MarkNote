
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

const result = spawnSync(process.execPath, ['scripts/print-supabase-readiness-check.mjs'], {
  cwd: process.cwd(),
  encoding: 'utf8',
});

assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
assert.match(result.stdout, /MarkNote Supabase sync readiness check/);
assert.match(result.stdout, /expected_tables\(table_name\) as/);
assert.match(result.stdout, /\('profiles'\)/);
assert.match(result.stdout, /\('devices'\)/);
assert.match(result.stdout, /\('folders'\)/);
assert.match(result.stdout, /\('notes'\)/);
assert.match(result.stdout, /\('attachments'\)/);
assert.match(result.stdout, /information_schema\.role_table_grants/);
assert.match(result.stdout, /grantee = 'authenticated'/);
assert.match(result.stdout, /relrowsecurity/);
assert.match(result.stdout, /n\.nspname = 'public'/);
assert.match(result.stdout, /c\.relkind in \('r', 'p'\)/);
assert.match(result.stdout, /pg_policies/);
assert.match(result.stdout, /storage\.buckets/);
assert.match(result.stdout, /storage grants/);
assert.match(result.stdout, /storage policies/);
assert.match(result.stdout, /attachments bucket/);
assert.match(result.stdout, /select 'tables' as check_name/);

console.log('supabase readiness check tests passed');
