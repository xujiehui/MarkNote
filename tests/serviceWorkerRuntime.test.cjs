/* global Event, EventTarget */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { MessageChannel } = require('node:worker_threads');

async function main() {
  const external = runtime({ active: true });
  await external.api.registerOfflineWorker('/MarkNote/');
  assert.equal(external.api.getOfflineState().offlineReady, true);
  assert.equal(external.registerOptions.scope, '/MarkNote/');
  assert.equal(external.registerOptions.updateViaCache, 'none');
  external.container.dispatchEvent(new Event('controllerchange'));
  assert.equal(external.reloads, 0, 'An update accepted by another tab must not reload this editor');
  assert.equal(external.api.getOfflineState().updateAvailable, true);
  await external.api.activateOfflineUpdate();
  assert.equal(external.reloads, 1, 'The explicit action may reload after its caller has saved drafts');

  const explicit = runtime({ active: true, waiting: true });
  await explicit.api.registerOfflineWorker('/MarkNote/');
  assert.equal(explicit.api.getOfflineState().updateAvailable, true);
  assert.equal(explicit.messages.length, 0, 'A ready update waits without automatic activation');
  const activation = explicit.api.activateOfflineUpdate();
  assert.equal(explicit.messages.length, 1);
  assert.equal(explicit.messages[0].type, 'MARKNOTE_ACTIVATE_UPDATE');
  assert.equal(explicit.reloads, 0, 'Wait for the new worker to control the page before reloading');
  explicit.container.dispatchEvent(new Event('controllerchange'));
  await activation;
  assert.equal(explicit.reloads, 1);

  const failed = runtime({ fail: true });
  await failed.api.registerOfflineWorker('/MarkNote/');
  assert.equal(failed.api.getOfflineState().error, true);
  assert.equal(failed.api.getOfflineState().offlineReady, false);
  await assert.rejects(failed.api.activateOfflineUpdate(), /no longer available/);
  const missingCache = runtime({ active: true, offlineReady: false });
  await missingCache.api.registerOfflineWorker('/MarkNote/');
  assert.equal(missingCache.api.getOfflineState().offlineReady, false, 'An active worker alone does not establish offline readiness');
  const stalled = runtime({ active: true, waiting: true });
  await stalled.api.registerOfflineWorker('/MarkNote/');
  const stalledAttempt = stalled.api.activateOfflineUpdate();
  for (const callback of stalled.timers.values()) callback();
  await assert.rejects(stalledAttempt, /did not activate/);
  stalled.container.dispatchEvent(new Event('controllerchange'));
  assert.equal(stalled.reloads, 0, 'A late update after timeout must not interrupt resumed editing');
  const installing = runtime({ installing: true });
  await installing.api.registerOfflineWorker('/MarkNote/');
  assert.equal(installing.api.getOfflineState().offlineReady, false);
  installing.registration.installing.state = 'redundant';
  installing.registration.installing.dispatchEvent(new Event('statechange'));
  assert.equal(installing.api.getOfflineState().error, true, 'Initial offline installation failure must be visible in runtime status');

  const desktop = runtime({ protocol: 'file:' });
  await desktop.api.registerOfflineWorker('./');
  assert.equal(desktop.registerOptions, null, 'Electron file URLs must not register a web service worker');
  console.log('PWA runtime readiness and explicit safe-update tests passed');
}

function runtime(options = {}) {
  const fixture = { reloads: 0, messages: [], registerOptions: null, timers: new Map() };
  let timerId = 0;
  fixture.registration = Object.assign(new EventTarget(), {
    active: options.active ? { postMessage: (_message, ports) => ports[0].postMessage({ type: 'MARKNOTE_OFFLINE_STATUS', ready: options.offlineReady !== false }) } : null,
    waiting: options.waiting ? { postMessage: (message) => fixture.messages.push(message) } : null,
    installing: options.installing ? Object.assign(new EventTarget(), { state: 'installing' }) : null,
  });
  fixture.container = Object.assign(new EventTarget(), {
    controller: fixture.registration.active,
    ready: options.active ? Promise.resolve(fixture.registration) : new Promise(() => undefined),
    register: async (_url, config) => {
      fixture.registerOptions = config;
      if (options.fail) throw new Error('Install unavailable');
      return fixture.registration;
    },
  });
  const exports = {};
  const compiled = ts.transpileModule(readFileSync('src/lib/serviceWorker.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(compiled, {
    exports,
    MessageChannel,
    setTimeout: (callback) => { timerId += 1; fixture.timers.set(timerId, callback); return timerId; },
    clearTimeout: (id) => fixture.timers.delete(id),
    navigator: { serviceWorker: fixture.container },
    window: { location: { protocol: options.protocol || 'https:', reload: () => { fixture.reloads += 1; } } },
  });
  fixture.api = exports;
  return fixture;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
