
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const scripts = packageJson.scripts || {};

assert.equal(scripts['check:google-oauth'], 'node scripts/check-google-oauth.mjs');
assert.equal(scripts['check:pages-deployment'], 'node scripts/check-pages-deployment.mjs');
assert.equal(scripts['check:supabase-sync:oauth'], 'node scripts/check-supabase-sync.mjs --oauth-login --require-auth');
assert.equal(scripts['check:supabase-migration'], 'node scripts/apply-supabase-migration.mjs');
assert.equal(scripts['apply:supabase-migration'], 'node scripts/apply-supabase-migration.mjs --apply');
assert.equal(scripts['print:supabase-readiness-check'], 'node scripts/print-supabase-readiness-check.mjs');

assertIncludesAll(scripts['verify:release:local'], [
  'npm test',
  'npm run desktop:pack',
  'npm run check:desktop-package',
]);
assertIncludesAll(scripts['verify:release:online'], [
  'npm run check:google-oauth',
  'npm run check:supabase-migration',
  'npm run check:supabase-sync:oauth',
]);
assertIncludesAll(scripts['verify:release:online:manual'], [
  'npm run check:google-oauth',
  'npm run check:supabase-sync:oauth',
]);
assert.doesNotMatch(scripts['verify:release:online:manual'], /check:supabase-migration/);
assertIncludesAll(scripts['verify:release:online:apply'], [
  'npm run check:google-oauth',
  'npm run apply:supabase-migration',
  'npm run check:supabase-sync:oauth',
]);

console.log('package scripts tests passed');

function assertIncludesAll(value, commands) {
  assert.equal(typeof value, 'string');
  for (const command of commands) {
    assert.match(value, new RegExp(escapeRegExp(command)));
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
