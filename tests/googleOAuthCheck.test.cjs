
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

const tempDir = mkdtempSync(join(tmpdir(), 'marknote-google-oauth-check-'));
const syncConfigPreloadPath = join(process.cwd(), 'tests/sync-config-preload.cjs');
const syncConfigEnv = {
  MARKNOTE_SYNC_CONFIG_URL: 'https://config.example.test/marknote/sync-config',
  MARKNOTE_TEST_SYNC_CONFIG_JSON: JSON.stringify({
    provider: 'supabase',
    supabase: {
      url: 'https://localhost',
      publishableKey: 'sb_publishable_test',
      authRedirectUrl: 'http://127.0.0.1:5173/?app=1',
    },
  }),
};

const successPreloadPath = join(tempDir, 'success-preload.cjs');
writeFileSync(
  successPreloadPath,
  `
globalThis.fetch = async (input) => {
  const url = String(input);
  if (url.includes('/auth/v1/authorize')) {
    return redirectResponse('https://accounts.google.com/o/oauth2/v2/auth?client_id=ok');
  }
  if (url.includes('accounts.google.com')) {
    return textResponse(200, 'google ok');
  }
  throw new Error('Unexpected URL: ' + url);
};
function redirectResponse(location) {
  return {
    status: 302,
    headers: { get(name) { return name.toLowerCase() === 'location' ? location : ''; } },
    async text() { return ''; },
  };
}
function textResponse(status, body) {
  return {
    status,
    headers: { get() { return ''; } },
    async text() { return body; },
  };
}
`,
);

const successResult = runCheck(successPreloadPath);
assert.equal(successResult.status, 0, `${successResult.stdout}\n${successResult.stderr}`);
assert.match(successResult.stdout, /Google OAuth provider is reachable/);
assert.match(successResult.stdout, /Google Cloud authorized redirect URI: https:\/\/localhost\/auth\/v1\/callback/);

const supabaseTlsPreloadPath = join(tempDir, 'supabase-tls-preload.cjs');
writeFileSync(
  supabaseTlsPreloadPath,
  `
globalThis.fetch = async (input) => {
  if (String(input).includes('/auth/v1/authorize')) {
    const cause = new Error('Client network socket disconnected before secure TLS connection was established');
    cause.code = 'ECONNRESET';
    throw new Error('fetch failed', { cause });
  }
  return textResponse(200, '');
};
function textResponse(status, body) {
  return {
    status,
    headers: { get() { return ''; } },
    async text() { return body; },
  };
}
`,
);

const supabaseTlsResult = runCheck(supabaseTlsPreloadPath);
assert.equal(supabaseTlsResult.status, 1);
assert.match(supabaseTlsResult.stderr, /Could not reach Supabase Auth endpoint/);
assert.match(supabaseTlsResult.stderr, /before Auth\/Data API checks could run/);
assert.match(supabaseTlsResult.stderr, /TLS connection was reset/);
assert.match(supabaseTlsResult.stderr, /caused by: ECONNRESET/);

const googleTlsPreloadPath = join(tempDir, 'google-tls-preload.cjs');
writeFileSync(
  googleTlsPreloadPath,
  `
globalThis.fetch = async (input) => {
  const url = String(input);
  if (url.includes('/auth/v1/authorize')) {
    return redirectResponse('https://accounts.google.com/o/oauth2/v2/auth?client_id=ok');
  }
  if (url.includes('accounts.google.com')) {
    const cause = new Error('TLS handshake failed');
    cause.code = 'ECONNRESET';
    throw new Error('fetch failed', { cause });
  }
  throw new Error('Unexpected URL: ' + url);
};
function redirectResponse(location) {
  return {
    status: 302,
    headers: { get(name) { return name.toLowerCase() === 'location' ? location : ''; } },
    async text() { return ''; },
  };
}
`,
);

const googleTlsResult = runCheck(googleTlsPreloadPath);
assert.equal(googleTlsResult.status, 1);
assert.match(googleTlsResult.stderr, /Could not reach Google OAuth endpoint/);
assert.match(googleTlsResult.stderr, /Google OAuth endpoint could not be reached/);
assert.match(googleTlsResult.stderr, /TLS connection was reset/);
assert.match(googleTlsResult.stderr, /caused by: ECONNRESET TLS handshake failed/);

const invalidClientPreloadPath = join(tempDir, 'invalid-client-preload.cjs');
writeFileSync(
  invalidClientPreloadPath,
  `
globalThis.fetch = async (input) => {
  const url = String(input);
  if (url.includes('/auth/v1/authorize')) {
    return redirectResponse('https://accounts.google.com/signin/oauth/error?client_id=bad');
  }
  if (url.includes('/signin/oauth/error')) {
    return textResponse(200, '<html>Access blocked: Authorization Error Error 401: invalid_client The OAuth client was not found.</html>');
  }
  throw new Error('Unexpected URL: ' + url);
};
function redirectResponse(location) {
  return {
    status: 302,
    headers: { get(name) { return name.toLowerCase() === 'location' ? location : ''; } },
    async text() { return ''; },
  };
}
function textResponse(status, body) {
  return {
    status,
    headers: { get() { return ''; } },
    async text() { return body; },
  };
}
`,
);

const invalidClientResult = runCheck(invalidClientPreloadPath);
assert.equal(invalidClientResult.status, 1);
assert.match(invalidClientResult.stderr, /invalid_client/);
assert.match(invalidClientResult.stderr, /OAuth client must be a Web application/);
assert.match(invalidClientResult.stderr, /https:\/\/localhost\/auth\/v1\/callback/);

console.log('google oauth check tests passed');

function runCheck(preloadPath) {
  return spawnSync(process.execPath, ['--require', preloadPath, '--require', syncConfigPreloadPath, 'scripts/check-google-oauth.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      ...syncConfigEnv,
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_AUTH_REDIRECT_URL: '',
    },
  });
}
