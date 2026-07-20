const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

const endpoint = 'https://config.example.test/marknote/sync-config';

const localOnlyDir = buildDirectory('console.log("local only")');
const optionalResult = runCheck(localOnlyDir, {});
assert.equal(optionalResult.status, 0, optionalResult.stderr);

const missingSourceResult = runCheck(localOnlyDir, {
  MARKNOTE_REQUIRE_SYNC_CONFIG: '1',
});
assert.equal(missingSourceResult.status, 1);
assert.match(missingSourceResult.stderr, /VITE_SYNC_CONFIG_URL is missing/);

const missingBuildEndpointResult = runCheck(localOnlyDir, {
  MARKNOTE_REQUIRE_SYNC_CONFIG: '1',
  VITE_SYNC_CONFIG_URL: endpoint,
});
assert.equal(missingBuildEndpointResult.status, 1);
assert.match(missingBuildEndpointResult.stderr, /backend endpoint is missing from the build/);

const cloudSyncDir = buildDirectory(`globalThis.__MARKNOTE_ENV__={VITE_SYNC_CONFIG_URL:${JSON.stringify(endpoint)}}`);
const cloudSyncResult = runCheck(cloudSyncDir, {
  MARKNOTE_REQUIRE_SYNC_CONFIG: '1',
  VITE_SYNC_CONFIG_URL: endpoint,
});
assert.equal(cloudSyncResult.status, 0, cloudSyncResult.stderr);

console.log('distribution config tests passed');

function buildDirectory(source) {
  const directory = mkdtempSync(join(tmpdir(), 'marknote-distribution-config-'));
  writeFileSync(join(directory, 'index.js'), source);
  return directory;
}

function runCheck(directory, env) {
  return spawnSync(process.execPath, ['scripts/check-distribution-config.mjs', directory], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      MARKNOTE_SYNC_CONFIG_URL: '',
      VITE_SYNC_CONFIG_URL: '',
      MARKNOTE_REQUIRE_SYNC_CONFIG: '',
      ...env,
    },
  });
}
