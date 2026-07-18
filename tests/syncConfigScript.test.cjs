const assert = require('node:assert/strict');

async function main() {
  const { loadSupabaseRuntimeConfig } = await import('../scripts/sync-config.mjs');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    assert.equal(String(input), 'https://config.example.test/marknote/sync-config');
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          provider: 'supabase',
          supabase: {
            url: 'https://backend-project.supabase.co',
            publishableKey: 'sb_publishable_backend_test',
          },
        };
      },
    };
  };

  assert.deepEqual(
    await loadSupabaseRuntimeConfig({
      VITE_SUPABASE_URL: 'https://legacy-project.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_legacy_test',
    }),
    { provider: 'disabled' },
  );

  assert.deepEqual(
    await loadSupabaseRuntimeConfig({
      VITE_SYNC_CONFIG_URL: 'https://config.example.test/marknote/sync-config',
      VITE_SUPABASE_URL: 'https://legacy-project.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_legacy_test',
    }),
    {
      provider: 'supabase',
      supabase: {
        url: 'https://backend-project.supabase.co',
        publishableKey: 'sb_publishable_backend_test',
      },
    },
  );

  globalThis.fetch = originalFetch;
  console.log('sync config script tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
