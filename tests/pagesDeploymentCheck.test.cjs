const assert = require('node:assert/strict');

async function main() {
  const { checkPagesDeployment } = await import('../scripts/check-pages-deployment.mjs');
  const pagesUrl = 'https://xujiehui.github.io/MarkNote/?app=1';
  const syncConfigUrl = 'https://config.example.test/marknote/sync-config.json';
  const endpoint = syncConfigUrl;

  const requests = [];
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    requests.push({ url, headers: init.headers || {} });
    if (url.startsWith(pagesUrl)) {
      return response('<script type="module" src="./assets/index-pages.js"></script>', {
        contentType: 'text/html',
      });
    }
    if (url === 'https://xujiehui.github.io/MarkNote/assets/index-pages.js') {
      return response(`globalThis.__MARKNOTE_ENV__={VITE_SYNC_CONFIG_URL:${JSON.stringify(endpoint)}}`);
    }
    if (url === syncConfigUrl) {
      return response(
        JSON.stringify({
          provider: 'supabase',
          supabase: {
            url: 'https://project-ref.supabase.co',
            publishableKey: 'publishable-test-value',
          },
        }),
        {
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
        },
      );
    }
    if (url === 'https://project-ref.supabase.co/auth/v1/settings') {
      assert.equal(init.headers.apikey, 'publishable-test-value');
      return response(JSON.stringify({ external: { google: true } }), {
        contentType: 'application/json',
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const result = await checkPagesDeployment({
    pagesUrl,
    syncConfigUrl,
    fetchImpl,
    attempts: 1,
    retryDelayMs: 1,
    log: () => undefined,
  });
  assert.equal(result.bundleUrl.href, 'https://xujiehui.github.io/MarkNote/assets/index-pages.js');
  const configRequest = requests.find((request) => request.url === syncConfigUrl);
  assert.equal(configRequest.headers.origin, 'https://xujiehui.github.io');

  await assert.rejects(
    () =>
      checkPagesDeployment({
        pagesUrl,
        syncConfigUrl,
        fetchImpl: async (input) => {
          const url = String(input);
          if (url.startsWith(pagesUrl)) {
            return response('<script type="module" src="./assets/index-stale.js"></script>');
          }
          if (url.endsWith('/assets/index-stale.js')) {
            return response('globalThis.__MARKNOTE_ENV__={}');
          }
          throw new Error(`Unexpected URL: ${url}`);
        },
        attempts: 1,
        retryDelayMs: 1,
        log: () => undefined,
      }),
    /does not contain the configured sync backend endpoint/,
  );

  console.log('pages deployment check tests passed');
}

function response(body, { contentType = 'text/javascript', headers = {} } = {}) {
  return new globalThis.Response(body, {
    status: 200,
    headers: {
      'content-type': contentType,
      ...headers,
    },
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
