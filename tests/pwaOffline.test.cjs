/* global Headers, Response */
const assert = require('node:assert/strict');
const { createHash, webcrypto } = require('node:crypto');
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');
const vm = require('node:vm');

const scope = 'https://example.test/MarkNote/';
const prefix = `marknote-shell-v2-${encodeURIComponent(scope)}-`;

async function main() {
  const directory = mkdtempSync(join(tmpdir(), 'marknote-offline-'));
  try {
    mkdirSync(join(directory, 'assets'));
    writeFileSync(join(directory, 'index.html'), '<html><script src="./assets/app-old.js"></script></html>');
    writeFileSync(join(directory, 'manifest.webmanifest'), '{}');
    writeFileSync(join(directory, 'marknote.svg'), '<svg/>');
    writeFileSync(join(directory, 'assets/app-old.js'), 'console.log("old bundle")');
    writeFileSync(join(directory, 'assets/app.css'), 'body{color:black}');
    writeFileSync(join(directory, 'assets/app.js.map'), 'private source map');
    writeFileSync(join(directory, 'assets/sync-config.json'), 'private runtime configuration');
    writeFileSync(join(directory, '.env'), 'NOT_AN_ARTIFACT=1');

    generate(directory);
    const initialManifest = readManifest(directory);
    const initialSource = readFileSync(join(directory, 'sw.js'), 'utf8');
    generate(directory);
    assert.equal(readFileSync(join(directory, 'sw.js'), 'utf8'), initialSource, 'The same build must produce the same cache version');
    assert.ok(initialManifest.entries.some(({ url }) => url === './index.html'));
    assert.ok(initialManifest.entries.some(({ url }) => url === './assets/app-old.js'));
    assert.ok(!initialManifest.entries.some(({ url }) => /\.map|\.json|\.env/.test(url)));

    const cacheStore = createCaches();
    await cacheStore.open('another-application-private-cache');
    const old = createWorker(initialSource, initialManifest, directory, cacheStore);
    await old.dispatch('install');
    assert.equal(old.skipWaitingCount, 0, 'Installation must not interrupt open editors');
    assert.ok(old.fetchOptions.every((options) => options.cache === 'reload' && options.credentials === 'omit' && options.redirect === 'error'));
    await old.dispatch('activate');
    let status;
    await old.dispatch('message', { data: { type: 'MARKNOTE_OFFLINE_STATUS' }, ports: [{ postMessage: (value) => { status = value; } }] });
    assert.equal(status.ready, true, 'Readiness must verify the complete app shell cache');
    old.offline = true;
    assert.match(await (await old.request(request(scope, 'navigate'))).text(), /app-old/);
    assert.match(await (await old.request(request(`${scope}?app=1&code=private-oauth-code`, 'navigate'))).text(), /app-old/);
    assert.equal(await (await old.request(request(`${scope}assets/app-old.js`, 'cors', 'script'))).text(), 'console.log("old bundle")');
    assert.equal(await (await old.request(request(`${scope}assets/app.css`, 'cors', 'style'))).text(), 'body{color:black}');

    // HTTP caching is absent in this harness. Only CacheStorage can satisfy
    // these requests; all network attempts fail after switching offline.
    const before = [...cacheStore.storage.values()].reduce((count, entries) => count + entries.size, 0);
    for (const privateRequest of [
      request(`${scope}api/notes`),
      request(`${scope}auth/v1/token`),
      request('https://backend.example.test/rest/v1/notes'),
      request(`${scope}assets/app-old.js?token=private`),
      request(`${scope}assets/app-old.js`, 'cors', 'script', { authorization: 'Bearer private' }),
      { ...request(scope, 'navigate'), method: 'POST' },
    ]) assert.equal(old.intercept(privateRequest), null, 'Private, authenticated and runtime requests must bypass caches');
    assert.equal([...cacheStore.storage.values()].reduce((count, entries) => count + entries.size, 0), before);
    for (const entries of cacheStore.storage.values()) assert.ok([...entries.keys()].every((url) => !url.includes('private-oauth-code')));

    writeFileSync(join(directory, 'index.html'), '<html><script src="./assets/app-new.js"></script></html>');
    writeFileSync(join(directory, 'assets/app-new.js'), 'console.log("new bundle")');
    rmSync(join(directory, 'assets/app-old.js'));
    generate(directory);
    const newManifest = readManifest(directory);
    assert.notEqual(newManifest.version, initialManifest.version, 'Artifact changes must change the cache version');
    const current = createWorker(readFileSync(join(directory, 'sw.js'), 'utf8'), newManifest, directory, cacheStore);
    await current.dispatch('install');
    current.clientCount = 2;
    await current.dispatch('activate');
    assert.ok(cacheStore.storage.has(`${prefix}${initialManifest.version}`), 'Other open tabs still need the old bundle');
    current.offline = true;
    assert.match(await (await current.request(request(scope, 'navigate'))).text(), /app-new/);
    assert.match(await (await current.request(request(`${scope}assets/app-old.js`, 'cors', 'script'))).text(), /old bundle/);
    assert.match(await (await current.request(request(`${scope}assets/app-old.js`, 'same-origin', 'worker'))).text(), /old bundle/, 'An older tab can still start its own version of a static search worker offline');
    await current.dispatch('message', { data: { type: 'MARKNOTE_ACTIVATE_UPDATE' }, source: { url: 'https://other.test/' } });
    assert.equal(current.skipWaitingCount, 0);
    await current.dispatch('message', { data: { type: 'MARKNOTE_ACTIVATE_UPDATE' }, source: { url: `${scope}?app=1` } });
    assert.equal(current.skipWaitingCount, 1, 'Only an explicit application update request can activate a waiting worker');
    current.clientCount = 1;
    await current.dispatch('activate');
    assert.ok(!cacheStore.storage.has(`${prefix}${initialManifest.version}`));
    assert.ok(cacheStore.storage.has('another-application-private-cache'), 'Cache cleanup must stay within this application scope');

    const corruptedManifest = { ...newManifest, version: 'invalid-checksum', entries: newManifest.entries.map((entry) => ({ ...entry, revision: '0'.repeat(64) })) };
    const corrupted = createWorker(sourceFor(corruptedManifest), corruptedManifest, directory, cacheStore);
    await assert.rejects(corrupted.dispatch('install'), /checksum/);
    assert.ok(!cacheStore.storage.has(`${prefix}invalid-checksum`), 'Failed installs must not retain a partial offline shell');
    assert.ok(cacheStore.storage.has(`${prefix}${newManifest.version}`), 'A failed update must preserve the active offline shell');
    const unbuilt = createWorker(readFileSync('public/sw.js', 'utf8'), newManifest, directory, cacheStore);
    await assert.rejects(unbuilt.dispatch('install'), /missing or incompatible/);

    const flag = process.argv.indexOf('--distribution');
    if (flag >= 0) await verifyDistribution(process.argv[flag + 1], cacheStore);
    console.log('PWA offline, artifact integrity, update and private-cache regression tests passed');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function generate(directory) {
  const result = spawnSync(process.execPath, ['scripts/generate-pwa-precache.mjs', directory], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function readManifest(directory) {
  return JSON.parse(readFileSync(join(directory, 'offline-manifest.json'), 'utf8'));
}

function sourceFor(manifest) {
  return readFileSync('public/sw.js', 'utf8').replace('/*__MARKNOTE_PRECACHE__*/ null', JSON.stringify(manifest));
}

function request(url, mode = 'cors', destination = '', headers = {}) {
  return { url, method: 'GET', mode, destination, headers: new Headers(headers) };
}

function createCaches() {
  const storage = new Map();
  return {
    storage,
    keys: async () => [...storage.keys()],
    delete: async (name) => storage.delete(name),
    open: async (name) => {
      if (!storage.has(name)) storage.set(name, new Map());
      const entries = storage.get(name);
      return {
        put: async (url, response) => { entries.set(url, response.clone()); },
        match: async (url) => entries.get(url)?.clone(),
      };
    },
  };
}

function createWorker(source, manifest, directory, cacheStore) {
  const listeners = new Map();
  const worker = {
    offline: false,
    clientCount: 1,
    skipWaitingCount: 0,
    fetchOptions: [],
    async dispatch(type, fields = {}) {
      const pending = [];
      listeners.get(type)?.({ ...fields, waitUntil: (promise) => pending.push(promise) });
      await Promise.all(pending);
    },
    intercept(input) {
      let response = null;
      listeners.get('fetch')({ request: input, respondWith: (promise) => { response = promise; } });
      return response;
    },
    async request(input) {
      const response = this.intercept(input);
      assert.ok(response, `Expected interception: ${input.url}`);
      return response;
    },
  };
  const files = new Map(manifest.entries.map(({ url }) => [new URL(url, scope).href, join(directory, url.slice(2))]));
  vm.runInNewContext(source, {
    URL, Uint8Array, encodeURIComponent,
    caches: cacheStore,
    fetch: async (input, options) => {
      if (options) worker.fetchOptions.push(options);
      if (worker.offline) throw new Error('Network offline; HTTP cache disabled');
      const path = files.get(typeof input === 'string' ? input : input.url);
      if (!path) return new Response('Missing artifact', { status: 404 });
      return new Response(readFileSync(path));
    },
    self: {
      registration: { scope },
      crypto: webcrypto,
      addEventListener: (type, handler) => listeners.set(type, handler),
      skipWaiting: async () => { worker.skipWaitingCount += 1; },
      clients: { claim: async () => undefined, matchAll: async () => Array.from({ length: worker.clientCount }, () => ({ url: scope })) },
    },
  });
  return worker;
}

async function verifyDistribution(directory, cacheStore) {
  assert.ok(directory, '--distribution requires a directory');
  const manifest = readManifest(directory);
  const source = readFileSync(join(directory, 'sw.js'), 'utf8');
  assert.equal(manifest.format, 1);
  assert.ok(!source.includes('/*__MARKNOTE_PRECACHE__*/ null'), 'Production worker must embed the generated artifact manifest');
  for (const entry of manifest.entries) {
    const bytes = readFileSync(join(directory, entry.url.slice(2)));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.revision, `Artifact changed after generating offline manifest: ${entry.url}`);
  }
  const worker = createWorker(source, manifest, directory, cacheStore);
  await worker.dispatch('install');
  await worker.dispatch('activate');
  worker.offline = true;
  const html = await (await worker.request(request(`${scope}?app=1`, 'navigate'))).text();
  assert.match(html, /<div[^>]+id="root"/);
  for (const { url } of manifest.entries.filter(({ url }) => /\.(js|css)$/.test(url))) {
    const response = await worker.request(request(new URL(url, scope).href, 'cors', url.endsWith('.js') ? 'script' : 'style'));
    assert.equal(response.status, 200);
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
