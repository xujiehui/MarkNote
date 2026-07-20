const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

const workflow = readFileSync('.github/workflows/pages.yml', 'utf8');

assert.match(workflow, /VITE_SYNC_CONFIG_URL: \$\{\{ vars\.MARKNOTE_SYNC_CONFIG_URL \}\}/);
assert.match(workflow, /MARKNOTE_REQUIRE_SYNC_CONFIG: '1'/);
assert.match(
  workflow,
  /MARKNOTE_SUPABASE_AUTH_REDIRECT_URL: https:\/\/\$\{\{ github\.repository_owner \}\}\.github\.io\/\$\{\{ github\.event\.repository\.name \}\}\/\?app=1/,
);
assert.match(workflow, /- name: Verify Pages cloud sync and OAuth\s+run: npm run check:google-oauth/);
assert.match(workflow, /- name: Build site\s+run: npm run build/);

console.log('pages workflow tests passed');
