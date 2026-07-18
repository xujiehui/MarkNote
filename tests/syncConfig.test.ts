import assert from 'node:assert/strict';
import {
  hasSyncConfigSource,
  loadSyncConfig,
  resetSyncConfigCacheForTests,
} from '../src/sync/env';
import { getRemoteSyncAdapter, resetRemoteSyncAdapterForTests } from '../src/sync/adapters';

const originalFetch = globalThis.fetch;

function setRuntimeEnv(env: { VITE_SYNC_CONFIG_URL?: string } | undefined): void {
  Object.defineProperty(globalThis, '__MARKNOTE_ENV__', {
    value: env,
    configurable: true,
    writable: true,
  });
}

async function main() {
  setRuntimeEnv(undefined);
  resetSyncConfigCacheForTests();
  resetRemoteSyncAdapterForTests();
  assert.equal(hasSyncConfigSource(), false);
  assert.equal(getRemoteSyncAdapter().configured, false);

  let fetchCount = 0;
  setRuntimeEnv({ VITE_SYNC_CONFIG_URL: 'https://api.example.test/marknote/sync-config' });
  globalThis.fetch = (async (input, init) => {
    fetchCount += 1;
    assert.equal(input, 'https://api.example.test/marknote/sync-config');
    assert.equal(init?.cache, 'no-store');
    assert.equal((init?.headers as Record<string, string>).accept, 'application/json');
    return new Response(
      JSON.stringify({
        provider: 'supabase',
        supabase: {
          url: 'https://project.supabase.co',
          publishableKey: 'sb_publishable_backend',
          authRedirectUrl: 'https://app.example.test/?app=1',
        },
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  resetSyncConfigCacheForTests();
  resetRemoteSyncAdapterForTests();
  assert.equal(hasSyncConfigSource(), true);
  assert.equal(getRemoteSyncAdapter().configured, true);
  assert.deepEqual(await loadSyncConfig(), {
    provider: 'supabase',
    supabase: {
      url: 'https://project.supabase.co',
      publishableKey: 'sb_publishable_backend',
      authRedirectUrl: 'https://app.example.test/?app=1',
    },
  });
  assert.deepEqual((await loadSyncConfig()).provider, 'supabase');
  assert.equal(fetchCount, 1);

  Object.defineProperty(globalThis, '__MARKNOTE_SYNC_CONFIG__', {
    value: {
      provider: 'supabase',
      supabase: {
        url: 'https://injected.supabase.co',
        publishableKey: 'sb_publishable_injected',
      },
    },
    configurable: true,
    writable: true,
  });
  setRuntimeEnv(undefined);
  resetSyncConfigCacheForTests();
  assert.deepEqual(await loadSyncConfig(), { provider: 'disabled' });

  globalThis.fetch = originalFetch;
  setRuntimeEnv(undefined);
  Object.defineProperty(globalThis, '__MARKNOTE_SYNC_CONFIG__', {
    value: undefined,
    configurable: true,
    writable: true,
  });
  resetSyncConfigCacheForTests();
  resetRemoteSyncAdapterForTests();

  console.log('sync config tests passed');
}

main().catch((error) => {
  globalThis.fetch = originalFetch;
  console.error(error);
  process.exitCode = 1;
});
