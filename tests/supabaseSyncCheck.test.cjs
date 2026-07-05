
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

const tempDir = mkdtempSync(join(tmpdir(), 'marknote-sync-check-'));
const userId = '00000000-0000-4000-8000-000000000123';
const token = jwtWithSub(userId);
const preloadPath = join(tempDir, 'preload.cjs');
const oauthPreloadPath = join(tempDir, 'oauth-preload.cjs');

writeFileSync(
  preloadPath,
  `
const assert = require('node:assert/strict');
const deletedObjects = new Set();
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const method = init.method || 'GET';
  if (url.includes('/auth/v1/health')) {
    return jsonResponse(200, { status: 'ok' });
  }
  if (url.includes('/rest/v1/')) {
    if (method === 'GET' && url.includes('id=eq.marknote-diagnostic-')) {
      return jsonResponse(200, []);
    }
    if (method === 'POST' || method === 'PATCH') {
      const body = JSON.parse(init.body || '{}');
      assert.ok(body.id || body.title);
      return jsonResponse(201, []);
    }
    if (method === 'DELETE') {
      assert.match(url, /user_id=eq\\.${userId}/);
      return jsonResponse(204, []);
    }
    return jsonResponse(200, []);
  }
  if (url.includes('/storage/v1/object/list/attachments')) {
    const body = JSON.parse(init.body || '{}');
    assert.equal(body.prefix, '${userId}');
    assert.equal(body.limit, 1);
    return jsonResponse(200, []);
  }
  if (url.includes('/storage/v1/object/attachments/') && method === 'POST') {
    assert.equal(url.includes('/${userId}/.marknote-diagnostics/'), true);
    assert.match(init.headers['x-upsert'], /^(true|false)$/);
    return jsonResponse(200, { Key: 'canary' });
  }
  if (url.includes('/storage/v1/object/authenticated/attachments/') && method === 'GET') {
    assert.equal(url.includes('/${userId}/.marknote-diagnostics/'), true);
    for (const objectPath of deletedObjects) {
      if (url.includes(objectPath)) {
        return jsonResponse(404, { message: 'Object not found' });
      }
    }
    return textResponse(200, 'marknote storage diagnostic v2');
  }
  if (url.includes('/storage/v1/object/attachments') && method === 'DELETE') {
    const body = JSON.parse(init.body || '{}');
    assert.match(body.prefixes[0], /^${userId}\\/\\.marknote-diagnostics\\/check-supabase-sync-/);
    deletedObjects.add(body.prefixes[0]);
    return jsonResponse(200, []);
  }
  throw new Error('Unexpected URL: ' + url);
};
function jsonResponse(status, body) {
  return {
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}
function textResponse(status, body) {
  return {
    status,
    async text() {
      return body;
    },
  };
}
`,
);

writeFileSync(
  oauthPreloadPath,
  `
const assert = require('node:assert/strict');
const deletedObjects = new Set();
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const method = init.method || 'GET';
  if (url.includes('marknote-oauth.test/callback')) {
    return textResponse(200, 'http://marknote-oauth.test/callback?code=oauth-test-code');
  }
  if (url.includes('/auth/v1/token?grant_type=pkce')) {
    const body = JSON.parse(init.body || '{}');
    assert.equal(body.auth_code, 'oauth-test-code');
    assert.equal(typeof body.code_verifier, 'string');
    return jsonResponse(200, {
      access_token: '${token}',
      refresh_token: 'refresh-token',
      expires_in: 3600,
      token_type: 'bearer',
      user: {
        id: '${userId}',
        aud: 'authenticated',
        role: 'authenticated',
        email: 'oauth@example.com',
      },
    });
  }
  if (url.includes('/auth/v1/health')) {
    return jsonResponse(200, { status: 'ok' });
  }
  if (url.includes('/rest/v1/')) {
    if (method === 'GET' && url.includes('id=eq.marknote-diagnostic-')) {
      return jsonResponse(200, []);
    }
    if (method === 'POST' || method === 'PATCH') {
      const body = JSON.parse(init.body || '{}');
      assert.ok(body.id || body.title);
      return jsonResponse(201, []);
    }
    if (method === 'DELETE') {
      assert.match(url, /user_id=eq\\.${userId}/);
      return jsonResponse(204, []);
    }
    return jsonResponse(200, []);
  }
  if (url.includes('/storage/v1/object/list/attachments')) {
    const body = JSON.parse(init.body || '{}');
    assert.equal(body.prefix, '${userId}');
    assert.equal(body.limit, 1);
    return jsonResponse(200, []);
  }
  if (url.includes('/storage/v1/object/attachments/') && method === 'POST') {
    assert.equal(url.includes('/${userId}/.marknote-diagnostics/'), true);
    assert.match(init.headers['x-upsert'], /^(true|false)$/);
    return jsonResponse(200, { Key: 'canary' });
  }
  if (url.includes('/storage/v1/object/authenticated/attachments/') && method === 'GET') {
    assert.equal(url.includes('/${userId}/.marknote-diagnostics/'), true);
    for (const objectPath of deletedObjects) {
      if (url.includes(objectPath)) {
        return jsonResponse(404, { message: 'Object not found' });
      }
    }
    return textResponse(200, 'marknote storage diagnostic v2');
  }
  if (url.includes('/storage/v1/object/attachments') && method === 'DELETE') {
    const body = JSON.parse(init.body || '{}');
    assert.match(body.prefixes[0], /^${userId}\\/\\.marknote-diagnostics\\/check-supabase-sync-/);
    deletedObjects.add(body.prefixes[0]);
    return jsonResponse(200, []);
  }
  throw new Error('Unexpected URL: ' + url);
};
function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get() { return ''; } },
    async text() {
      return JSON.stringify(body);
    },
    async json() {
      return body;
    },
  };
}
function textResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get() { return ''; } },
    async text() {
      return body;
    },
  };
}
`,
);

const result = spawnSync(process.execPath, ['--require', preloadPath, 'scripts/check-supabase-sync.mjs'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  env: {
    ...process.env,
    VITE_SUPABASE_URL: 'https://localhost',
    VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    SUPABASE_ACCESS_TOKEN: token,
  },
});

assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
assert.ok(result.stdout.includes('  profiles: ok'), result.stdout);
assert.ok(result.stdout.includes(`Attachments bucket list: ok (${userId}/ prefix)`), result.stdout);
assert.ok(result.stdout.includes('Sync table writes: ok'), result.stdout);
assert.ok(result.stdout.includes('Attachment storage canary: ok'), result.stdout);

const oauthResult = spawnSync(process.execPath, ['--require', oauthPreloadPath, 'scripts/check-supabase-sync.mjs', '--oauth-login', '--require-auth'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  env: {
    ...process.env,
    VITE_SUPABASE_URL: 'https://localhost',
    VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    SUPABASE_ACCESS_TOKEN: '',
    MARKNOTE_SUPABASE_OAUTH_OPEN: '0',
    MARKNOTE_SUPABASE_OAUTH_TEST_CALLBACK_URL: 'http://marknote-oauth.test/callback',
    MARKNOTE_SUPABASE_OAUTH_TIMEOUT_MS: '10000',
  },
});
assert.equal(oauthResult.status, 0, `${oauthResult.stdout}\n${oauthResult.stderr}`);
assert.match(oauthResult.stdout, /OAuth login: signed in as oauth@example.com/);
assert.match(oauthResult.stdout, /Sync table writes: ok/);
assert.match(oauthResult.stdout, /Attachment storage canary: ok/);

const skippedAuthResult = spawnSync(process.execPath, ['--require', preloadPath, 'scripts/check-supabase-sync.mjs'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  env: {
    ...process.env,
    VITE_SUPABASE_URL: 'https://localhost',
    VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    SUPABASE_ACCESS_TOKEN: '',
  },
});

assert.equal(skippedAuthResult.status, 0, `${skippedAuthResult.stdout}\n${skippedAuthResult.stderr}`);
assert.match(skippedAuthResult.stdout, /Signed-in table check: skipped/);
assert.match(skippedAuthResult.stdout, /check:supabase-sync:oauth/);
assert.match(skippedAuthResult.stdout, /check:supabase-sync:auth/);
assert.match(skippedAuthResult.stdout, /Diagnose sync/);

const fetchCausePreloadPath = join(tempDir, 'fetch-cause-preload.cjs');
writeFileSync(
  fetchCausePreloadPath,
  `
globalThis.fetch = async (input) => {
  if (String(input).includes('/auth/v1/health')) {
    const cause = new Error('TLS handshake failed');
    cause.code = 'ECONNRESET';
    throw new Error('fetch failed', { cause });
  }
  return {
    status: 200,
    async text() {
      return '[]';
    },
  };
};
`,
);
const fetchCauseResult = spawnSync(process.execPath, ['--require', fetchCausePreloadPath, 'scripts/check-supabase-sync.mjs'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  env: {
    ...process.env,
    VITE_SUPABASE_URL: 'https://localhost',
    VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    SUPABASE_ACCESS_TOKEN: '',
  },
});

assert.equal(fetchCauseResult.status, 1);
assert.match(fetchCauseResult.stderr, /Could not reach Supabase Auth health endpoint/);
assert.match(fetchCauseResult.stderr, /before Auth\/Data API checks could run/);
assert.match(fetchCauseResult.stderr, /TLS connection was reset/);
assert.match(fetchCauseResult.stderr, /caused by: ECONNRESET TLS handshake failed/);

const schemaCachePreloadPath = join(tempDir, 'schema-cache-preload.cjs');
writeFileSync(
  schemaCachePreloadPath,
  `
globalThis.fetch = async (input) => {
  const url = String(input);
  if (url.includes('/auth/v1/health')) {
    return jsonResponse(200, { status: 'ok' });
  }
  if (url.includes('/rest/v1/')) {
    return jsonResponse(404, {
      code: 'PGRST205',
      message: "Could not find the table 'public.notes' in the schema cache",
    });
  }
  return jsonResponse(500, { message: 'Unexpected URL: ' + url });
};
function jsonResponse(status, body) {
  return {
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}
`,
);

const schemaCacheResult = spawnSync(process.execPath, ['--require', schemaCachePreloadPath, 'scripts/check-supabase-sync.mjs'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  env: {
    ...process.env,
    VITE_SUPABASE_URL: 'https://localhost',
    VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    SUPABASE_ACCESS_TOKEN: token,
  },
});

assert.notEqual(schemaCacheResult.status, 0, `${schemaCacheResult.stdout}\n${schemaCacheResult.stderr}`);
assert.match(schemaCacheResult.stderr, /missing from the Supabase Data API schema cache/);
assert.match(schemaCacheResult.stderr, /npm run check:supabase-migration/);
assert.match(schemaCacheResult.stderr, /npm run apply:supabase-migration/);
assert.match(schemaCacheResult.stderr, /npm run print:supabase-migration/);
assert.match(schemaCacheResult.stderr, /npm run verify:release:online:manual/);

const missingAuthResult = spawnSync(process.execPath, ['--require', preloadPath, 'scripts/check-supabase-sync.mjs', '--require-auth'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  env: {
    ...process.env,
    VITE_SUPABASE_URL: 'https://localhost',
    VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    SUPABASE_ACCESS_TOKEN: '',
  },
});

assert.notEqual(missingAuthResult.status, 0, `${missingAuthResult.stdout}\n${missingAuthResult.stderr}`);
assert.match(missingAuthResult.stderr, /SUPABASE_ACCESS_TOKEN is missing/);
assert.match(missingAuthResult.stderr, /check:supabase-sync:oauth/);
assert.match(missingAuthResult.stderr, /Diagnose sync/);

const envRequireAuthResult = spawnSync(process.execPath, ['--require', preloadPath, 'scripts/check-supabase-sync.mjs'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  env: {
    ...process.env,
    VITE_SUPABASE_URL: 'https://localhost',
    VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    SUPABASE_ACCESS_TOKEN: '',
    MARKNOTE_REQUIRE_SUPABASE_ACCESS_TOKEN: '1',
  },
});

assert.notEqual(envRequireAuthResult.status, 0, `${envRequireAuthResult.stdout}\n${envRequireAuthResult.stderr}`);
assert.match(envRequireAuthResult.stderr, /SUPABASE_ACCESS_TOKEN is missing/);

const failingPreloadPath = join(tempDir, 'failing-preload.cjs');
writeFileSync(
  failingPreloadPath,
  `
const assert = require('node:assert/strict');
const cleanupDeletes = [];
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const method = init.method || 'GET';
  if (url.includes('/auth/v1/health')) {
    return jsonResponse(200, { status: 'ok' });
  }
  if (url.includes('/rest/v1/')) {
    if (method === 'GET') {
      return jsonResponse(200, []);
    }
    if (method === 'POST' && url.includes('/rest/v1/folders')) {
      return jsonResponse(201, []);
    }
    if (method === 'POST' && url.includes('/rest/v1/notes')) {
      return jsonResponse(403, { code: '42501', message: 'permission denied for table notes' });
    }
    if (method === 'DELETE') {
      cleanupDeletes.push(url);
      if (cleanupDeletes.length === 3) {
        assert.equal(cleanupDeletes.some((value) => value.includes('/rest/v1/folders')), true);
        process.stderr.write('[cleanup-ok]');
      }
      return jsonResponse(204, []);
    }
  }
  if (url.includes('/storage/v1/object/list/attachments')) {
    return jsonResponse(200, []);
  }
  return jsonResponse(500, { message: 'Unexpected URL: ' + url });
};
function jsonResponse(status, body) {
  return {
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}
`,
);

const failingResult = spawnSync(process.execPath, ['--require', failingPreloadPath, 'scripts/check-supabase-sync.mjs'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  env: {
    ...process.env,
    VITE_SUPABASE_URL: 'https://localhost',
    VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    SUPABASE_ACCESS_TOKEN: token,
  },
});

assert.notEqual(failingResult.status, 0, `${failingResult.stdout}\n${failingResult.stderr}`);
assert.match(failingResult.stderr, /Sync table note insert check failed/);
assert.match(failingResult.stderr, /\[cleanup-ok\]/);

const invalidTokenPreloadPath = join(tempDir, 'invalid-token-preload.cjs');
writeFileSync(
  invalidTokenPreloadPath,
  `
globalThis.fetch = async (input) => {
  const url = String(input);
  if (url.includes('/auth/v1/health')) {
    return jsonResponse(200, { status: 'ok' });
  }
  if (url.includes('/rest/v1/')) {
    return jsonResponse(401, { code: 'PGRST301', message: 'JWT expired' });
  }
  return jsonResponse(500, { message: 'Unexpected URL: ' + url });
};
function jsonResponse(status, body) {
  return {
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}
`,
);

const invalidTokenResult = spawnSync(process.execPath, ['--require', invalidTokenPreloadPath, 'scripts/check-supabase-sync.mjs'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  env: {
    ...process.env,
    VITE_SUPABASE_URL: 'https://localhost',
    VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    SUPABASE_ACCESS_TOKEN: token,
  },
});

assert.notEqual(invalidTokenResult.status, 0, `${invalidTokenResult.stdout}\n${invalidTokenResult.stderr}`);
assert.match(invalidTokenResult.stderr, /SUPABASE_ACCESS_TOKEN was rejected/);
assert.match(invalidTokenResult.stderr, /Sign in again/);
assert.doesNotMatch(invalidTokenResult.stderr, /GRANT \+ RLS policies/);

const deleteFailPreloadPath = join(tempDir, 'delete-fail-preload.cjs');
writeFileSync(
  deleteFailPreloadPath,
  `
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const method = init.method || 'GET';
  if (url.includes('/auth/v1/health')) {
    return jsonResponse(200, { status: 'ok' });
  }
  if (url.includes('/rest/v1/')) {
    if (method === 'GET') {
      return jsonResponse(200, []);
    }
    if (method === 'POST' || method === 'PATCH') {
      return jsonResponse(201, []);
    }
    if (method === 'DELETE' && url.includes('/rest/v1/folders')) {
      return jsonResponse(403, { code: '42501', message: 'permission denied for table folders' });
    }
    if (method === 'DELETE') {
      return jsonResponse(204, []);
    }
  }
  if (url.includes('/storage/v1/object/list/attachments')) {
    return jsonResponse(200, []);
  }
  return jsonResponse(500, { message: 'Unexpected URL: ' + url });
};
function jsonResponse(status, body) {
  return {
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}
`,
);

const deleteFailResult = spawnSync(process.execPath, ['--require', deleteFailPreloadPath, 'scripts/check-supabase-sync.mjs'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  env: {
    ...process.env,
    VITE_SUPABASE_URL: 'https://localhost',
    VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    SUPABASE_ACCESS_TOKEN: token,
  },
});

assert.notEqual(deleteFailResult.status, 0, `${deleteFailResult.stdout}\n${deleteFailResult.stderr}`);
assert.match(deleteFailResult.stderr, /Sync table folder delete check failed/);
assert.doesNotMatch(deleteFailResult.stdout, /Attachment storage canary: ok/);

const leftoverPreloadPath = join(tempDir, 'leftover-preload.cjs');
writeFileSync(
  leftoverPreloadPath,
  `
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const method = init.method || 'GET';
  if (url.includes('/auth/v1/health')) {
    return jsonResponse(200, { status: 'ok' });
  }
  if (url.includes('/rest/v1/')) {
    if (method === 'GET' && url.includes('/rest/v1/notes') && url.includes('id=eq.marknote-diagnostic-note-')) {
      return jsonResponse(200, [{ id: 'still-here' }]);
    }
    if (method === 'GET') {
      return jsonResponse(200, []);
    }
    if (method === 'POST' || method === 'PATCH') {
      return jsonResponse(201, []);
    }
    if (method === 'DELETE') {
      return jsonResponse(204, []);
    }
  }
  if (url.includes('/storage/v1/object/list/attachments')) {
    return jsonResponse(200, []);
  }
  return jsonResponse(500, { message: 'Unexpected URL: ' + url });
};
function jsonResponse(status, body) {
  return {
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}
`,
);

const leftoverResult = spawnSync(process.execPath, ['--require', leftoverPreloadPath, 'scripts/check-supabase-sync.mjs'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  env: {
    ...process.env,
    VITE_SUPABASE_URL: 'https://localhost',
    VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    SUPABASE_ACCESS_TOKEN: token,
  },
});

assert.notEqual(leftoverResult.status, 0, `${leftoverResult.stdout}\n${leftoverResult.stderr}`);
assert.match(leftoverResult.stderr, /Sync table note delete returned success, but the diagnostic row is still visible/);
assert.doesNotMatch(leftoverResult.stdout, /Attachment storage canary: ok/);

const storageLeftoverPreloadPath = join(tempDir, 'storage-leftover-preload.cjs');
writeFileSync(
  storageLeftoverPreloadPath,
  `
const assert = require('node:assert/strict');
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const method = init.method || 'GET';
  if (url.includes('/auth/v1/health')) {
    return jsonResponse(200, { status: 'ok' });
  }
  if (url.includes('/rest/v1/')) {
    if (method === 'GET') {
      return jsonResponse(200, []);
    }
    if (method === 'POST' || method === 'PATCH') {
      return jsonResponse(201, []);
    }
    if (method === 'DELETE') {
      return jsonResponse(204, []);
    }
  }
  if (url.includes('/storage/v1/object/list/attachments')) {
    return jsonResponse(200, []);
  }
  if (url.includes('/storage/v1/object/attachments/') && method === 'POST') {
    assert.equal(url.includes('/${userId}/.marknote-diagnostics/'), true);
    return jsonResponse(200, { Key: 'canary' });
  }
  if (url.includes('/storage/v1/object/authenticated/attachments/') && method === 'GET') {
    assert.equal(url.includes('/${userId}/.marknote-diagnostics/'), true);
    return textResponse(200, 'still here');
  }
  if (url.includes('/storage/v1/object/attachments') && method === 'DELETE') {
    const body = JSON.parse(init.body || '{}');
    assert.match(body.prefixes[0], /^${userId}\\/\\.marknote-diagnostics\\/check-supabase-sync-/);
    return jsonResponse(200, []);
  }
  return jsonResponse(500, { message: 'Unexpected URL: ' + url });
};
function jsonResponse(status, body) {
  return {
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}
function textResponse(status, body) {
  return {
    status,
    async text() {
      return body;
    },
  };
}
`,
);

const storageLeftoverResult = spawnSync(process.execPath, ['--require', storageLeftoverPreloadPath, 'scripts/check-supabase-sync.mjs'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  env: {
    ...process.env,
    VITE_SUPABASE_URL: 'https://localhost',
    VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    SUPABASE_ACCESS_TOKEN: token,
  },
});

assert.notEqual(storageLeftoverResult.status, 0, `${storageLeftoverResult.stdout}\n${storageLeftoverResult.stderr}`);
assert.match(storageLeftoverResult.stderr, /Attachment storage delete returned success, but the diagnostic object is still downloadable/);
assert.doesNotMatch(storageLeftoverResult.stdout, /Attachment storage canary: ok/);

console.log('supabase sync check tests passed');

function jwtWithSub(sub) {
  return ['header', JSON.stringify({ sub }), 'signature'].map(base64Url).join('.');
}

function base64Url(value) {
  return Buffer.from(value).toString('base64url');
}
